/**
 * The floating-point unit: dispatches an RV32F operation to the soft-float
 * core. It sits beside the integer ALU in EX and shares its result bus.
 */
import {
  fadd, fclass, fcompare, fcvtFromInt, fcvtToInt, fdiv, ffma, fminmax, fmul, fsqrt, fsub,
  type FpResult, type RoundingMode,
} from './softfloat';

export type FpuOp =
  | 'FADD' | 'FSUB' | 'FMUL' | 'FDIV' | 'FSQRT' | 'FMIN' | 'FMAX'
  | 'FMADD' | 'FMSUB' | 'FNMSUB' | 'FNMADD'
  | 'FSGNJ' | 'FSGNJN' | 'FSGNJX'
  | 'FEQ' | 'FLT' | 'FLE' | 'FCLASS'
  | 'FCVT_W_S' | 'FCVT_WU_S' | 'FCVT_S_W' | 'FCVT_S_WU'
  | 'FMV_X_W' | 'FMV_W_X';

const SIGN = 0x80000000;
const exact = (bits: number): FpResult => ({ bits: bits | 0, flags: 0 });

/** Execute one FPU operation on raw register bits a (rs1), b (rs2), c (rs3). */
export function fpu(op: FpuOp, a: number, b: number, c: number, rm: RoundingMode): FpResult {
  switch (op) {
    case 'FADD': return fadd(a, b, rm);
    case 'FSUB': return fsub(a, b, rm);
    case 'FMUL': return fmul(a, b, rm);
    case 'FDIV': return fdiv(a, b, rm);
    case 'FSQRT': return fsqrt(a, rm);
    case 'FMIN': return fminmax(a, b, false);
    case 'FMAX': return fminmax(a, b, true);
    case 'FMADD': return ffma(a, b, c, false, false, rm);
    case 'FMSUB': return ffma(a, b, c, false, true, rm);
    case 'FNMSUB': return ffma(a, b, c, true, false, rm);
    case 'FNMADD': return ffma(a, b, c, true, true, rm);
    case 'FSGNJ': return exact((a & ~SIGN) | (b & SIGN));
    case 'FSGNJN': return exact((a & ~SIGN) | (~b & SIGN));
    case 'FSGNJX': return exact(a ^ (b & SIGN));
    case 'FEQ': return fcompare(a, b, 'EQ');
    case 'FLT': return fcompare(a, b, 'LT');
    case 'FLE': return fcompare(a, b, 'LE');
    case 'FCLASS': return exact(fclass(a));
    case 'FCVT_W_S': return fcvtToInt(a, false, rm);
    case 'FCVT_WU_S': return fcvtToInt(a, true, rm);
    case 'FCVT_S_W': return fcvtFromInt(a, false, rm);
    case 'FCVT_S_WU': return fcvtFromInt(a, true, rm);
    case 'FMV_X_W': case 'FMV_W_X': return exact(a);
  }
}

/** Whether the operation honours the rounding mode (has an rm field). */
export function fpuRounds(op: FpuOp): boolean {
  return ['FADD', 'FSUB', 'FMUL', 'FDIV', 'FSQRT', 'FMADD', 'FMSUB', 'FNMSUB', 'FNMADD', 'FCVT_W_S', 'FCVT_WU_S', 'FCVT_S_W', 'FCVT_S_WU'].includes(op);
}

/** Short operator text for narration, e.g. "+" for FADD. */
export function fpuSymbol(op: FpuOp): string {
  const map: Record<FpuOp, string> = {
    FADD: '+', FSUB: '−', FMUL: '×', FDIV: '÷', FSQRT: '√', FMIN: 'min', FMAX: 'max',
    FMADD: '×+', FMSUB: '×−', FNMSUB: '−×+', FNMADD: '−×−',
    FSGNJ: 'sgnj', FSGNJN: 'sgnjn', FSGNJX: 'sgnjx', FEQ: '==', FLT: '<', FLE: '<=', FCLASS: 'class',
    FCVT_W_S: '→int', FCVT_WU_S: '→uint', FCVT_S_W: 'int→', FCVT_S_WU: 'uint→', FMV_X_W: 'bits→x', FMV_W_X: 'bits→f',
  };
  return map[op];
}
