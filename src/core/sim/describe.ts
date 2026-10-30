/**
 * Wording shared by the hover explanations and the per-cycle narration for
 * floating-point and CSR instructions.
 */
import { csrName } from '../isa/csr';
import { regFile, type RegOperand } from '../isa/operands';
import { fpuSymbol } from '../fp/fpu';
import { flagNames, FLAG_INFO, formatFloat, RM_MNEMONICS, ROUNDING_MODE_NAMES } from '../fp/format';
import { hex32 } from '../util/format';
import type { InstrTrace } from './types';

/** A value carried by an operand: f registers show their bits and the float they encode. */
export function fmtOperand(t: InstrTrace, op: RegOperand, v: number): string {
  return regFile(t.instr.def, op) === 'F' ? `${hex32(v)} (${formatFloat(v)})` : `${hex32(v)} (${v | 0})`;
}

/** Short text for an operand value: a float or a signed integer. */
export function shortOperand(t: InstrTrace, op: RegOperand, v: number): string {
  return regFile(t.instr.def, op) === 'F' ? formatFloat(v) : String(v | 0);
}

export function flagsSentence(flags: number): string {
  if (!flags) return 'No exception flags were raised: the result is exact.';
  const names = FLAG_INFO.filter((f) => flags & f.bit).map((f) => `${f.short} (${f.name})`);
  return `Raised ${names.join(', ')}; these accrue into fflags at write-back.`;
}

function rmSentence(t: InstrTrace): string {
  if (t.fpRm === null) return '';
  const dyn = t.instr.funct3 === 7;
  return ` Rounding: ${RM_MNEMONICS[t.fpRm]} (${ROUNDING_MODE_NAMES[t.fpRm]})${dyn ? ', taken from frm because the instruction says dyn' : ', encoded in the instruction'}.`;
}

/** One-line description of what the FPU computed, e.g. "1.5 + 2.25 = 3.75". */
export function fpuExpression(t: InstrTrace): string {
  const op = t.ctrl.fpuOp;
  if (!op) return '';
  const a = shortOperand(t, 'rs1', t.aluA), b = shortOperand(t, 'rs2', t.aluB), c = shortOperand(t, 'rs3', t.opC);
  const r = shortOperand(t, 'rd', t.aluResult);
  switch (op) {
    case 'FSQRT': return `√${a} = ${r}`;
    case 'FMADD': return `${a} × ${b} + ${c} = ${r}`;
    case 'FMSUB': return `${a} × ${b} − ${c} = ${r}`;
    case 'FNMSUB': return `−(${a} × ${b}) + ${c} = ${r}`;
    case 'FNMADD': return `−(${a} × ${b}) − ${c} = ${r}`;
    case 'FMIN': case 'FMAX': return `${op === 'FMIN' ? 'min' : 'max'}(${a}, ${b}) = ${r}`;
    case 'FCLASS': return `class(${a}) = 0b${(t.aluResult >>> 0).toString(2)}`;
    case 'FCVT_W_S': case 'FCVT_WU_S': case 'FCVT_S_W': case 'FCVT_S_WU': return `${a} → ${r}`;
    case 'FMV_X_W': case 'FMV_W_X': return `bits ${hex32(t.aluA)} copied unchanged`;
    case 'FEQ': case 'FLT': case 'FLE': return `${a} ${fpuSymbol(op)} ${b} → ${r}`;
    default: return `${a} ${fpuSymbol(op)} ${b} = ${r}`;
  }
}

/** Full explanation of an FPU operation for the hover/inspector. */
export function fpuWhy(t: InstrTrace): string {
  const op = t.ctrl.fpuOp;
  if (!op) return '';
  if (t.trap) return `${t.trap}. The FPU produced no result.`;
  const lead = op === 'FMV_X_W' || op === 'FMV_W_X'
    ? `${t.instr.def?.name} moves raw bits between the register files without interpreting them: ${hex32(t.aluA)}.`
    : op.startsWith('FSGNJ')
      ? `Sign injection only rewrites bit 31 (the sign); the exponent and fraction pass straight through. ${fpuExpression(t)}.`
      : `The floating-point unit computes ${fpuExpression(t)} on IEEE-754 single-precision values, rounding the exact result once.`;
  const flags = op.startsWith('FSGNJ') || op.startsWith('FMV') || op === 'FCLASS' ? '' : ` ${flagsSentence(t.fpFlags)}`;
  return `${lead}${rmSentence(t)}${flags}`;
}

/** What the CSR unit did at write-back. */
export function csrSentence(t: InstrTrace): string {
  const a = t.csrOp;
  if (!a) return `${t.instr.def?.name} accesses ${csrName(t.imm)} when it reaches write-back.`;
  const write = a.next === null ? 'no write (pure read)' : `wrote ${hex32(a.next)}`;
  return `CSR ${csrName(a.addr)}: read ${hex32(a.old)} into ${t.ctrl.regWrite ? 'rd' : 'x0 (discarded)'}, ${write}.`;
}

export function flagList(flags: number): string {
  return flagNames(flags).join(' ') || 'none';
}
