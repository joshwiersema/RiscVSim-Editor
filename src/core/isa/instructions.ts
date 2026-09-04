/**
 * RV32IM instruction table. Each entry carries encoding info plus the
 * human-facing descriptions used by the datapath explanations.
 */

export type Format = 'R' | 'I' | 'S' | 'B' | 'U' | 'J';

export type AluOp =
  | 'ADD' | 'SUB' | 'AND' | 'OR' | 'XOR' | 'SLL' | 'SRL' | 'SRA' | 'SLT' | 'SLTU'
  | 'MUL' | 'MULH' | 'MULHSU' | 'MULHU' | 'DIV' | 'DIVU' | 'REM' | 'REMU'
  | 'COPY_B'; // pass operand B through (lui)

export type BranchCond = 'EQ' | 'NE' | 'LT' | 'GE' | 'LTU' | 'GEU';
export type MemWidth = 'B' | 'H' | 'W' | 'BU' | 'HU';

export interface InstrDef {
  readonly name: string;
  readonly format: Format;
  readonly opcode: number;
  readonly funct3?: number;
  readonly funct7?: number;
  readonly alu: AluOp;
  /** ALU operand A: rs1 value or the PC (auipc, jal). */
  readonly aluSrcA: 'REG' | 'PC';
  /** ALU operand B: rs2 value or immediate. */
  readonly aluSrcB: 'REG' | 'IMM';
  readonly regWrite: boolean;
  /** What is written back to rd. */
  readonly wbSrc: 'ALU' | 'MEM' | 'PC4' | 'NONE';
  readonly memRead?: MemWidth;
  readonly memWrite?: MemWidth;
  readonly branch?: BranchCond;
  readonly jump?: 'JAL' | 'JALR';
  readonly system?: 'ECALL' | 'EBREAK';
  /** Short one-line description of what the instruction does. */
  readonly summary: string;
  /** Operand syntax for the reference. */
  readonly syntax: string;
}

const OP = {
  LOAD: 0x03, OP_IMM: 0x13, AUIPC: 0x17, STORE: 0x23, OP: 0x33, LUI: 0x37,
  BRANCH: 0x63, JALR: 0x67, JAL: 0x6f, SYSTEM: 0x73,
} as const;

function rtype(name: string, f3: number, f7: number, alu: AluOp, summary: string): InstrDef {
  return { name, format: 'R', opcode: OP.OP, funct3: f3, funct7: f7, alu, aluSrcA: 'REG', aluSrcB: 'REG', regWrite: true, wbSrc: 'ALU', summary, syntax: `${name} rd, rs1, rs2` };
}
function itype(name: string, f3: number, alu: AluOp, summary: string, f7?: number): InstrDef {
  return { name, format: 'I', opcode: OP.OP_IMM, funct3: f3, funct7: f7, alu, aluSrcA: 'REG', aluSrcB: 'IMM', regWrite: true, wbSrc: 'ALU', summary, syntax: `${name} rd, rs1, imm` };
}
function load(name: string, f3: number, w: MemWidth, summary: string): InstrDef {
  return { name, format: 'I', opcode: OP.LOAD, funct3: f3, alu: 'ADD', aluSrcA: 'REG', aluSrcB: 'IMM', regWrite: true, wbSrc: 'MEM', memRead: w, summary, syntax: `${name} rd, offset(rs1)` };
}
function store(name: string, f3: number, w: MemWidth, summary: string): InstrDef {
  return { name, format: 'S', opcode: OP.STORE, funct3: f3, alu: 'ADD', aluSrcA: 'REG', aluSrcB: 'IMM', regWrite: false, wbSrc: 'NONE', memWrite: w, summary, syntax: `${name} rs2, offset(rs1)` };
}
function branch(name: string, f3: number, cond: BranchCond, summary: string): InstrDef {
  return { name, format: 'B', opcode: OP.BRANCH, funct3: f3, alu: 'ADD', aluSrcA: 'PC', aluSrcB: 'IMM', regWrite: false, wbSrc: 'NONE', branch: cond, summary, syntax: `${name} rs1, rs2, label` };
}

export const INSTRUCTIONS: readonly InstrDef[] = [
  // RV32I R-type
  rtype('add', 0, 0x00, 'ADD', 'rd = rs1 + rs2'),
  rtype('sub', 0, 0x20, 'SUB', 'rd = rs1 - rs2'),
  rtype('sll', 1, 0x00, 'SLL', 'rd = rs1 << rs2[4:0]'),
  rtype('slt', 2, 0x00, 'SLT', 'rd = (rs1 < rs2) signed ? 1 : 0'),
  rtype('sltu', 3, 0x00, 'SLTU', 'rd = (rs1 < rs2) unsigned ? 1 : 0'),
  rtype('xor', 4, 0x00, 'XOR', 'rd = rs1 ^ rs2'),
  rtype('srl', 5, 0x00, 'SRL', 'rd = rs1 >>> rs2[4:0] (logical)'),
  rtype('sra', 5, 0x20, 'SRA', 'rd = rs1 >> rs2[4:0] (arithmetic)'),
  rtype('or', 6, 0x00, 'OR', 'rd = rs1 | rs2'),
  rtype('and', 7, 0x00, 'AND', 'rd = rs1 & rs2'),
  // RV32M
  rtype('mul', 0, 0x01, 'MUL', 'rd = low 32 bits of rs1 * rs2'),
  rtype('mulh', 1, 0x01, 'MULH', 'rd = high 32 bits of rs1 * rs2 (signed)'),
  rtype('mulhsu', 2, 0x01, 'MULHSU', 'rd = high 32 bits of rs1 (signed) * rs2 (unsigned)'),
  rtype('mulhu', 3, 0x01, 'MULHU', 'rd = high 32 bits of rs1 * rs2 (unsigned)'),
  rtype('div', 4, 0x01, 'DIV', 'rd = rs1 / rs2 (signed)'),
  rtype('divu', 5, 0x01, 'DIVU', 'rd = rs1 / rs2 (unsigned)'),
  rtype('rem', 6, 0x01, 'REM', 'rd = rs1 % rs2 (signed)'),
  rtype('remu', 7, 0x01, 'REMU', 'rd = rs1 % rs2 (unsigned)'),
  // I-type ALU
  itype('addi', 0, 'ADD', 'rd = rs1 + imm'),
  itype('slti', 2, 'SLT', 'rd = (rs1 < imm) signed ? 1 : 0'),
  itype('sltiu', 3, 'SLTU', 'rd = (rs1 < imm) unsigned ? 1 : 0'),
  itype('xori', 4, 'XOR', 'rd = rs1 ^ imm'),
  itype('ori', 6, 'OR', 'rd = rs1 | imm'),
  itype('andi', 7, 'AND', 'rd = rs1 & imm'),
  itype('slli', 1, 'SLL', 'rd = rs1 << shamt', 0x00),
  itype('srli', 5, 'SRL', 'rd = rs1 >>> shamt (logical)', 0x00),
  itype('srai', 5, 'SRA', 'rd = rs1 >> shamt (arithmetic)', 0x20),
  // Loads
  load('lb', 0, 'B', 'rd = sign-extended byte at rs1 + offset'),
  load('lh', 1, 'H', 'rd = sign-extended halfword at rs1 + offset'),
  load('lw', 2, 'W', 'rd = word at rs1 + offset'),
  load('lbu', 4, 'BU', 'rd = zero-extended byte at rs1 + offset'),
  load('lhu', 5, 'HU', 'rd = zero-extended halfword at rs1 + offset'),
  // Stores
  store('sb', 0, 'B', 'store low byte of rs2 at rs1 + offset'),
  store('sh', 1, 'H', 'store low halfword of rs2 at rs1 + offset'),
  store('sw', 2, 'W', 'store rs2 at rs1 + offset'),
  // Branches
  branch('beq', 0, 'EQ', 'if rs1 == rs2, PC = PC + offset'),
  branch('bne', 1, 'NE', 'if rs1 != rs2, PC = PC + offset'),
  branch('blt', 4, 'LT', 'if rs1 < rs2 (signed), PC = PC + offset'),
  branch('bge', 5, 'GE', 'if rs1 >= rs2 (signed), PC = PC + offset'),
  branch('bltu', 6, 'LTU', 'if rs1 < rs2 (unsigned), PC = PC + offset'),
  branch('bgeu', 7, 'GEU', 'if rs1 >= rs2 (unsigned), PC = PC + offset'),
  // Upper immediates
  { name: 'lui', format: 'U', opcode: OP.LUI, alu: 'COPY_B', aluSrcA: 'REG', aluSrcB: 'IMM', regWrite: true, wbSrc: 'ALU', summary: 'rd = imm << 12', syntax: 'lui rd, imm' },
  { name: 'auipc', format: 'U', opcode: OP.AUIPC, alu: 'ADD', aluSrcA: 'PC', aluSrcB: 'IMM', regWrite: true, wbSrc: 'ALU', summary: 'rd = PC + (imm << 12)', syntax: 'auipc rd, imm' },
  // Jumps
  { name: 'jal', format: 'J', opcode: OP.JAL, alu: 'ADD', aluSrcA: 'PC', aluSrcB: 'IMM', regWrite: true, wbSrc: 'PC4', jump: 'JAL', summary: 'rd = PC + 4; PC = PC + offset', syntax: 'jal rd, label' },
  { name: 'jalr', format: 'I', opcode: OP.JALR, funct3: 0, alu: 'ADD', aluSrcA: 'REG', aluSrcB: 'IMM', regWrite: true, wbSrc: 'PC4', jump: 'JALR', summary: 'rd = PC + 4; PC = (rs1 + offset) & ~1', syntax: 'jalr rd, offset(rs1)' },
  // System
  { name: 'ecall', format: 'I', opcode: OP.SYSTEM, funct3: 0, alu: 'ADD', aluSrcA: 'REG', aluSrcB: 'IMM', regWrite: false, wbSrc: 'NONE', system: 'ECALL', summary: 'environment call (syscall in a7, args in a0-a2)', syntax: 'ecall' },
  { name: 'ebreak', format: 'I', opcode: OP.SYSTEM, funct3: 0, alu: 'ADD', aluSrcA: 'REG', aluSrcB: 'IMM', regWrite: false, wbSrc: 'NONE', system: 'EBREAK', summary: 'breakpoint trap', syntax: 'ebreak' },
];

export const INSTR_BY_NAME: ReadonlyMap<string, InstrDef> = new Map(INSTRUCTIONS.map((d) => [d.name, d]));

export const OPCODES = OP;
