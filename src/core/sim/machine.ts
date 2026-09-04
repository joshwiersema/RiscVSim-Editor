import type { Program } from '../program';
import { cacheAccess, emptyCache, DEFAULT_DCACHE, DEFAULT_ICACHE, type CacheConfig, type CacheState } from '../cache/cache';
import { IO_BASE } from '../io/devices';
import { PipelineProcessor } from './pipeline';
import { DEFAULT_OPTIONS, freshCore, type ModelKind, type Processor, type ProcessorOptions } from './processor';
import { SingleCycleProcessor } from './singleCycle';
import type { CycleTrace, MemWrite, Stats } from './types';

interface HistoryEntry {
  readonly pc: number;
  readonly regs: readonly number[];
  readonly micro: unknown;
  readonly finished: boolean;
  readonly exitCode: number;
  readonly error: string | null;
  readonly cycle: number;
  readonly fetchSeq: number;
  readonly stats: Stats;
  readonly trace: CycleTrace;
  readonly outputLength: number;
  readonly icache: CacheState;
  readonly dcache: CacheState;
  readonly devices: readonly unknown[];
  /** Memory written by console input after this cycle (undone with it). */
  readonly inputWrites: MemWrite[];
}

export const MAX_HISTORY = 20000;
const RUN_CYCLE_LIMIT = 5_000_000;

export interface CacheConfigs { readonly icache: CacheConfig; readonly dcache: CacheConfig }
export const DEFAULT_CACHES: CacheConfigs = { icache: DEFAULT_ICACHE, dcache: DEFAULT_DCACHE };

/**
 * Owns a processor, its program, caches, devices, console output,
 * breakpoints, and a reversible history so every cycle can be undone.
 */
export class Machine {
  readonly proc: Processor;
  private history: HistoryEntry[] = [];
  private lastTraceValue: CycleTrace | null = null;
  output = '';
  breakpoints = new Set<number>();
  icache: CacheState;
  dcache: CacheState;

  constructor(
    readonly program: Program,
    readonly model: ModelKind,
    readonly options: ProcessorOptions = DEFAULT_OPTIONS,
    public caches: CacheConfigs = DEFAULT_CACHES,
  ) {
    const core = freshCore(program);
    core.devices.charOut.onChar = (c) => { this.output += c; };
    this.proc = model === 'single' ? new SingleCycleProcessor(core) : new PipelineProcessor(core, options);
    this.icache = emptyCache(caches.icache);
    this.dcache = emptyCache(caches.dcache);
  }

  get core() { return this.proc.core; }
  get finished(): boolean { return this.core.finished; }
  get blocked(): boolean { return this.core.pendingInput !== null; }
  get lastTrace(): CycleTrace | null { return this.lastTraceValue; }
  get canUndo(): boolean { return this.history.length > 0; }
  get historyLength(): number { return this.history.length; }
  /** All recorded cycle traces, oldest first. */
  get traces(): readonly CycleTrace[] { return this.history.map((h) => h.trace); }
  /** Addresses of instructions currently in the pipeline (or the PC for single-cycle). */
  get inFlight(): number[] { return this.proc.pcsInFlight(); }

  /** Replace the cache configuration; clears cache contents and statistics. */
  setCaches(cfg: CacheConfigs): void {
    this.caches = cfg;
    this.icache = emptyCache(cfg.icache);
    this.dcache = emptyCache(cfg.dcache);
  }

  /** Clock one cycle. Returns null if the machine is finished or waiting for input. */
  step(): CycleTrace | null {
    if (this.core.finished || this.core.pendingInput) return null;
    const c = this.core;
    const before = {
      pc: c.pc, regs: [...c.regs], micro: this.proc.saveMicroState(), finished: c.finished, exitCode: c.exitCode, error: c.error,
      cycle: c.cycle, fetchSeq: c.fetchSeq, stats: c.stats, outputLength: this.output.length,
      icache: this.icache, dcache: this.dcache, devices: c.devices.all.map((d) => d.snapshot()), inputWrites: [] as MemWrite[],
    };
    const trace = this.proc.step();
    // Console output from ecalls comes via the trace; the char device appends directly.
    this.output += trace.output;
    this.simulateCaches(trace);
    c.devices.cycles.cycles = c.cycle;
    this.history.push({ ...before, trace });
    if (this.history.length > MAX_HISTORY) this.history.shift();
    this.lastTraceValue = trace;
    return trace;
  }

  /** Feed this cycle's fetch and data accesses into the L1 caches. */
  private simulateCaches(trace: CycleTrace): void {
    const ifT = trace.stages.IF.trace;
    if (ifT && !trace.hazard.stall) this.icache = cacheAccess(this.caches.icache, this.icache, ifT.pc, false).state;
    const memT = trace.stages.MEM.trace;
    if (memT && (memT.ctrl.memRead || memT.ctrl.memWrite) && memT.memAddr < IO_BASE) {
      this.dcache = cacheAccess(this.caches.dcache, this.dcache, memT.memAddr, memT.ctrl.memWrite !== null).state;
    }
  }

  /** Satisfy a pending read_int / read_string / read_char ecall. */
  provideInput(text: string): boolean {
    const c = this.core;
    const p = c.pendingInput;
    if (!p) return false;
    const entry = this.history[this.history.length - 1];
    switch (p.kind) {
      case 'int': {
        const v = Number.parseInt(text.trim(), text.trim().startsWith('0x') ? 16 : 10);
        c.regs[10] = Number.isNaN(v) ? 0 : v | 0;
        break;
      }
      case 'char':
        c.regs[10] = text.length ? text.charCodeAt(0) & 0xff : 10;
        break;
      case 'string': {
        const bytes = [...text.slice(0, Math.max(0, p.maxLen - 1))].map((ch) => ch.charCodeAt(0) & 0xff);
        bytes.push(0);
        bytes.forEach((b, i) => {
          const addr = (p.addr + i) >>> 0;
          entry?.inputWrites.push({ addr, width: 1, value: b, prev: c.mem.readByte(addr) });
          c.mem.writeByte(addr, b);
        });
        break;
      }
    }
    this.output += text + '\n';
    c.pendingInput = null;
    return true;
  }

  /** Reverse the last cycle. */
  undo(): CycleTrace | null {
    const h = this.history.pop();
    if (!h) return null;
    const c = this.core;
    for (let i = h.inputWrites.length - 1; i >= 0; i--) c.mem.write(h.inputWrites[i].addr, 1, h.inputWrites[i].prev);
    for (let i = h.trace.memWrites.length - 1; i >= 0; i--) {
      const w = h.trace.memWrites[i];
      c.mem.write(w.addr, w.width, w.prev);
    }
    c.pc = h.pc; c.regs = [...h.regs]; c.finished = h.finished; c.exitCode = h.exitCode; c.error = h.error; c.cycle = h.cycle; c.fetchSeq = h.fetchSeq; c.stats = h.stats;
    c.pendingInput = null;
    this.proc.restoreMicroState(h.micro);
    this.icache = h.icache; this.dcache = h.dcache;
    c.devices.all.forEach((d, i) => d.restore(h.devices[i]));
    c.devices.cycles.cycles = c.cycle;
    this.output = this.output.slice(0, h.outputLength);
    this.lastTraceValue = this.history[this.history.length - 1]?.trace ?? null;
    return this.lastTraceValue;
  }

  /** Run until finished, blocked on input, a breakpoint is reached, or the cycle budget is hit. */
  run(maxCycles = RUN_CYCLE_LIMIT): { stoppedAtBreakpoint: boolean; cycles: number } {
    let n = 0;
    while (!this.core.finished && !this.core.pendingInput && n < maxCycles) {
      this.step();
      n++;
      if (this.breakpoints.size > 0 && this.breakpoints.has(this.core.pc)) return { stoppedAtBreakpoint: true, cycles: n };
    }
    return { stoppedAtBreakpoint: false, cycles: n };
  }
}
