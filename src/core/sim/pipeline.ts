import { usesRs1, usesRs2, type Decoded } from '../isa/decode';
import { regName } from '../isa/registers';
import { control, type Control } from './control';
import { performEcall } from './ecall';
import { executeStage, fetchDecode, memoryStage, writebackValue } from './execute';
import type { CoreState, Processor, ProcessorOptions } from './processor';
import type { CycleTrace, ForwardSrc, HazardInfo, InstrTrace, MemWrite, RegWrite, StageSlot } from './types';

/** Pipeline register contents. Immutable records; null = bubble. */
interface IfId { readonly seq: number; readonly pc: number; readonly instr: Decoded }
interface IdEx { readonly seq: number; readonly pc: number; readonly instr: Decoded; readonly ctrl: Control; readonly rs1Val: number; readonly rs2Val: number }
type ExMem = Omit<InstrTrace, 'memReadData' | 'wbValue' | 'ecall'>;
type MemWb = Omit<InstrTrace, 'wbValue' | 'ecall'>;

interface Regs {
  readonly ifid: IfId | null;
  readonly idex: IdEx | null;
  readonly exmem: ExMem | null;
  readonly memwb: MemWb | null;
  readonly notes: { readonly ifid: string | null; readonly idex: string | null; readonly exmem: string | null; readonly memwb: string | null };
}

const EMPTY_NOTES: Regs["notes"] = { ifid: null, idex: null, exmem: null, memwb: null };

/**
 * Classic 5-stage in-order pipeline (IF, ID, EX, MEM, WB) with
 * EX/MEM -> EX and MEM/WB -> EX forwarding, load-use stall detection, and
 * branches resolved in EX with a two-instruction flush (predict not-taken).
 * Register file writes in the first half of the cycle, so WB->ID needs no
 * forwarding.
 */
export class PipelineProcessor implements Processor {
  readonly kind = 'pipeline' as const;
  private regsP: Regs = { ifid: null, idex: null, exmem: null, memwb: null, notes: EMPTY_NOTES };

  constructor(readonly core: CoreState, readonly options: ProcessorOptions) {}

  saveMicroState(): unknown { return this.regsP; }
  restoreMicroState(s: unknown): void { this.regsP = s as Regs; }

  pcsInFlight(): number[] {
    const r = this.regsP;
    const list = [r.memwb?.pc, r.exmem?.pc, r.idex?.pc, r.ifid?.pc];
    if (!this.core.finished && this.core.pc < this.core.textEnd) list.push(this.core.pc);
    return list.filter((p): p is number => p !== undefined);
  }

  step(): CycleTrace {
    const c = this.core;
    const p = this.regsP;
    const cycle = ++c.cycle;
    const pcBefore = c.pc;
    const regWrites: RegWrite[] = [];
    const memWrites: MemWrite[] = [];
    let output = '';
    let retired = 0;

    // ---- WB (writes first, so ID below sees the new value) --------------
    let wbSlot: StageSlot = { trace: null, note: p.notes.memwb };
    /** Set when an ecall needs console input: younger instructions are squashed (precise trap). */
    let trapRedirect: number | null = null;
    if (p.memwb) {
      const t = p.memwb;
      const wbValue = writebackValue(t.ctrl, t.aluResult, t.memReadData, t.pc4);
      if (t.ctrl.regWrite) {
        regWrites.push({ reg: t.instr.rd, value: wbValue, prev: c.regs[t.instr.rd] });
        c.regs[t.instr.rd] = wbValue;
      }
      let ecall = null;
      if (t.ctrl.system === 'ECALL') {
        ecall = performEcall(c.regs, c.mem);
        output += ecall.output;
        if (ecall.exit) { c.finished = true; c.exitCode = ecall.exitCode; }
        if (ecall.input) { c.pendingInput = ecall.input; trapRedirect = t.pc4; }
      }
      if (t.ctrl.system === 'EBREAK') c.finished = true;
      wbSlot = { trace: { ...t, wbValue, ecall }, note: null };
      retired = 1;
    }

    // ---- MEM ------------------------------------------------------------
    let memSlot: StageSlot = { trace: null, note: p.notes.exmem };
    let nextMemWb: MemWb | null = null;
    if (trapRedirect !== null) {
      // The trap squashes everything younger before it can take effect.
      const note = 'squashed: the ecall in WB is waiting for input, so this instruction will be re-fetched afterwards';
      const squash = (t: InstrTrace | null): StageSlot => ({ trace: t, note });
      const partialOf = (r: { pc: number; instr: Decoded; seq: number } | null): InstrTrace | null =>
        r ? { ...executeStage({ seq: r.seq, pc: r.pc, instr: r.instr, ctrl: control(r.instr), rs1Val: 0, rs2Val: 0, opA: 0, opB: 0 }), memReadData: 0, wbValue: 0, ecall: null } : null;
      const reason = 'Trap: the ecall reaching WB needs console input. Like a real precise exception, every younger instruction in the pipeline is squashed and execution resumes at the next instruction once the input arrives.';
      this.regsP = { ifid: null, idex: null, exmem: null, memwb: null, notes: { ifid: 'squashed (ecall trap)', idex: 'squashed (ecall trap)', exmem: 'squashed (ecall trap)', memwb: null } };
      c.pc = trapRedirect >>> 0;
      c.stats = { ...c.stats, cycles: cycle, instructions: c.stats.instructions + retired, flushes: c.stats.flushes + 1 };
      return {
        cycle, model: 'pipeline',
        stages: { IF: { trace: null, note }, ID: squash(partialOf(p.ifid)), EX: squash(partialOf(p.idex)), MEM: squash(p.exmem ? { ...p.exmem, memReadData: 0, wbValue: 0, ecall: null } : null), WB: wbSlot },
        hazard: { stall: false, flush: true, reason }, regWrites, memWrites, output, pcBefore, pcAfter: c.pc, retired,
      };
    }
    if (p.exmem) {
      const r = memoryStage(c.mem, p.exmem);
      if (r.write) memWrites.push(r.write);
      nextMemWb = { ...p.exmem, memReadData: r.readData };
      memSlot = { trace: { ...nextMemWb, wbValue: writebackValue(p.exmem.ctrl, p.exmem.aluResult, r.readData, p.exmem.pc4), ecall: null }, note: null };
    }

    // ---- EX (forwarding from EX/MEM and MEM/WB) --------------------------
    let exSlot: StageSlot = { trace: null, note: p.notes.idex };
    let nextExMem: ExMem | null = null;
    let takenBranch = false;
    let branchTarget = 0;
    if (p.idex) {
      const { fwdA, fwdB, opA, opB } = this.forward(p.idex, p.exmem, p.memwb);
      const ex = executeStage({ ...p.idex, fwdA, fwdB, opA, opB });
      nextExMem = ex;
      takenBranch = ex.pcSrc === 'TARGET';
      branchTarget = ex.nextPc;
      exSlot = { trace: { ...ex, memReadData: 0, wbValue: 0, ecall: null }, note: null };
    }

    // ---- ID (decode, register read, hazard detection) --------------------
    let idSlot: StageSlot = { trace: null, note: p.notes.ifid };
    let nextIdEx: IdEx | null = null;
    let hazard: HazardInfo = { stall: false, flush: false, reason: null };
    if (p.ifid) {
      const { seq, pc, instr } = p.ifid;
      const ctrl = control(instr);
      if (!ctrl.valid) {
        c.finished = true;
        c.error = `Illegal instruction 0x${instr.word.toString(16).padStart(8, '0')} at PC 0x${pc.toString(16)}`;
      }
      const rs1Val = c.regs[instr.rs1];
      const rs2Val = c.regs[instr.rs2];
      nextIdEx = { seq, pc, instr, ctrl, rs1Val, rs2Val };
      hazard = this.detectHazard(instr, p.idex, p.exmem);
      const partial = executeStage({ seq, pc, instr, ctrl, rs1Val, rs2Val, opA: rs1Val, opB: rs2Val });
      idSlot = { trace: { ...partial, memReadData: 0, wbValue: 0, ecall: null }, note: hazard.stall ? hazard.reason : null };
    }

    // ---- IF -------------------------------------------------------------
    let ifSlot: StageSlot = { trace: null, note: null };
    let fetched: IfId | null = null;
    if (c.pc < c.textEnd) {
      const instr = fetchDecode(c.mem, c.pc);
      // During a stall the PC is frozen and this same fetch repeats next cycle,
      // so only consume a sequence number when the fetch actually advances.
      const seq = hazard.stall ? c.fetchSeq + 1 : ++c.fetchSeq;
      fetched = { seq, pc: c.pc, instr };
      const ctrl = control(instr);
      const partial = executeStage({ seq, pc: c.pc, instr, ctrl, rs1Val: 0, rs2Val: 0, opA: 0, opB: 0 });
      ifSlot = { trace: { ...partial, memReadData: 0, wbValue: 0, ecall: null }, note: null };
    } else {
      ifSlot = { trace: null, note: 'PC is past the end of the program; nothing to fetch.' };
    }

    // ---- Clock edge: advance pipeline registers --------------------------
    let notes: Regs["notes"] = { ...EMPTY_NOTES };
    let nextRegs: Regs;
    if (takenBranch) {
      const reason = `Control hazard: the ${exSlot.trace?.instr.def?.name ?? 'jump'} in EX redirected the PC to 0x${branchTarget.toString(16)}. The two instructions fetched after it were wrong-path, so IF/ID and ID/EX are flushed.`;
      hazard = { stall: false, flush: true, reason };
      notes = { ifid: 'flushed (wrong-path after taken branch)', idex: 'flushed (wrong-path after taken branch)', exmem: null, memwb: null };
      nextRegs = { ifid: null, idex: null, exmem: nextExMem, memwb: nextMemWb, notes };
      c.pc = branchTarget;
      c.stats = { ...c.stats, flushes: c.stats.flushes + 1 };
    } else if (hazard.stall) {
      notes = { ifid: null, idex: 'bubble inserted by hazard unit (stall)', exmem: null, memwb: null };
      nextRegs = { ifid: p.ifid, idex: null, exmem: nextExMem, memwb: nextMemWb, notes };
      c.stats = { ...c.stats, stalls: c.stats.stalls + 1 };
    } else {
      notes = { ifid: fetched ? null : 'no instruction fetched (end of program)', idex: null, exmem: null, memwb: null };
      nextRegs = { ifid: fetched, idex: nextIdEx, exmem: nextExMem, memwb: nextMemWb, notes };
      if (fetched) c.pc = (c.pc + fetched.instr.size) >>> 0;
    }
    this.regsP = nextRegs;

    c.stats = { ...c.stats, cycles: cycle, instructions: c.stats.instructions + retired };
    const drained = !nextRegs.ifid && !nextRegs.idex && !nextRegs.exmem && !nextRegs.memwb;
    if (drained && c.pc >= c.textEnd) c.finished = true;

    return {
      cycle, model: 'pipeline',
      stages: { IF: ifSlot, ID: idSlot, EX: exSlot, MEM: memSlot, WB: wbSlot },
      hazard, regWrites, memWrites, output, pcBefore, pcAfter: c.pc, retired,
    };
  }

  /** Forwarding unit: pick EX operands from the newest in-flight producer. */
  private forward(idex: IdEx, exmem: ExMem | null, memwb: MemWb | null): { fwdA: ForwardSrc; fwdB: ForwardSrc; opA: number; opB: number } {
    const pick = (rs: number, used: boolean): { src: ForwardSrc; val: number } => {
      const regVal = rs === idex.instr.rs1 ? idex.rs1Val : idex.rs2Val;
      if (!this.options.forwarding || !used || rs === 0) return { src: 'NONE', val: regVal };
      if (exmem && exmem.ctrl.regWrite && exmem.instr.rd === rs && !exmem.ctrl.memRead) {
        return { src: 'EXMEM', val: exmem.ctrl.wbSrc === 'PC4' ? exmem.pc4 : exmem.aluResult };
      }
      if (memwb && memwb.ctrl.regWrite && memwb.instr.rd === rs) {
        return { src: 'MEMWB', val: writebackValue(memwb.ctrl, memwb.aluResult, memwb.memReadData, memwb.pc4) };
      }
      return { src: 'NONE', val: regVal };
    };
    const a = pick(idex.instr.rs1, usesRs1(idex.instr));
    const b = pick(idex.instr.rs2, usesRs2(idex.instr) || idex.ctrl.memWrite !== null);
    return { fwdA: a.src, fwdB: b.src, opA: a.val, opB: b.val };
  }

  /** Hazard detection unit, evaluated for the instruction in ID. */
  private detectHazard(instr: Decoded, idex: IdEx | null, exmem: ExMem | null): HazardInfo {
    if (!this.options.hazardDetection) return { stall: false, flush: false, reason: null };
    const rs1 = usesRs1(instr) ? instr.rs1 : -1;
    const rs2 = usesRs2(instr) ? instr.rs2 : -1;
    const hits = (rd: number) => rd !== 0 && (rd === rs1 || rd === rs2);
    const name = instr.def?.name ?? '?';

    if (idex && idex.ctrl.memRead && hits(idex.instr.rd)) {
      return {
        stall: true, flush: false,
        reason: `Load-use hazard: ${name} needs ${regName(idex.instr.rd)}, but the ${idex.instr.def?.name} ahead of it is still in EX and its data will not come out of memory until the end of MEM. Even forwarding cannot help yet, so the pipeline stalls one cycle.`,
      };
    }
    if (!this.options.forwarding) {
      if (idex && idex.ctrl.regWrite && hits(idex.instr.rd)) {
        return { stall: true, flush: false, reason: `Data hazard: ${name} reads ${regName(idex.instr.rd)}, which ${idex.instr.def?.name} (in EX) has not written back yet. Forwarding is disabled, so the pipeline stalls until it reaches WB.` };
      }
      if (exmem && exmem.ctrl.regWrite && hits(exmem.instr.rd)) {
        return { stall: true, flush: false, reason: `Data hazard: ${name} reads ${regName(exmem.instr.rd)}, which ${exmem.instr.def?.name} (in MEM) has not written back yet. Forwarding is disabled, so the pipeline stalls until it reaches WB.` };
      }
    }
    return { stall: false, flush: false, reason: null };
  }
}
