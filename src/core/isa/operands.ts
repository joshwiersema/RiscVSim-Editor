/**
 * Operand bookkeeping shared by the decoder, the pipeline's hazard and
 * forwarding logic, the explanations, and the register views: which register
 * file each operand lives in, whether it is used, and its unified index
 * (x0..x31 = 0..31, f0..f31 = 32..63).
 */
import type { Decoded } from './decode';
import type { InstrDef, RegFile } from './instructions';
import { FP_REG_BASE, fpRegName, regName } from './registers';

export type RegOperand = 'rd' | 'rs1' | 'rs2' | 'rs3';

export function regFile(def: InstrDef | null, op: RegOperand): RegFile {
  if (op === 'rs3') return 'F';
  return def?.files?.[op] ?? 'X';
}

export function usesRs1(d: Decoded): boolean {
  const def = d.def;
  if (!def) return false;
  return def.format !== 'U' && def.format !== 'J' && !def.system && !def.csrImm;
}

export function usesRs2(d: Decoded): boolean {
  const def = d.def;
  if (!def) return false;
  if (def.format === 'R') return def.rs2Sel === undefined;
  return def.format === 'S' || def.format === 'B' || def.format === 'R4';
}

export function usesRs3(d: Decoded): boolean {
  return d.def?.format === 'R4';
}

function fieldOf(d: Decoded, op: RegOperand): number {
  switch (op) {
    case 'rd': return d.rd;
    case 'rs1': return d.rs1;
    case 'rs2': return d.rs2;
    case 'rs3': return d.rs3;
  }
}

/** Index of the operand in the unified register array. */
export function regIndex(d: Decoded, op: RegOperand): number {
  const n = fieldOf(d, op);
  return regFile(d.def, op) === 'F' ? FP_REG_BASE + n : n;
}

/** ABI name of the operand, e.g. "fa0" or "t1". */
export function operandName(d: Decoded, op: RegOperand): string {
  const n = fieldOf(d, op);
  return regFile(d.def, op) === 'F' ? fpRegName(n) : regName(n);
}

/** Whether the destination register can actually be written (x0 is hard-wired). */
export function rdWritable(d: Decoded): boolean {
  return regFile(d.def, 'rd') === 'F' || d.rd !== 0;
}

/** Unified indices this instruction reads, for highlighting register views. */
export function readIndices(d: Decoded): number[] {
  const out: number[] = [];
  if (usesRs1(d)) out.push(regIndex(d, 'rs1'));
  if (usesRs2(d)) out.push(regIndex(d, 'rs2'));
  if (usesRs3(d)) out.push(regIndex(d, 'rs3'));
  return out;
}

/** Does the instruction involve the floating-point register file at all? */
export function touchesFp(def: InstrDef | null): boolean {
  if (!def) return false;
  if (def.fpu || def.format === 'R4') return true;
  const f = def.files;
  return !!f && (f.rd === 'F' || f.rs1 === 'F' || f.rs2 === 'F');
}
