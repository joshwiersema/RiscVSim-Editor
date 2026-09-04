import type { Decoded } from '../isa/decode';
import type { AluOp, BranchCond, MemWidth } from '../isa/instructions';

/**
 * The control-unit outputs for one instruction. These are the classic
 * Patterson & Hennessy signals, with a few extras (ALUSrcA for auipc/jal,
 * a 3-way WB mux) so the datapath is complete for RV32IM.
 */
export interface Control {
  readonly valid: boolean;
  readonly regWrite: boolean;
  readonly aluSrcA: 'REG' | 'PC';
  readonly aluSrcB: 'REG' | 'IMM';
  readonly aluOp: AluOp;
  readonly memRead: MemWidth | null;
  readonly memWrite: MemWidth | null;
  readonly wbSrc: 'ALU' | 'MEM' | 'PC4' | 'NONE';
  readonly branch: BranchCond | null;
  readonly jump: 'JAL' | 'JALR' | null;
  readonly system: 'ECALL' | 'EBREAK' | null;
}

export const BUBBLE_CONTROL: Control = {
  valid: false, regWrite: false, aluSrcA: 'REG', aluSrcB: 'REG', aluOp: 'ADD',
  memRead: null, memWrite: null, wbSrc: 'NONE', branch: null, jump: null, system: null,
};

export function control(d: Decoded): Control {
  const def = d.def;
  if (!def) return BUBBLE_CONTROL;
  return {
    valid: true,
    regWrite: def.regWrite && d.rd !== 0,
    aluSrcA: def.aluSrcA,
    aluSrcB: def.aluSrcB,
    aluOp: def.alu,
    memRead: def.memRead ?? null,
    memWrite: def.memWrite ?? null,
    wbSrc: def.regWrite ? def.wbSrc : 'NONE',
    branch: def.branch ?? null,
    jump: def.jump ?? null,
    system: def.system ?? null,
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
