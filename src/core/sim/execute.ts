import { decodeAt, type Decoded } from '../isa/decode';
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
  readonly fwdA?: ForwardSrc;
  readonly fwdB?: ForwardSrc;
  readonly opA: number;
  readonly opB: number;
}

/** The EX stage: operand muxes, ALU, branch unit, next-PC selection. */
export function executeStage(inp: ExecInputs): Omit<InstrTrace, 'memReadData' | 'wbValue' | 'ecall'> {
  const { pc, instr, ctrl, opA, opB } = inp;
  const imm = instr.imm;
  const pc4 = (pc + instr.size) | 0;
  const aluA = ctrl.aluSrcA === 'PC' ? pc : opA;
  const aluB = ctrl.aluSrcB === 'IMM' ? imm : opB;
  const aluResult = alu(ctrl.aluOp, aluA, aluB);
  const branchTarget = (pc + imm) | 0;
  const branchCondMet = ctrl.branch ? branchTaken(ctrl.branch, opA, opB) : false;
  const takeTarget = ctrl.jump !== null || (ctrl.branch !== null && branchCondMet);
  const target = ctrl.jump === 'JALR' ? aluResult & ~1 : branchTarget;
  return {
    seq: inp.seq, pc, pc4, instr, ctrl,
    rs1Val: inp.rs1Val, rs2Val: inp.rs2Val, imm,
    fwdA: inp.fwdA ?? 'NONE', fwdB: inp.fwdB ?? 'NONE',
    opA, opB, aluA, aluB, aluResult, branchTarget, branchCondMet,
    pcSrc: takeTarget ? 'TARGET' : 'PC4',
    nextPc: (takeTarget ? target : pc4) >>> 0,
    memAddr: aluResult >>> 0,
    memWriteData: opB,
    wbReg: ctrl.regWrite ? instr.rd : 0,
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

export function writebackValue(ctrl: Control, aluResult: number, memReadData: number, pc4: number): number {
  switch (ctrl.wbSrc) {
    case 'ALU': return aluResult;
    case 'MEM': return memReadData;
    case 'PC4': return pc4;
    case 'NONE': return 0;
  }
}

export { control };
