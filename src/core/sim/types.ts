import type { Decoded } from '../isa/decode';
import type { Control } from './control';
import type { EcallResult } from './ecall';
import type { CsrAccess } from './csr';

export type ForwardSrc = 'NONE' | 'EXMEM' | 'MEMWB';

/**
 * Everything the datapath computed for one instruction. Single-cycle uses the
 * whole record at once; the pipeline fills it in stage by stage.
 */
export interface InstrTrace {
  /** Fetch sequence number: uniquely identifies this dynamic instruction instance. */
  readonly seq: number;
  readonly pc: number;
  readonly pc4: number;
  readonly instr: Decoded;
  readonly ctrl: Control;
  readonly rs1Val: number;
  readonly rs2Val: number;
  /** Third source (f register rs3) for fused multiply-add; 0 otherwise. */
  readonly rs3Val: number;
  readonly imm: number;
  /** Operand values after forwarding muxes (pipeline) — identical to rs*Val in single-cycle. */
  readonly fwdA: ForwardSrc;
  readonly fwdB: ForwardSrc;
  readonly fwdC: ForwardSrc;
  readonly opA: number;
  readonly opB: number;
  readonly opC: number;
  readonly aluA: number;
  readonly aluB: number;
  readonly aluResult: number;
  /** FP exception flags (fflags bits) raised by the FPU; accrued into fcsr at write-back. */
  readonly fpFlags: number;
  /** Rounding-mode encoding the FPU used (0..4), or null if it did not round. */
  readonly fpRm: number | null;
  /** Set when executing this instruction must trap (e.g. invalid dynamic rounding mode). */
  readonly trap: string | null;
  /** PC + imm, the branch/jal target computed by the dedicated adder. */
  readonly branchTarget: number;
  readonly branchCondMet: boolean;
  /** Final decision: PC <- target instead of PC+4. */
  readonly pcSrc: 'PC4' | 'TARGET';
  readonly nextPc: number;
  readonly memAddr: number;
  readonly memReadData: number;
  readonly memWriteData: number;
  readonly wbValue: number;
  /** Destination as a unified register index (f registers are 32..63). */
  readonly wbReg: number;
  readonly ecall: EcallResult | null;
  /** The CSR read-modify-write performed at write-back, if any. */
  readonly csrOp: CsrAccess | null;
}

/** reg is a unified index: x registers 0..31, f registers 32..63. */
export interface RegWrite { readonly reg: number; readonly value: number; readonly prev: number }
export interface MemWrite { readonly addr: number; readonly width: 1 | 2 | 4; readonly value: number; readonly prev: number }

export interface StageSlot {
  /** null means a bubble/no instruction in this stage this cycle. */
  readonly trace: InstrTrace | null;
  /** Why this slot is a bubble or was squashed, for narration. */
  readonly note: string | null;
}

export interface HazardInfo {
  readonly stall: boolean;
  readonly flush: boolean;
  readonly reason: string | null;
}

/** One clock cycle of whichever processor is running. */
export interface CycleTrace {
  readonly cycle: number;
  readonly model: 'single' | 'pipeline';
  readonly stages: {
    readonly IF: StageSlot;
    readonly ID: StageSlot;
    readonly EX: StageSlot;
    readonly MEM: StageSlot;
    readonly WB: StageSlot;
  };
  readonly hazard: HazardInfo;
  readonly regWrites: readonly RegWrite[];
  readonly memWrites: readonly MemWrite[];
  readonly output: string;
  readonly pcBefore: number;
  readonly pcAfter: number;
  readonly retired: number;
}

export interface Stats {
  readonly cycles: number;
  readonly instructions: number;
  readonly stalls: number;
  readonly flushes: number;
}
