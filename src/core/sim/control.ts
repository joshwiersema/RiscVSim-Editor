import type { Decoded } from '../isa/decode';
import type { AluOp, BranchCond, MemWidth } from '../isa/instructions';
import { rdWritable } from '../isa/operands';
import type { FpuOp } from '../fp/fpu';

/**
 * The control-unit outputs for one instruction. These are the classic
 * Patterson & Hennessy signals, with a few extras (ALUSrcA for auipc/jal,
 * a WB mux that also selects CSR read data) so the datapath is complete for
 * RV32IMF + Zicsr.
 */
export interface Control {
  readonly valid: boolean;
  readonly regWrite: boolean;
  readonly aluSrcA: 'REG' | 'PC';
  readonly aluSrcB: 'REG' | 'IMM';
  readonly aluOp: AluOp;
  readonly memRead: MemWidth | null;
  readonly memWrite: MemWidth | null;
  readonly wbSrc: 'ALU' | 'MEM' | 'PC4' | 'CSR' | 'NONE';
  readonly branch: BranchCond | null;
  readonly jump: 'JAL' | 'JALR' | null;
  readonly system: 'ECALL' | 'EBREAK' | null;
  /** FPU operation; when set the FPU, not the ALU, produces the EX result. */
  readonly fpuOp: FpuOp | null;
  readonly csr: 'RW' | 'RS' | 'RC' | null;
  readonly csrImm: boolean;
}

export const BUBBLE_CONTROL: Control = {
  valid: false, regWrite: false, aluSrcA: 'REG', aluSrcB: 'REG', aluOp: 'ADD',
  memRead: null, memWrite: null, wbSrc: 'NONE', branch: null, jump: null, system: null,
  fpuOp: null, csr: null, csrImm: false,
};

export function control(d: Decoded): Control {
  const def = d.def;
  if (!def) return BUBBLE_CONTROL;
  return {
    valid: true,
    regWrite: def.regWrite && rdWritable(d),
    aluSrcA: def.aluSrcA,
    aluSrcB: def.aluSrcB,
    aluOp: def.alu,
    memRead: def.memRead ?? null,
    memWrite: def.memWrite ?? null,
    wbSrc: def.regWrite ? def.wbSrc : 'NONE',
    branch: def.branch ?? null,
    jump: def.jump ?? null,
    system: def.system ?? null,
    fpuOp: def.fpu ?? null,
    csr: def.csr ?? null,
    csrImm: def.csrImm ?? false,
  };
}

export function memWidthBytes(w: MemWidth): 1 | 2 | 4 {
  return w === 'B' || w === 'BU' ? 1 : w === 'H' || w === 'HU' ? 2 : 4;
}

export function extendLoad(w: MemWidth, raw: number): number {
  switch (w) {
    case 'B': return (raw << 24) >> 24;
    case 'H': return (raw << 16) >> 16;
    case 'BU': return raw & 0xff;
    case 'HU': return raw & 0xffff;
    case 'W': return raw | 0;
  }
}
