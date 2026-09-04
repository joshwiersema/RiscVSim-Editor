import { STACK_TOP } from '../asm/assembler';
import type { Program } from '../program';
import { createDevices, type DeviceSet } from '../io/devices';
import type { InputKind } from './ecall';
import { Memory } from './memory';
import type { CycleTrace, Stats } from './types';

export type ModelKind = 'single' | 'pipeline';

export interface ProcessorOptions {
  readonly forwarding: boolean;
  readonly hazardDetection: boolean;
}

export const DEFAULT_OPTIONS: ProcessorOptions = { forwarding: true, hazardDetection: true };

/** The program is waiting for console input requested by an ecall. */
export interface PendingInput {
  readonly kind: InputKind;
  readonly addr: number;
  readonly maxLen: number;
}

/** Mutable architectural + microarchitectural state shared by both models. */
export interface CoreState {
  regs: number[];
  pc: number;
  mem: Memory;
  devices: DeviceSet;
  textEnd: number;
  finished: boolean;
  exitCode: number;
  error: string | null;
  pendingInput: PendingInput | null;
  cycle: number;
  fetchSeq: number;
  stats: Stats;
}

export function freshCore(program: Program): CoreState {
  const mem = new Memory();
  const devices = createDevices();
  for (const d of devices.all) mem.mapDevice(d);
  for (const s of program.segments) s.bytes.forEach((b, i) => mem.writeByte(s.addr + i, b));
  const regs = new Array<number>(32).fill(0);
  regs[2] = STACK_TOP;
  regs[3] = 0x10000800 | 0; // gp: conventional data pointer
  return {
    regs, pc: program.entry, mem, devices,
    textEnd: program.textEnd,
    finished: program.text.length === 0, exitCode: 0, error: null, pendingInput: null, cycle: 0, fetchSeq: 0,
    stats: { cycles: 0, instructions: 0, stalls: 0, flushes: 0 },
  };
}

/** Anything the machine can clock forward one cycle. */
export interface Processor {
  readonly kind: ModelKind;
  readonly core: CoreState;
  /** Run one clock cycle and return the trace of what happened. */
  step(): CycleTrace;
  /** Opaque snapshot of pipeline registers (immutable records) for undo. */
  saveMicroState(): unknown;
  restoreMicroState(s: unknown): void;
  /** Addresses of instructions currently in flight. */
  pcsInFlight(): number[];
}
