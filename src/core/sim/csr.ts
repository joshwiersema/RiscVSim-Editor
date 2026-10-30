/**
 * The CSR unit. CSR instructions read and update their register at
 * write-back, so they see every older instruction's accrued FP flags and
 * never act on behalf of a squashed instruction.
 */
import { CSR, csrName, csrReadOnly } from '../isa/csr';
import type { Control } from './control';
import type { Decoded } from '../isa/decode';

const FFLAGS_MASK = 0x1f;
const FRM_SHIFT = 5;
const FRM_MASK = 0x7;
const FCSR_MASK = 0xff;
const WORD = 2 ** 32;

/** The architectural state CSRs expose. */
export interface CsrState {
  fcsr: number;
  readonly cycle: number;
  readonly stats: { readonly instructions: number };
}

export interface CsrAccess {
  readonly addr: number;
  /** Value read (written to rd). */
  readonly old: number;
  /** Value written back, or null when the instruction only reads. */
  readonly next: number | null;
  readonly error: string | null;
}

export function frmOf(fcsr: number): number {
  return (fcsr >>> FRM_SHIFT) & FRM_MASK;
}

function readCsr(s: CsrState, addr: number): number | null {
  switch (addr) {
    case CSR.FFLAGS: return s.fcsr & FFLAGS_MASK;
    case CSR.FRM: return frmOf(s.fcsr);
    case CSR.FCSR: return s.fcsr & FCSR_MASK;
    case CSR.CYCLE: case CSR.TIME: return s.cycle % WORD | 0;
    case CSR.CYCLEH: case CSR.TIMEH: return Math.floor(s.cycle / WORD) | 0;
    case CSR.INSTRET: return s.stats.instructions % WORD | 0;
    case CSR.INSTRETH: return Math.floor(s.stats.instructions / WORD) | 0;
    default: return null;
  }
}

/** Work out a CSR instruction's effect without applying it. */
export function csrAccess(s: CsrState, instr: Decoded, ctrl: Control, rs1Value: number): CsrAccess {
  const addr = instr.imm & 0xfff;
  const old = readCsr(s, addr);
  if (old === null) return { addr, old: 0, next: null, error: `Illegal instruction: CSR ${csrName(addr)} is not implemented` };
  const src = ctrl.csrImm ? instr.rs1 : rs1Value;
  // csrrs/csrrc with x0 (or a zero immediate) are pure reads.
  const writes = ctrl.csr === 'RW' || instr.rs1 !== 0;
  if (!writes) return { addr, old, next: null, error: null };
  if (csrReadOnly(addr)) return { addr, old, next: null, error: `Illegal instruction: ${csrName(addr)} is read-only` };
  const next = ctrl.csr === 'RW' ? src : ctrl.csr === 'RS' ? old | src : old & ~src;
  return { addr, old, next: next | 0, error: null };
}

/** Apply a successful access to the CSR state. */
export function applyCsr(s: CsrState, a: CsrAccess): void {
  if (a.next === null || a.error) return;
  switch (a.addr) {
    case CSR.FFLAGS: s.fcsr = (s.fcsr & ~FFLAGS_MASK) | (a.next & FFLAGS_MASK); break;
    case CSR.FRM: s.fcsr = (s.fcsr & FFLAGS_MASK) | ((a.next & FRM_MASK) << FRM_SHIFT); break;
    case CSR.FCSR: s.fcsr = a.next & FCSR_MASK; break;
    default: break;
  }
}
