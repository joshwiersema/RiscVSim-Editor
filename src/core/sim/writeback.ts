/**
 * Write-back / commit, shared by both processors: traps, CSR access, FP flag
 * accrual, the register write, and system calls all take effect here, in
 * program order.
 */
import { applyCsr, csrAccess, type CsrAccess } from './csr';
import { performEcall, type EcallResult } from './ecall';
import { writebackValue } from './execute';
import type { CoreState } from './processor';
import type { InstrTrace, RegWrite } from './types';

export type Retiring = Omit<InstrTrace, 'wbValue' | 'ecall' | 'csrOp'>;

export interface Commit {
  readonly wbValue: number;
  readonly regWrite: RegWrite | null;
  readonly ecall: EcallResult | null;
  readonly csrOp: CsrAccess | null;
}

const NOTHING: Commit = { wbValue: 0, regWrite: null, ecall: null, csrOp: null };

function halt(c: CoreState, error: string): Commit {
  c.error = error;
  c.finished = true;
  return NOTHING;
}

export function commit(c: CoreState, t: Retiring): Commit {
  if (t.trap) return halt(c, `${t.trap} (PC 0x${t.pc.toString(16)})`);
  let csrOp: CsrAccess | null = null;
  if (t.ctrl.csr) {
    csrOp = csrAccess(c, t.instr, t.ctrl, t.opA);
    if (csrOp.error) return halt(c, `${csrOp.error} (PC 0x${t.pc.toString(16)})`);
    applyCsr(c, csrOp);
  }
  c.fcsr |= t.fpFlags;

  const wbValue = writebackValue(t.ctrl, t.aluResult, t.memReadData, t.pc4, csrOp?.old ?? 0);
  let regWrite: RegWrite | null = null;
  if (t.ctrl.regWrite) {
    regWrite = { reg: t.wbReg, value: wbValue, prev: c.regs[t.wbReg] };
    c.regs[t.wbReg] = wbValue;
  }

  const ecall = t.ctrl.system === 'ECALL' ? performEcall(c.regs, c.mem) : null;
  if (ecall?.exit) { c.finished = true; c.exitCode = ecall.exitCode; }
  if (ecall?.input) c.pendingInput = ecall.input;
  if (t.ctrl.system === 'EBREAK') c.finished = true;
  return { wbValue, regWrite, ecall, csrOp };
}
