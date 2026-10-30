import { decodeAt, type Decoded } from '../isa/decode';
import { RM_DYNAMIC } from '../isa/encode';
import { regIndex } from '../isa/operands';
import { fpu, fpuRounds } from '../fp/fpu';
import { ROUNDING_MODES } from '../fp/softfloat';
import { alu, branchTaken } from './alu';
import { control, extendLoad, memWidthBytes, type Control } from './control';
import type { Memory } from './memory';
import type { ForwardSrc, InstrTrace } from './types';

/** Fetch + decode. */
export function fetchDecode(mem: Memory, pc: number): Decoded {
  const half = mem.readHalf(pc);
  return decodeAt(half, (half & 3) === 3 ? mem.readWord(pc) : half);
}

export interface ExecInputs {
  readonly seq: number;
  readonly pc: number;
  readonly instr: Decoded;
  readonly ctrl: Control;
  readonly rs1Val: number;
  readonly rs2Val: number;
  readonly rs3Val?: number;
  readonly fwdA?: ForwardSrc;
  readonly fwdB?: ForwardSrc;
  readonly fwdC?: ForwardSrc;
  readonly opA: number;
  readonly opB: number;
  readonly opC?: number;
  /** Dynamic rounding mode (fcsr.frm) for FP instructions with rm = dyn. */
  readonly frm?: number;
}

export type ExResult = Omit<InstrTrace, 'memReadData' | 'wbValue' | 'ecall' | 'csrOp'>;

interface UnitResult { readonly value: number; readonly flags: number; readonly rm: number | null; readonly trap: string | null }

/** The ALU, or the FPU for floating-point instructions. */
function computeUnit(inp: ExecInputs, a: number, b: number, c: number): UnitResult {
  const { instr, ctrl } = inp;
  if (!ctrl.fpuOp) return { value: alu(ctrl.aluOp, a, b), flags: 0, rm: null, trap: null };
  const rounds = fpuRounds(ctrl.fpuOp);
  const rm = rounds ? (instr.funct3 === RM_DYNAMIC ? inp.frm ?? 0 : instr.funct3) : 0;
  const mode = ROUNDING_MODES[rm];
  if (!mode) {
    return { value: 0, flags: 0, rm: null, trap: `Illegal instruction: ${instr.def?.name} uses the dynamic rounding mode, but frm = ${rm} is not a valid mode` };
  }
  const r = fpu(ctrl.fpuOp, a, b, c, mode);
  return { value: r.bits, flags: r.flags, rm: rounds ? rm : null, trap: null };
}

/** The EX stage: operand muxes, ALU/FPU, branch unit, next-PC selection. */
export function executeStage(inp: ExecInputs): ExResult {
  const { pc, instr, ctrl, opA, opB } = inp;
  const opC = inp.opC ?? inp.rs3Val ?? 0;
  const imm = instr.imm;
  const pc4 = (pc + instr.size) | 0;
  const aluA = ctrl.aluSrcA === 'PC' ? pc : opA;
  const aluB = ctrl.aluSrcB === 'IMM' ? imm : opB;
  const unit = computeUnit(inp, aluA, aluB, opC);
  const aluResult = unit.value;
  const branchTarget = (pc + imm) | 0;
  const branchCondMet = ctrl.branch ? branchTaken(ctrl.branch, opA, opB) : false;
  const takeTarget = ctrl.jump !== null || (ctrl.branch !== null && branchCondMet);
  const target = ctrl.jump === 'JALR' ? aluResult & ~1 : branchTarget;
  return {
    seq: inp.seq, pc, pc4, instr, ctrl,
    rs1Val: inp.rs1Val, rs2Val: inp.rs2Val, rs3Val: inp.rs3Val ?? 0, imm,
    fwdA: inp.fwdA ?? 'NONE', fwdB: inp.fwdB ?? 'NONE', fwdC: inp.fwdC ?? 'NONE',
    opA, opB, opC, aluA, aluB, aluResult,
    fpFlags: unit.flags, fpRm: unit.rm, trap: unit.trap,
    branchTarget, branchCondMet,
    pcSrc: takeTarget ? 'TARGET' : 'PC4',
    nextPc: (takeTarget ? target : pc4) >>> 0,
    memAddr: aluResult >>> 0,
    memWriteData: opB,
    wbReg: ctrl.regWrite ? regIndex(instr, 'rd') : 0,
  };
}

export interface MemResult { readonly readData: number; readonly write: { addr: number; width: 1 | 2 | 4; value: number; prev: number } | null }

/** The MEM stage. Performs the write immediately; caller records it for undo. */
export function memoryStage(mem: Memory, t: Pick<InstrTrace, 'ctrl' | 'memAddr' | 'memWriteData'>): MemResult {
  const { ctrl } = t;
  if (ctrl.memRead) {
    const w = memWidthBytes(ctrl.memRead);
    return { readData: extendLoad(ctrl.memRead, mem.read(t.memAddr, w)), write: null };
  }
  if (ctrl.memWrite) {
    const w = memWidthBytes(ctrl.memWrite);
    const prev = mem.read(t.memAddr, w);
    mem.write(t.memAddr, w, t.memWriteData);
    return { readData: 0, write: { addr: t.memAddr, width: w, value: t.memWriteData & (w === 4 ? -1 : (1 << (8 * w)) - 1), prev } };
  }
  return { readData: 0, write: null };
}

/** The write-back mux. CSR read data is only known at write-back, so callers supply it. */
export function writebackValue(ctrl: Control, aluResult: number, memReadData: number, pc4: number, csrValue = 0): number {
  switch (ctrl.wbSrc) {
    case 'ALU': return aluResult;
    case 'MEM': return memReadData;
    case 'PC4': return pc4;
    case 'CSR': return csrValue;
    case 'NONE': return 0;
  }
}

/** Read the source operands of a decoded instruction from the unified register file. */
export function readSources(regs: readonly number[], instr: Decoded): { rs1Val: number; rs2Val: number; rs3Val: number } {
  return { rs1Val: regs[regIndex(instr, 'rs1')], rs2Val: regs[regIndex(instr, 'rs2')], rs3Val: regs[regIndex(instr, 'rs3')] };
}

export { control };
