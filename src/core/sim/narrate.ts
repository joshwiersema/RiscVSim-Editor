import { disassemble } from '../isa/decode';
import { regName } from '../isa/registers';
import { hex32 } from '../util/format';
import { aluSymbol } from './alu';
import type { CycleTrace, InstrTrace } from './types';

export type StageName = 'IF' | 'ID' | 'EX' | 'MEM' | 'WB';
export const STAGES: readonly StageName[] = ['IF', 'ID', 'EX', 'MEM', 'WB'];

export interface StageStory {
  readonly stage: StageName;
  readonly headline: string;
  readonly instr: string | null;
  readonly lines: readonly string[];
  readonly kind: 'active' | 'bubble' | 'stall' | 'flush';
}

export interface CycleStory {
  readonly title: string;
  readonly summary: string;
  readonly stages: readonly StageStory[];
}

const d = (v: number) => String(v | 0);
const r = regName;

function asmText(t: InstrTrace, labelFor?: (a: number) => string | undefined): string {
  return disassemble(t.instr, t.pc, labelFor);
}

function ifStory(t: InstrTrace): string[] {
  return [
    `PC = ${hex32(t.pc)} is sent to instruction memory, which returns ${hex32(t.instr.word)}.`,
    `${t.instr.compressed ? `The low bits mark a 16-bit compressed instruction; the decompressor expands ${t.instr.compressed.name} into ${t.instr.def?.name}. ` : ''}The PC adder computes PC + ${t.instr.size} = ${hex32(t.pc4)} for the next sequential instruction.`,
  ];
}

function idStory(t: InstrTrace): string[] {
  const lines = [
    `Opcode ${t.instr.opcode.toString(2).padStart(7, '0')} identifies \`${t.instr.def?.name}\` (${t.instr.format}-type); the control unit sets its signals.`,
  ];
  const reads: string[] = [];
  if (t.instr.format !== 'U' && t.instr.format !== 'J' && !t.ctrl.system) reads.push(`${r(t.instr.rs1)} = ${d(t.rs1Val)}`);
  if (t.instr.format === 'R' || t.instr.format === 'S' || t.instr.format === 'B') reads.push(`${r(t.instr.rs2)} = ${d(t.rs2Val)}`);
  if (reads.length) lines.push(`Register file reads ${reads.join(' and ')}.`);
  if (t.instr.format !== 'R' && !t.ctrl.system) lines.push(`Immediate generator produces ${d(t.imm)} (${hex32(t.imm)}).`);
  return lines;
}

function exStory(t: InstrTrace, model: 'single' | 'pipeline'): string[] {
  const lines: string[] = [];
  if (model === 'pipeline' && (t.fwdA !== 'NONE' || t.fwdB !== 'NONE')) {
    const parts = [];
    if (t.fwdA !== 'NONE') parts.push(`${r(t.instr.rs1)} forwarded from ${t.fwdA === 'EXMEM' ? 'EX/MEM' : 'MEM/WB'} (${d(t.opA)})`);
    if (t.fwdB !== 'NONE') parts.push(`${r(t.instr.rs2)} forwarded from ${t.fwdB === 'EXMEM' ? 'EX/MEM' : 'MEM/WB'} (${d(t.opB)})`);
    lines.push(`Forwarding: ${parts.join('; ')}.`);
  }
  const c = t.ctrl;
  if (c.memRead || c.memWrite) lines.push(`ALU adds base ${r(t.instr.rs1)} (${d(t.aluA)}) + offset ${d(t.aluB)} = address ${hex32(t.aluResult)}.`);
  else if (c.branch) {
    lines.push(`Comparator checks ${r(t.instr.rs1)} (${d(t.opA)}) vs ${r(t.instr.rs2)} (${d(t.opB)}): condition is ${t.branchCondMet ? 'TRUE' : 'FALSE'}.`);
    lines.push(`Branch adder computes PC + ${d(t.imm)} = ${hex32(t.branchTarget)}. ${t.branchCondMet ? `PC will be redirected there.` : 'Not taken; PC continues to PC+4.'}`);
  } else if (c.jump === 'JAL') lines.push(`Branch adder computes the jump target PC + ${d(t.imm)} = ${hex32(t.branchTarget)}; PC will jump there.`);
  else if (c.jump === 'JALR') lines.push(`ALU computes ${r(t.instr.rs1)} (${d(t.aluA)}) + ${d(t.aluB)} = ${hex32(t.aluResult)}; the PC will jump there.`);
  else if (c.aluOp === 'COPY_B') lines.push(`ALU passes the immediate through: ${hex32(t.aluResult)}.`);
  else lines.push(`ALU computes ${d(t.aluA)} ${aluSymbol(c.aluOp)} ${d(t.aluB)} = ${d(t.aluResult)} (${hex32(t.aluResult)}).`);
  return lines;
}

function memStory(t: InstrTrace): string[] {
  const c = t.ctrl;
  if (c.memRead) return [`Data memory reads ${hex32(t.memAddr)} → ${d(t.memReadData)} (${hex32(t.memReadData)}).`];
  if (c.memWrite) return [`Data memory writes ${d(t.memWriteData)} (${hex32(t.memWriteData)}) to ${hex32(t.memAddr)}.`];
  return ['No memory access; the ALU result passes straight through.'];
}

function wbStory(t: InstrTrace): string[] {
  const c = t.ctrl;
  const lines: string[] = [];
  if (c.regWrite) lines.push(`${r(t.instr.rd)} ← ${d(t.wbValue)} (${hex32(t.wbValue)}) from ${c.wbSrc === 'MEM' ? 'memory' : c.wbSrc === 'PC4' ? 'PC+4' : 'the ALU'}.`);
  else if (t.instr.def?.regWrite && t.instr.rd === 0) lines.push('Destination is x0, so the result is discarded.');
  else lines.push('Nothing to write back.');
  if (t.ecall) lines.push(`ecall #${t.ecall.code}: ${t.ecall.description}.`);
  return lines;
}

const STAGE_TITLES: Record<StageName, string> = {
  IF: 'Instruction Fetch', ID: 'Instruction Decode & Register Read', EX: 'Execute', MEM: 'Memory Access', WB: 'Write Back',
};

/** Build the narrative for one cycle. */
export function narrate(trace: CycleTrace, labelFor?: (a: number) => string | undefined): CycleStory {
  const stages: StageStory[] = STAGES.map((s) => {
    const slot = trace.stages[s];
    const t = slot.trace;
    if (!t) {
      const isFlush = (slot.note ?? '').includes('flush');
      const isStall = (slot.note ?? '').includes('bubble');
      return { stage: s, headline: STAGE_TITLES[s], instr: null, lines: [slot.note ?? 'Empty (bubble).'], kind: isFlush ? 'flush' : isStall ? 'stall' : 'bubble' };
    }
    const bodies: Record<StageName, string[]> = {
      IF: ifStory(t), ID: idStory(t), EX: exStory(t, trace.model), MEM: memStory(t), WB: wbStory(t),
    };
    const lines = [...bodies[s]];
    let kind: StageStory['kind'] = 'active';
    if (s === 'ID' && trace.hazard.stall && slot.note) { lines.push(slot.note); kind = 'stall'; }
    return { stage: s, headline: STAGE_TITLES[s], instr: asmText(t, labelFor), lines, kind };
  });

  if (trace.model === 'single') {
    const t = trace.stages.EX.trace;
    const summary = t ? `\`${asmText(t, labelFor)}\` executed in one cycle.` : 'No instruction.';
    return { title: `Cycle ${trace.cycle}`, summary, stages };
  }
  const active = stages.filter((s) => s.instr).length;
  const parts = [`${active} instruction${active === 1 ? '' : 's'} in flight.`];
  if (trace.hazard.stall) parts.push('Pipeline stalled one cycle.');
  if (trace.hazard.flush) parts.push('Two wrong-path instructions flushed.');
  return { title: `Cycle ${trace.cycle}`, summary: parts.join(' '), stages };
}
