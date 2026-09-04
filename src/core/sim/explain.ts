import { regName } from '../isa/registers';
import { aluSymbol } from './alu';
import type { InstrTrace, StageSlot, HazardInfo } from './types';
import { hex32 } from '../util/format';

export type ElementKind = 'data' | 'control' | 'component';

export interface Explanation {
  readonly title: string;
  /** Current value (formatted) or state description. */
  readonly value: string;
  /** Why the element is in this state for the current instruction. */
  readonly why: string;
  /** Whether the element meaningfully participates in this instruction. */
  readonly active: boolean;
  readonly kind: ElementKind;
}

export interface ExplainCtx {
  readonly model: 'single' | 'pipeline';
  readonly slot: StageSlot;
  readonly hazard: HazardInfo;
  readonly forwardingEnabled: boolean;
}

const dec = (v: number) => String(v | 0);
const both = (v: number) => `${hex32(v)} (${dec(v)})`;
const name = (t: InstrTrace) => `\`${t.instr.def?.name ?? '?'}\``;
const rd = (t: InstrTrace) => regName(t.instr.rd);
const rs1 = (t: InstrTrace) => regName(t.instr.rs1);
const rs2 = (t: InstrTrace) => regName(t.instr.rs2);

const FORMAT_WORDS: Record<string, string> = {
  R: 'R-type (register-register)', I: 'I-type (register-immediate)', S: 'S-type (store)',
  B: 'B-type (branch)', U: 'U-type (upper immediate)', J: 'J-type (jump)',
};

type Rule = (t: InstrTrace, ctx: ExplainCtx) => Explanation;

function bubble(id: string, ctx: ExplainCtx): Explanation {
  const note = ctx.slot.note ?? 'No instruction is in this stage this cycle.';
  return { title: id, value: 'idle', why: note, active: false, kind: 'component' };
}

function wbSrcWord(t: InstrTrace): string {
  switch (t.ctrl.wbSrc) {
    case 'ALU': return 'the ALU result';
    case 'MEM': return 'the data read from memory';
    case 'PC4': return 'PC+4 (the return address)';
    case 'NONE': return 'nothing';
  }
}

const RULES: Record<string, Rule> = {
  // ---------------------------------------------------------------- IF ----
  pc: (t) => ({
    title: 'Program Counter (PC)', value: hex32(t.pc), kind: 'component', active: true,
    why: `Holds the address of the instruction being executed: ${name(t)} lives at ${hex32(t.pc)}. At the next clock edge it will load ${hex32(t.nextPc)}${t.pcSrc === 'TARGET' ? ' because control flow was redirected' : ' (PC+4, sequential)'}.`,
  }),
  imem: (t) => ({
    title: 'Instruction Memory', value: hex32(t.instr.word), kind: 'component', active: true,
    why: `Read-only memory indexed by the PC. Address ${hex32(t.pc)} holds the 32-bit word ${hex32(t.instr.word)}, which decodes to ${name(t)}.`,
  }),
  pc4add: (t) => ({
    title: 'PC increment adder', value: hex32(t.pc4), kind: 'component', active: true,
    why: `Computes the sequential next address: ${hex32(t.pc)} + ${t.instr.size} = ${hex32(t.pc4)}${t.instr.size === 2 ? ' (2 bytes because this instruction is compressed)' : ''}. ${t.ctrl.wbSrc === 'PC4' ? `${name(t)} also saves this value into ${rd(t)} as the return address.` : t.pcSrc === 'PC4' ? 'This value becomes the next PC.' : 'This value is discarded because the branch/jump redirects the PC.'}`,
  }),
  'w.pc': (t) => ({
    title: 'PC bus', value: hex32(t.pc), kind: 'data', active: true,
    why: `The current PC fans out to instruction memory (to fetch), the +4 adder, and the branch adder${t.ctrl.aluSrcA === 'PC' ? `. ${name(t)} also sends it to the ALU as operand A.` : '.'}`,
  }),
  'w.pc4': (t) => ({
    title: `PC + ${t.instr.size}`, value: hex32(t.pc4), kind: 'data', active: true,
    why: t.ctrl.wbSrc === 'PC4'
      ? `${name(t)} is a jump-and-link: PC+${t.instr.size} is written into ${rd(t)} so the program can return here later.`
      : t.pcSrc === 'PC4' ? `Sequential execution: ${name(t)} does not change control flow, so PC+${t.instr.size} is selected as the next PC.` : `${name(t)} redirects control flow, so PC+${t.instr.size} is computed but not chosen by the PC mux.`,
  }),
  'w.instr': (t) => ({
    title: 'Instruction word', value: hex32(t.instr.word), kind: 'data', active: true,
    why: `The fetched word is split into fields: opcode ${t.instr.opcode.toString(2).padStart(7, '0')} (bits 6:0), rd=${t.instr.rd}, funct3=${t.instr.funct3}, rs1=${t.instr.rs1}, rs2=${t.instr.rs2}, funct7=${t.instr.funct7}. The format is ${FORMAT_WORDS[t.instr.format ?? ''] ?? 'unknown'}.`,
  }),
  'w.nextPc': (t) => ({
    title: 'Next PC', value: hex32(t.nextPc), kind: 'data', active: true,
    why: t.pcSrc === 'TARGET'
      ? `The PC mux chose the target address ${hex32(t.nextPc)} because ${name(t)} ${t.ctrl.jump ? 'is an unconditional jump' : `is a taken branch (${rs1(t)}=${dec(t.opA)} ${condWord(t)} ${rs2(t)}=${dec(t.opB)} is true)`}.`
      : `The PC mux chose PC+4 = ${hex32(t.nextPc)}: ${t.ctrl.branch ? `${name(t)} is a branch but its condition is false (${rs1(t)}=${dec(t.opA)} ${condWord(t)} ${rs2(t)}=${dec(t.opB)} is false), so execution falls through.` : `${name(t)} is not a branch or jump.`}`,
  }),
  muxPc: (t) => ({
    title: 'PC source mux', value: t.pcSrc === 'TARGET' ? 'selects TARGET' : 'selects PC+4', kind: 'component', active: true,
    why: `Chooses what the PC loads next. PCSrc=${t.pcSrc === 'TARGET' ? 1 : 0}: ${t.pcSrc === 'TARGET' ? `${name(t)} redirects execution to ${hex32(t.nextPc)}.` : 'execution continues sequentially.'}`,
  }),

  decomp: (t) => ({
    title: 'Instruction decompressor (RV32C)', value: t.instr.compressed ? `${t.instr.compressed.name} → ${t.instr.def?.name ?? '?'}` : 'pass-through (32-bit)', kind: 'component', active: t.instr.compressed !== null,
    why: t.instr.compressed
      ? `The two low bits of the fetched halfword are ${(t.instr.compressed.half & 3).toString(2).padStart(2, '0')} (not 11), so this is a 16-bit compressed instruction: ${t.instr.compressed.name} (0x${t.instr.compressed.half.toString(16).padStart(4, '0')}). The decompressor expands it into the equivalent 32-bit ${name(t)} (${hex32(t.instr.word)}) so the rest of the datapath never needs to know about the C extension.`
      : `The low two bits of the instruction are 11, marking a full 32-bit encoding. The decompressor passes ${name(t)} through unchanged.`,
  }),
  muxPcInc: (t) => ({
    title: 'PC increment mux (2 / 4)', value: `selects +${t.instr.size}`, kind: 'component', active: true,
    why: t.instr.size === 2
      ? `${name(t)} is a 16-bit compressed instruction, so the next sequential PC is PC + 2, not PC + 4.`
      : `${name(t)} is a 32-bit instruction, so the next sequential PC is PC + 4.`,
  }),
  'c.pcInc': (t) => ({ title: 'PCInc', value: t.instr.size === 2 ? '0 (+2)' : '1 (+4)', kind: 'control', active: t.instr.size === 2, why: t.instr.size === 2 ? `The decompressor flagged ${name(t)} as compressed, so the increment mux picks 2.` : `${name(t)} is a normal 32-bit instruction; the increment is 4.` }),

  // ---------------------------------------------------------------- ID ----
  control: (t) => ({
    title: 'Control unit', value: `${t.instr.def?.name ?? '?'} (opcode ${t.instr.opcode.toString(2).padStart(7, '0')})`, kind: 'component', active: true,
    why: `Decodes the opcode (and funct3/funct7) into control signals. For ${name(t)}: RegWrite=${+t.ctrl.regWrite}, ALUSrcB=${t.ctrl.aluSrcB}, ALUOp=${t.ctrl.aluOp}, MemRead=${t.ctrl.memRead ? 1 : 0}, MemWrite=${t.ctrl.memWrite ? 1 : 0}, MemToReg=${t.ctrl.wbSrc}, Branch=${t.ctrl.branch ? 1 : 0}, Jump=${t.ctrl.jump ? 1 : 0}.`,
  }),
  regfile: (t) => ({
    title: 'Register file', value: `${rs1(t)}=${both(t.rs1Val)}, ${rs2(t)}=${both(t.rs2Val)}`, kind: 'component', active: true,
    why: `32 registers with two read ports and one write port. This cycle it reads ${rs1(t)} (rs1=${t.instr.rs1}) and ${rs2(t)} (rs2=${t.instr.rs2}). ${t.ctrl.regWrite ? `RegWrite is asserted, so ${rd(t)} will be written with ${wbSrcWord(t)} = ${both(t.wbValue)} at the clock edge.` : `RegWrite is 0: ${name(t)} does not write a register${t.instr.rd === 0 && t.instr.def?.regWrite ? ' (rd is x0, which is hard-wired to zero)' : ''}.`}`,
  }),
  immgen: (t) => {
    const f = t.instr.format;
    const active = f !== 'R' && f !== null;
    return {
      title: 'Immediate generator', value: active ? both(t.imm) : 'unused', kind: 'component', active,
      why: active
        ? `Extracts and sign-extends the immediate from the ${f}-type layout of ${name(t)}. ${immSourceBits(f)} The result is ${both(t.imm)}.`
        : `${name(t)} is R-type: both operands come from registers, so no immediate is encoded and this output is ignored.`,
    };
  },
  'w.rs1val': (t, ctx) => usesA(t)
    ? { title: `Read data 1 (${rs1(t)})`, value: both(t.rs1Val), kind: 'data', active: true, why: `${name(t)} reads its first source operand from ${rs1(t)}. The register file outputs ${both(t.rs1Val)}${ctx.model === 'pipeline' && t.fwdA !== 'NONE' ? ', but this value is stale: the forwarding mux will override it with the newer in-flight result.' : '.'}` }
    : { title: 'Read data 1', value: both(t.rs1Val), kind: 'data', active: false, why: `${name(t)} does not use rs1 (${t.instr.format}-type encodes no rs1 field or it is unused), so this value is ignored.` },
  'w.rs2val': (t, ctx) => usesB(t)
    ? { title: `Read data 2 (${rs2(t)})`, value: both(t.rs2Val), kind: 'data', active: true, why: `${name(t)} reads its second source operand from ${rs2(t)}: ${both(t.rs2Val)}. ${t.ctrl.memWrite ? 'For a store this is the data to be written to memory.' : t.ctrl.branch ? 'For a branch this is compared with rs1.' : ''}${ctx.model === 'pipeline' && t.fwdB !== 'NONE' ? ' The forwarding mux will override it with the newer in-flight result.' : ''}` }
    : { title: 'Read data 2', value: both(t.rs2Val), kind: 'data', active: false, why: `${name(t)} does not use rs2: its second operand is ${t.ctrl.aluSrcB === 'IMM' ? 'the immediate' : 'not needed'}. The register file still reads a value, but nothing consumes it.` },
  'w.imm': (t) => {
    const active = t.instr.format !== 'R' && t.instr.format !== null;
    return { title: 'Immediate', value: both(t.imm), kind: 'data', active, why: active ? `The sign-extended immediate of ${name(t)}${t.ctrl.aluSrcB === 'IMM' ? ', routed to ALU operand B' : ''}${t.ctrl.branch || t.ctrl.jump === 'JAL' ? ', and to the branch adder to form PC + imm' : ''}.` : `${name(t)} has no immediate.` };
  },
  'w.rd': (t) => ({ title: 'rd (destination register number)', value: `${t.instr.rd} (${rd(t)})`, kind: 'data', active: t.ctrl.regWrite, why: t.ctrl.regWrite ? `Bits 11:7 of the instruction select which register receives the result: ${rd(t)}.` : `${name(t)} writes no register, so the rd field is ignored${t.instr.format === 'S' || t.instr.format === 'B' ? ' (S/B formats use those bits for the immediate)' : ''}.` }),
  'w.rs1': (t) => ({ title: 'rs1 (source register 1 number)', value: `${t.instr.rs1} (${rs1(t)})`, kind: 'data', active: usesA(t), why: usesA(t) ? `Bits 19:15 select the first source register, ${rs1(t)}.` : `${name(t)} does not read rs1.` }),
  'w.rs2': (t) => ({ title: 'rs2 (source register 2 number)', value: `${t.instr.rs2} (${rs2(t)})`, kind: 'data', active: usesB(t), why: usesB(t) ? `Bits 24:20 select the second source register, ${rs2(t)}.` : `${name(t)} does not read rs2${t.instr.format === 'I' ? ' (those bits are part of the immediate)' : ''}.` }),

  // ---------------------------------------------------------------- EX ----
  muxAluA: (t) => ({
    title: 'ALU operand A mux', value: `selects ${t.ctrl.aluSrcA === 'PC' ? 'PC' : 'rs1'}`, kind: 'component', active: true,
    why: t.ctrl.aluSrcA === 'PC'
      ? `${name(t)} computes an address relative to the PC (${t.instr.def?.name === 'auipc' ? 'PC + upper immediate' : 'PC + offset'}), so the ALU's first operand is the PC (${hex32(t.pc)}) instead of a register.`
      : `${name(t)} operates on register data: the ALU's first operand is ${rs1(t)} = ${both(t.opA)}.`,
  }),
  muxAluB: (t) => ({
    title: 'ALU operand B mux', value: `selects ${t.ctrl.aluSrcB === 'IMM' ? 'immediate' : 'rs2'}`, kind: 'component', active: true,
    why: t.ctrl.aluSrcB === 'IMM'
      ? `ALUSrc=1: ${name(t)} is ${FORMAT_WORDS[t.instr.format ?? '']}, so its second operand is the immediate ${both(t.imm)}${t.ctrl.memRead || t.ctrl.memWrite ? ' (the address offset added to the base register)' : ''}.`
      : `ALUSrc=0: ${name(t)} is R-type, so the second operand comes from register ${rs2(t)} = ${both(t.opB)}.`,
  }),
  alu: (t) => ({
    title: 'ALU', value: `${dec(t.aluA)} ${aluSymbol(t.ctrl.aluOp)} ${dec(t.aluB)} = ${both(t.aluResult)}`, kind: 'component', active: true,
    why: aluWhy(t),
  }),
  'w.aluA': (t) => ({ title: 'ALU input A', value: both(t.aluA), kind: 'data', active: true, why: `${t.ctrl.aluSrcA === 'PC' ? 'The PC' : `Register ${rs1(t)}`}${t.fwdA !== 'NONE' ? ' (forwarded)' : ''} = ${both(t.aluA)}.` }),
  'w.aluB': (t) => ({ title: 'ALU input B', value: both(t.aluB), kind: 'data', active: true, why: `${t.ctrl.aluSrcB === 'IMM' ? 'The immediate' : `Register ${rs2(t)}`}${t.fwdB !== 'NONE' && t.ctrl.aluSrcB === 'REG' ? ' (forwarded)' : ''} = ${both(t.aluB)}.` }),
  'w.aluResult': (t) => ({
    title: 'ALU result', value: both(t.aluResult), kind: 'data', active: true,
    why: t.ctrl.memRead || t.ctrl.memWrite
      ? `For ${name(t)} the ALU result is the effective memory address: ${rs1(t)} + ${dec(t.imm)} = ${hex32(t.aluResult)}.`
      : t.ctrl.jump === 'JALR' ? `For jalr the ALU result (${rs1(t)} + ${dec(t.imm)}) is the jump target, sent to the PC mux.`
        : t.ctrl.branch ? `Branches do not use the ALU result; the comparison happens in the branch unit.`
          : `The computed value ${both(t.aluResult)}, routed to the write-back mux for ${rd(t)}.`,
  }),
  branchAdd: (t) => {
    const active = t.ctrl.branch !== null || t.ctrl.jump === 'JAL';
    return { title: 'Branch target adder', value: hex32(t.branchTarget), kind: 'component', active, why: active ? `Computes PC + immediate = ${hex32(t.pc)} + ${dec(t.imm)} = ${hex32(t.branchTarget)}, the target of ${name(t)}. A separate adder is used so the ALU stays free for the comparison.` : `${name(t)} is not a PC-relative branch or jump, so this target is computed but unused.` };
  },
  'w.branchTarget': (t) => {
    const active = t.ctrl.branch !== null || t.ctrl.jump === 'JAL';
    return { title: 'Branch target', value: hex32(t.branchTarget), kind: 'data', active, why: active ? `PC-relative target ${hex32(t.branchTarget)} offered to the PC mux${t.pcSrc === 'TARGET' ? ' and selected' : ' but not selected (branch not taken)'}.` : 'Unused: no PC-relative branch/jump this cycle.' };
  },
  branchUnit: (t) => {
    const active = t.ctrl.branch !== null;
    return {
      title: 'Branch comparator', value: active ? `${dec(t.opA)} ${condWord(t)} ${dec(t.opB)} → ${t.branchCondMet}` : 'unused', kind: 'component', active,
      why: active ? `Compares ${rs1(t)} and ${rs2(t)} using the ${name(t)} condition. ${dec(t.opA)} ${condWord(t)} ${dec(t.opB)} is ${t.branchCondMet ? 'TRUE, so the branch is taken' : 'FALSE, so the branch falls through'}.` : `${name(t)} is not a conditional branch, so the comparator output is ignored.`,
    };
  },
  'w.branchCond': (t) => ({ title: 'Branch condition', value: t.ctrl.branch ? String(t.branchCondMet) : '0', kind: 'control', active: t.ctrl.branch !== null && t.branchCondMet, why: t.ctrl.branch ? `Result of the comparison for ${name(t)}: ${t.branchCondMet}.` : 'Not a branch.' }),
  pcSrcLogic: (t) => ({
    title: 'PCSrc logic (Branch AND cond) OR Jump', value: t.pcSrc === 'TARGET' ? '1' : '0', kind: 'component', active: t.pcSrc === 'TARGET',
    why: `PCSrc = (Branch=${t.ctrl.branch ? 1 : 0} AND condition=${+t.branchCondMet}) OR Jump=${t.ctrl.jump ? 1 : 0} = ${t.pcSrc === 'TARGET' ? 1 : 0}. ${t.pcSrc === 'TARGET' ? 'The PC will be redirected.' : 'The PC continues sequentially.'}`,
  }),
  'c.pcSrc': (t) => ({ title: 'PCSrc', value: t.pcSrc === 'TARGET' ? '1' : '0', kind: 'control', active: t.pcSrc === 'TARGET', why: t.pcSrc === 'TARGET' ? `Asserted: ${name(t)} ${t.ctrl.jump ? 'always jumps' : 'is a taken branch'}, so the PC mux selects the target.` : `Not asserted: ${name(t)} ${t.ctrl.branch ? 'is a branch whose condition is false' : 'does not change control flow'}.` }),

  // --------------------------------------------------------------- MEM ----
  dmem: (t) => {
    const active = t.ctrl.memRead !== null || t.ctrl.memWrite !== null;
    return {
      title: 'Data memory', value: t.ctrl.memRead ? `read [${hex32(t.memAddr)}] = ${both(t.memReadData)}` : t.ctrl.memWrite ? `write [${hex32(t.memAddr)}] ← ${both(t.memWriteData)}` : 'idle', kind: 'component', active,
      why: t.ctrl.memRead ? `${name(t)} loads ${widthWord(t.ctrl.memRead)} from address ${hex32(t.memAddr)} (${rs1(t)} + ${dec(t.imm)}). MemRead=1. The value ${both(t.memReadData)} goes to the write-back mux.`
        : t.ctrl.memWrite ? `${name(t)} stores ${widthWord(t.ctrl.memWrite)} of ${rs2(t)} (${both(t.memWriteData)}) to address ${hex32(t.memAddr)}. MemWrite=1.`
          : `${name(t)} is not a load or store, so MemRead=MemWrite=0 and the memory does nothing this cycle.`,
    };
  },
  'w.memAddr': (t) => { const a = t.ctrl.memRead !== null || t.ctrl.memWrite !== null; return { title: 'Memory address', value: hex32(t.memAddr), kind: 'data', active: a, why: a ? `The ALU computed ${rs1(t)} + ${dec(t.imm)} = ${hex32(t.memAddr)} as the effective address.` : 'The ALU result reaches the address port, but memory is disabled for this instruction.' }; },
  'w.memWriteData': (t) => ({ title: 'Memory write data', value: both(t.memWriteData), kind: 'data', active: t.ctrl.memWrite !== null, why: t.ctrl.memWrite ? `${rs2(t)} = ${both(t.memWriteData)} is the value ${name(t)} stores.` : `Only stores use this port; ${name(t)} is not a store.` }),
  'w.memReadData': (t) => ({ title: 'Memory read data', value: both(t.memReadData), kind: 'data', active: t.ctrl.memRead !== null, why: t.ctrl.memRead ? `The ${widthWord(t.ctrl.memRead)} loaded from ${hex32(t.memAddr)}, ${t.ctrl.memRead.endsWith('U') ? 'zero-extended' : 'sign-extended'} to 32 bits: ${both(t.memReadData)}.` : `${name(t)} does not load, so this output is not selected by the write-back mux.` }),

  // ---------------------------------------------------------------- WB ----
  muxWb: (t) => ({
    title: 'Write-back mux (MemToReg)', value: t.ctrl.wbSrc === 'NONE' ? 'unused' : `selects ${t.ctrl.wbSrc}`, kind: 'component', active: t.ctrl.regWrite,
    why: t.ctrl.regWrite ? `${name(t)} writes ${wbSrcWord(t)} to ${rd(t)}, so the mux selects ${t.ctrl.wbSrc}: ${both(t.wbValue)}.` : `${name(t)} does not write a register, so the mux output is ignored.`,
  }),
  'w.wbData': (t) => ({ title: 'Write-back data', value: both(t.wbValue), kind: 'data', active: t.ctrl.regWrite, why: t.ctrl.regWrite ? `${both(t.wbValue)} is written into ${rd(t)} at the end of the cycle.` : 'No register write this instruction.' }),

  // ---------------------------------------------------- control signals ----
  'c.regWrite': (t) => ({ title: 'RegWrite', value: t.ctrl.regWrite ? '1' : '0', kind: 'control', active: t.ctrl.regWrite, why: t.ctrl.regWrite ? `${name(t)} produces a result for ${rd(t)}, so the register file's write enable is asserted.` : `${name(t)} ${t.instr.def?.regWrite ? 'targets x0, which cannot be written' : 'produces no register result (stores, branches, and ecall write nothing)'}, so RegWrite=0.` }),
  'c.aluSrcA': (t) => ({ title: 'ALUSrcA', value: t.ctrl.aluSrcA === 'PC' ? '1 (PC)' : '0 (rs1)', kind: 'control', active: t.ctrl.aluSrcA === 'PC', why: t.ctrl.aluSrcA === 'PC' ? `${name(t)} is PC-relative, so the ALU's A input is the PC.` : `${name(t)} uses register ${rs1(t)} as the A input.` }),
  'c.aluSrcB': (t) => ({ title: 'ALUSrc', value: t.ctrl.aluSrcB === 'IMM' ? '1 (imm)' : '0 (rs2)', kind: 'control', active: t.ctrl.aluSrcB === 'IMM', why: t.ctrl.aluSrcB === 'IMM' ? `${name(t)} carries an immediate operand, so the B mux selects the immediate.` : `${name(t)} is R-type: the B mux selects register ${rs2(t)}.` }),
  'c.aluOp': (t) => ({ title: 'ALUOp', value: t.ctrl.aluOp, kind: 'control', active: true, why: aluOpWhy(t) }),
  'c.memRead': (t) => ({ title: 'MemRead', value: t.ctrl.memRead ? '1' : '0', kind: 'control', active: t.ctrl.memRead !== null, why: t.ctrl.memRead ? `${name(t)} is a load, so memory is read at the ALU-computed address.` : `${name(t)} is not a load.` }),
  'c.memWrite': (t) => ({ title: 'MemWrite', value: t.ctrl.memWrite ? '1' : '0', kind: 'control', active: t.ctrl.memWrite !== null, why: t.ctrl.memWrite ? `${name(t)} is a store, so memory is written at the ALU-computed address.` : `${name(t)} is not a store.` }),
  'c.wbSrc': (t) => ({ title: 'MemToReg / WBSrc', value: t.ctrl.wbSrc, kind: 'control', active: t.ctrl.regWrite, why: t.ctrl.regWrite ? `Selects ${wbSrcWord(t)} for ${rd(t)}.` : 'Unused: no register write.' }),
  'c.branch': (t) => ({ title: 'Branch', value: t.ctrl.branch ? '1' : '0', kind: 'control', active: t.ctrl.branch !== null, why: t.ctrl.branch ? `${name(t)} is a conditional branch, so the comparator result may redirect the PC.` : `${name(t)} is not a conditional branch.` }),
  'c.jump': (t) => ({ title: 'Jump', value: t.ctrl.jump ? '1' : '0', kind: 'control', active: t.ctrl.jump !== null, why: t.ctrl.jump ? `${name(t)} is an unconditional jump, so PCSrc is forced to 1.` : `${name(t)} is not a jump.` }),

  // ------------------------------------------------- pipeline-specific ----
  ifid: (t) => ({ title: 'IF/ID pipeline register', value: `${t.instr.def?.name ?? '?'} @ ${hex32(t.pc)}`, kind: 'component', active: true, why: `Holds the fetched instruction and its PC between the IF and ID stages. Its contents this cycle are what ID is decoding.` }),
  idex: (t) => ({ title: 'ID/EX pipeline register', value: `${t.instr.def?.name ?? '?'} @ ${hex32(t.pc)}`, kind: 'component', active: true, why: `Carries the decoded instruction into EX: register values (${rs1(t)}=${dec(t.rs1Val)}, ${rs2(t)}=${dec(t.rs2Val)}), the immediate ${dec(t.imm)}, the PC, and all control signals for EX/MEM/WB.` }),
  exmem: (t) => ({ title: 'EX/MEM pipeline register', value: `${t.instr.def?.name ?? '?'} @ ${hex32(t.pc)}`, kind: 'component', active: true, why: `Carries the ALU result ${both(t.aluResult)}, the store data, rd=${rd(t)}, and the MEM/WB control signals into the memory stage.` }),
  memwb: (t) => ({ title: 'MEM/WB pipeline register', value: `${t.instr.def?.name ?? '?'} @ ${hex32(t.pc)}`, kind: 'component', active: true, why: `Carries the ALU result, memory read data, and rd=${rd(t)} into write-back, plus RegWrite=${+t.ctrl.regWrite} and MemToReg=${t.ctrl.wbSrc}.` }),
  muxFwdA: (t, ctx) => fwdMux('A', t, ctx),
  muxFwdB: (t, ctx) => fwdMux('B', t, ctx),
  'w.fwdA': (t, ctx) => fwdMux('A', t, ctx),
  'w.fwdB': (t, ctx) => fwdMux('B', t, ctx),
  forward: (t, ctx) => ({
    title: 'Forwarding unit', value: `ForwardA=${t.fwdA}, ForwardB=${t.fwdB}`, kind: 'component', active: t.fwdA !== 'NONE' || t.fwdB !== 'NONE',
    why: !ctx.forwardingEnabled ? 'Forwarding is disabled in this processor configuration; dependent instructions must stall until the producer writes back.'
      : t.fwdA === 'NONE' && t.fwdB === 'NONE' ? `Compares the rs1/rs2 of ${name(t)} (in EX) with the rd of the instructions in MEM and WB. No match with a pending register write, so operands come straight from the ID/EX register.`
        : `Detected that ${name(t)} depends on a result still in the pipeline. ${t.fwdA !== 'NONE' ? `Operand A (${rs1(t)}) is taken from the ${t.fwdA === 'EXMEM' ? 'EX/MEM' : 'MEM/WB'} register. ` : ''}${t.fwdB !== 'NONE' ? `Operand B (${rs2(t)}) is taken from the ${t.fwdB === 'EXMEM' ? 'EX/MEM' : 'MEM/WB'} register.` : ''} This avoids a stall by bypassing the register file.`,
  }),
  hazard: (t, ctx) => ({
    title: 'Hazard detection unit', value: ctx.hazard.stall ? 'STALL' : ctx.hazard.flush ? 'FLUSH' : 'no hazard', kind: 'component', active: ctx.hazard.stall || ctx.hazard.flush,
    why: ctx.hazard.reason ?? `Checks whether ${name(t)} (in ID) needs a register that the load in EX has not fetched yet. No such load-use dependency exists, so the pipeline advances normally.`,
  }),
  'c.stall': (_t, ctx) => ({ title: 'Stall (PCWrite=0, IF/IDWrite=0)', value: ctx.hazard.stall ? '1' : '0', kind: 'control', active: ctx.hazard.stall, why: ctx.hazard.stall ? `${ctx.hazard.reason} The PC and IF/ID register are frozen and a bubble (nop) is inserted into ID/EX.` : 'No stall: PC and IF/ID advance normally.' }),
  'c.flush': (_t, ctx) => ({ title: 'Flush IF/ID and ID/EX', value: ctx.hazard.flush ? '1' : '0', kind: 'control', active: ctx.hazard.flush, why: ctx.hazard.flush ? ctx.hazard.reason ?? 'flush' : 'No flush: no taken branch or jump resolved in EX this cycle.' }),
};

function fwdMux(which: 'A' | 'B', t: InstrTrace, ctx: ExplainCtx): Explanation {
  const src = which === 'A' ? t.fwdA : t.fwdB;
  const reg = which === 'A' ? rs1(t) : rs2(t);
  const val = which === 'A' ? t.opA : t.opB;
  const regVal = which === 'A' ? t.rs1Val : t.rs2Val;
  const used = which === 'A' ? usesA(t) : usesB(t);
  const sel = src === 'NONE' ? '00 (ID/EX register value)' : src === 'EXMEM' ? '10 (EX/MEM result)' : '01 (MEM/WB result)';
  return {
    title: `Forward${which} mux`, value: `selects ${sel}`, kind: 'component', active: src !== 'NONE',
    why: !used ? `${name(t)} does not use ${which === 'A' ? 'rs1' : 'rs2'}, so this mux's choice does not matter.`
      : src === 'NONE' ? `${reg} = ${both(val)} came from the register file with no newer value in flight${ctx.forwardingEnabled ? '' : ' (forwarding disabled)'}.`
        : `${reg} was read as ${both(regVal)} in ID, but the ${src === 'EXMEM' ? 'instruction one ahead (now in MEM)' : 'instruction two ahead (now in WB)'} is about to write ${reg} = ${both(val)}. Forwarding supplies the fresh value so ${name(t)} computes the right answer without waiting.`,
  };
}

function usesA(t: InstrTrace): boolean {
  const f = t.instr.format;
  return f !== null && f !== 'U' && f !== 'J' && !t.ctrl.system && t.ctrl.aluSrcA === 'REG';
}
function usesB(t: InstrTrace): boolean {
  const f = t.instr.format;
  return f === 'R' || f === 'S' || f === 'B';
}

function condWord(t: InstrTrace): string {
  switch (t.ctrl.branch) {
    case 'EQ': return '=='; case 'NE': return '!='; case 'LT': return '<'; case 'GE': return '>=';
    case 'LTU': return '<u'; case 'GEU': return '>=u'; default: return '?';
  }
}

function widthWord(w: string): string {
  return w.startsWith('B') ? 'a byte' : w.startsWith('H') ? 'a halfword (16 bits)' : 'a word (32 bits)';
}

function immSourceBits(f: string | null): string {
  switch (f) {
    case 'I': return 'Bits 31:20 hold a 12-bit signed immediate.';
    case 'S': return 'The 12-bit immediate is split: bits 31:25 are imm[11:5] and bits 11:7 are imm[4:0], so rs1/rs2 stay in the same place as R-type.';
    case 'B': return 'A 13-bit offset (always even, so bit 0 is implied) is scattered across bits 31, 7, 30:25, and 11:8.';
    case 'U': return 'Bits 31:12 form the upper 20 bits; the low 12 bits are zero.';
    case 'J': return 'A 21-bit offset is scattered across bits 31, 19:12, 20, and 30:21.';
    default: return '';
  }
}

function aluWhy(t: InstrTrace): string {
  const op = t.ctrl.aluOp;
  if (t.ctrl.memRead || t.ctrl.memWrite) return `For loads and stores the ALU acts as an address adder: base ${rs1(t)} (${dec(t.aluA)}) + offset ${dec(t.aluB)} = ${hex32(t.aluResult)}.`;
  if (t.ctrl.branch) return `Branches use the separate comparator; the ALU output (${both(t.aluResult)}) is unused here.`;
  if (t.ctrl.jump === 'JAL') return `jal's target is formed by the branch adder; the ALU result is unused.`;
  if (t.ctrl.jump === 'JALR') return `jalr computes its target in the ALU: ${rs1(t)} (${dec(t.aluA)}) + ${dec(t.aluB)} = ${hex32(t.aluResult)}, with the low bit cleared.`;
  if (op === 'COPY_B') return `lui simply passes the shifted immediate through: rd = ${both(t.aluResult)}.`;
  return `ALUOp=${op}: computes ${dec(t.aluA)} ${aluSymbol(op)} ${dec(t.aluB)} = ${both(t.aluResult)}, which will be written to ${rd(t)}.`;
}

function aluOpWhy(t: InstrTrace): string {
  if (t.ctrl.memRead || t.ctrl.memWrite) return 'Loads and stores always ADD base + offset to form the address, regardless of funct3.';
  if (t.ctrl.branch) return 'Branches set the ALU to a don\'t-care; the comparator handles the condition.';
  const f = t.instr.format;
  if (f === 'R') return `R-type: funct3=${t.instr.funct3} and funct7=${t.instr.funct7 === 0x20 ? '0x20' : t.instr.funct7 === 1 ? '0x01 (M extension)' : '0'} select ${t.ctrl.aluOp}.`;
  if (f === 'I') return `I-type ALU op: funct3=${t.instr.funct3}${t.instr.def?.name === 'srai' ? ' with bit 30 set' : ''} selects ${t.ctrl.aluOp}.`;
  return `${name(t)} uses ${t.ctrl.aluOp}.`;
}

/** Look up the explanation for an element id in the context of a stage slot. */
export function explainElement(id: string, ctx: ExplainCtx): Explanation {
  const t = ctx.slot.trace;
  const rule = RULES[id];
  if (!rule) return { title: id, value: '', why: 'No description available.', active: false, kind: 'component' };
  if (!t) return bubble(TITLES[id] ?? id, ctx);
  return rule(t, ctx);
}

const TITLES: Record<string, string> = {
  pc: 'Program Counter', imem: 'Instruction Memory', pc4add: 'PC increment adder', decomp: 'Instruction decompressor', muxPcInc: 'PC increment mux', control: 'Control unit', regfile: 'Register file',
  immgen: 'Immediate generator', muxAluA: 'ALU operand A mux', muxAluB: 'ALU operand B mux', alu: 'ALU', branchAdd: 'Branch target adder',
  branchUnit: 'Branch comparator', pcSrcLogic: 'PCSrc logic', dmem: 'Data memory', muxWb: 'Write-back mux', muxPc: 'PC source mux',
  ifid: 'IF/ID register', idex: 'ID/EX register', exmem: 'EX/MEM register', memwb: 'MEM/WB register', forward: 'Forwarding unit',
  hazard: 'Hazard detection unit', muxFwdA: 'ForwardA mux', muxFwdB: 'ForwardB mux',
};

export function hasRule(id: string): boolean {
  return id in RULES;
}
