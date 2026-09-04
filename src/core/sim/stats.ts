/**
 * Run-level statistics derived from the recorded cycle traces: instruction
 * mix, branch behaviour, memory traffic, and pipeline utilisation. Pure
 * functions so the UI can recompute them on every tick cheaply.
 */
import type { InstrDef } from '../isa/instructions';
import type { CycleTrace, InstrTrace, Stats } from './types';

export type InstrClass = 'arith' | 'logic' | 'shift' | 'muldiv' | 'load' | 'store' | 'branch' | 'jump' | 'system' | 'other';

export const INSTR_CLASSES: readonly { readonly id: InstrClass; readonly label: string }[] = [
  { id: 'arith', label: 'Arithmetic' },
  { id: 'logic', label: 'Logic' },
  { id: 'shift', label: 'Shift' },
  { id: 'muldiv', label: 'Multiply / divide' },
  { id: 'load', label: 'Load' },
  { id: 'store', label: 'Store' },
  { id: 'branch', label: 'Branch' },
  { id: 'jump', label: 'Jump' },
  { id: 'system', label: 'System' },
  { id: 'other', label: 'Other' },
];

const MULDIV = new Set(['MUL', 'MULH', 'MULHSU', 'MULHU', 'DIV', 'DIVU', 'REM', 'REMU']);
const SHIFT = new Set(['SLL', 'SRL', 'SRA']);
const LOGIC = new Set(['AND', 'OR', 'XOR']);

/** Coarse category of an instruction, for the mix chart. */
export function classify(def: InstrDef | null): InstrClass {
  if (!def) return 'other';
  if (def.system) return 'system';
  if (def.jump) return 'jump';
  if (def.branch) return 'branch';
  if (def.memRead) return 'load';
  if (def.memWrite) return 'store';
  if (MULDIV.has(def.alu)) return 'muldiv';
  if (SHIFT.has(def.alu)) return 'shift';
  if (LOGIC.has(def.alu)) return 'logic';
  return 'arith';
}

/** The instruction that completed in this cycle, if any. */
export function retiredIn(trace: CycleTrace): InstrTrace | null {
  return trace.model === 'single' ? trace.stages.EX.trace : trace.stages.WB.trace;
}

export interface RunSummary {
  readonly cycles: number;
  readonly instructions: number;
  /** Cycles per instruction; null before anything retires. */
  readonly cpi: number | null;
  readonly stalls: number;
  readonly flushes: number;
  /** Cycles in which no instruction retired (bubbles, stalls, fill). */
  readonly idleCycles: number;
  readonly branches: { readonly total: number; readonly taken: number };
  readonly jumps: number;
  readonly loads: number;
  readonly stores: number;
  readonly regWrites: number;
  readonly compressed: number;
  readonly mix: Readonly<Record<InstrClass, number>>;
  /** Number of cycles the summary was computed from (history may be capped). */
  readonly sampledCycles: number;
}

function emptyMix(): Record<InstrClass, number> {
  return { arith: 0, logic: 0, shift: 0, muldiv: 0, load: 0, store: 0, branch: 0, jump: 0, system: 0, other: 0 };
}

/** Aggregate every recorded cycle into one summary. */
export function summarize(traces: readonly CycleTrace[], stats: Stats): RunSummary {
  const mix = emptyMix();
  let taken = 0, jumps = 0, loads = 0, stores = 0, regWrites = 0, compressed = 0, idle = 0;
  for (const tr of traces) {
    regWrites += tr.regWrites.filter((w) => w.reg !== 0).length;
    const t = retiredIn(tr);
    if (!t) { idle++; continue; }
    const cls = classify(t.instr.def);
    mix[cls]++;
    if (cls === 'branch' && t.branchCondMet) taken++;
    if (cls === 'jump') jumps++;
    if (cls === 'load') loads++;
    if (cls === 'store') stores++;
    if (t.instr.compressed) compressed++;
  }
  const instructions = stats.instructions;
  return {
    cycles: stats.cycles,
    instructions,
    cpi: instructions ? stats.cycles / instructions : null,
    stalls: stats.stalls,
    flushes: stats.flushes,
    idleCycles: idle,
    branches: { total: mix.branch, taken },
    jumps, loads, stores, regWrites, compressed,
    mix,
    sampledCycles: traces.length,
  };
}
