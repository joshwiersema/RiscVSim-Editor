import { control } from './control';
import { frmOf } from './csr';
import { executeStage, fetchDecode, memoryStage, readSources } from './execute';
import { commit } from './writeback';
import type { CoreState, Processor } from './processor';
import type { CycleTrace, InstrTrace, MemWrite, RegWrite, StageSlot } from './types';

const EMPTY: StageSlot = { trace: null, note: null };

/** Single-cycle RV32IMF: one instruction per clock, everything combinational. */
export class SingleCycleProcessor implements Processor {
  readonly kind = 'single' as const;
  constructor(readonly core: CoreState) {}

  step(): CycleTrace {
    const c = this.core;
    const pcBefore = c.pc;
    const instr = fetchDecode(c.mem, c.pc);
    const ctrl = control(instr);
    const cycle = ++c.cycle;
    c.stats = { ...c.stats, cycles: cycle };

    if (!ctrl.valid) {
      c.finished = true;
      c.error = `Illegal instruction 0x${instr.word.toString(16).padStart(8, '0')} at PC 0x${c.pc.toString(16)}`;
      return emptyCycle(cycle, pcBefore, c.pc, c.error);
    }

    const { rs1Val, rs2Val, rs3Val } = readSources(c.regs, instr);
    const ex = executeStage({ seq: ++c.fetchSeq, pc: c.pc, instr, ctrl, rs1Val, rs2Val, rs3Val, opA: rs1Val, opB: rs2Val, opC: rs3Val, frm: frmOf(c.fcsr) });
    // A trapping instruction must not touch memory.
    const mem = ex.trap ? { readData: 0, write: null } : memoryStage(c.mem, ex);
    const done = commit(c, { ...ex, memReadData: mem.readData });

    const regWrites: RegWrite[] = done.regWrite ? [done.regWrite] : [];
    const memWrites: MemWrite[] = mem.write ? [mem.write] : [];
    const { ecall } = done;

    const trace: InstrTrace = { ...ex, memReadData: mem.readData, wbValue: done.wbValue, ecall, csrOp: done.csrOp };
    if (!c.error) c.pc = ex.nextPc; // a trap leaves the PC on the faulting instruction
    if (c.pc >= c.textEnd) c.finished = true;
    c.stats = { ...c.stats, instructions: c.stats.instructions + 1 };

    const slot: StageSlot = { trace, note: null };
    return {
      cycle, model: 'single',
      stages: { IF: slot, ID: slot, EX: slot, MEM: slot, WB: slot },
      hazard: { stall: false, flush: false, reason: null },
      regWrites, memWrites, output: ecall?.output ?? '',
      pcBefore, pcAfter: c.pc, retired: 1,
    };
  }

  saveMicroState(): unknown { return null; }
  restoreMicroState(): void { /* no pipeline registers */ }
  pcsInFlight(): number[] { return this.core.finished ? [] : [this.core.pc]; }
}

function emptyCycle(cycle: number, pcBefore: number, pcAfter: number, _note: string): CycleTrace {
  return {
    cycle, model: 'single',
    stages: { IF: EMPTY, ID: EMPTY, EX: EMPTY, MEM: EMPTY, WB: EMPTY },
    hazard: { stall: false, flush: false, reason: null },
    regWrites: [], memWrites: [], output: '', pcBefore, pcAfter, retired: 0,
  };
}
