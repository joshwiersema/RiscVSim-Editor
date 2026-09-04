import { control } from './control';
import { performEcall } from './ecall';
import { executeStage, fetchDecode, memoryStage, writebackValue } from './execute';
import type { CoreState, Processor } from './processor';
import type { CycleTrace, InstrTrace, MemWrite, RegWrite, StageSlot } from './types';

const EMPTY: StageSlot = { trace: null, note: null };

/** Single-cycle RV32IM: one instruction per clock, everything combinational. */
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

    const rs1Val = c.regs[instr.rs1];
    const rs2Val = c.regs[instr.rs2];
    const ex = executeStage({ seq: ++c.fetchSeq, pc: c.pc, instr, ctrl, rs1Val, rs2Val, opA: rs1Val, opB: rs2Val });
    const mem = memoryStage(c.mem, ex);
    const wbValue = writebackValue(ctrl, ex.aluResult, mem.readData, ex.pc4);

    const regWrites: RegWrite[] = [];
    if (ctrl.regWrite) {
      regWrites.push({ reg: instr.rd, value: wbValue, prev: c.regs[instr.rd] });
      c.regs[instr.rd] = wbValue;
    }
    const memWrites: MemWrite[] = mem.write ? [mem.write] : [];

    const ecall = ctrl.system === 'ECALL' ? performEcall(c.regs, c.mem) : null;
    if (ecall?.exit) { c.finished = true; c.exitCode = ecall.exitCode; }
    if (ecall?.input) c.pendingInput = ecall.input;
    if (ctrl.system === 'EBREAK') { c.finished = true; }

    const trace: InstrTrace = { ...ex, memReadData: mem.readData, wbValue, ecall };
    c.pc = ex.nextPc;
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
