import type { FpuOp } from '../fp/fpu';

/**
 * RV32IMF + Zicsr instruction table. Each entry carries encoding info plus the
 * human-facing descriptions used by the datapath explanations.
 */

export type Format = 'R' | 'R4' | 'I' | 'S' | 'B' | 'U' | 'J';

/** Which register file an operand lives in: integer (x) or floating point (f). */
export type RegFile = 'X' | 'F';

export type AluOp =
  | 'ADD' | 'SUB' | 'AND' | 'OR' | 'XOR' | 'SLL' | 'SRL' | 'SRA' | 'SLT' | 'SLTU'
  | 'MUL' | 'MULH' | 'MULHSU' | 'MULHU' | 'DIV' | 'DIVU' | 'REM' | 'REMU'
  | 'COPY_B' // pass operand B through (lui)
  | 'FPU'; // the floating-point unit computes the result

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
  readonly wbSrc: 'ALU' | 'MEM' | 'PC4' | 'CSR' | 'NONE';
  readonly memRead?: MemWidth;
  readonly memWrite?: MemWidth;
  readonly branch?: BranchCond;
  readonly jump?: 'JAL' | 'JALR';
  readonly system?: 'ECALL' | 'EBREAK';
  /** FPU operation (RV32F), routed through the EX stage in place of the ALU. */
  readonly fpu?: FpuOp;
  /** Register file per operand; integer unless listed. rs3 is always an f register. */
  readonly files?: { readonly rd?: RegFile; readonly rs1?: RegFile; readonly rs2?: RegFile };
  /** Fixed rs2 field: unary FP ops (fsqrt, fcvt, fclass, fmv) select their variant with it. */
  readonly rs2Sel?: number;
  /** funct3 carries a rounding mode (rm) instead of selecting the operation. */
  readonly rm?: boolean;
  /** Zicsr read-modify-write: swap, set bits, clear bits. */
  readonly csr?: 'RW' | 'RS' | 'RC';
  /** CSR immediate form: the rs1 field is a 5-bit zero-extended immediate. */
  readonly csrImm?: boolean;
  /** Short one-line description of what the instruction does. */
  readonly summary: string;
  /** Operand syntax for the reference. */
  readonly syntax: string;
}

const OP = {
  LOAD: 0x03, OP_IMM: 0x13, AUIPC: 0x17, STORE: 0x23, OP: 0x33, LUI: 0x37,
  BRANCH: 0x63, JALR: 0x67, JAL: 0x6f, SYSTEM: 0x73,
  LOAD_FP: 0x07, STORE_FP: 0x27, OP_FP: 0x53, MADD: 0x43, MSUB: 0x47, NMSUB: 0x4b, NMADD: 0x4f,
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

const FFF = { rd: 'F', rs1: 'F', rs2: 'F' } as const;

interface FpOpts {
  readonly f3?: number;
  readonly rs2Sel?: number;
  readonly files?: InstrDef['files'];
  readonly syntax?: string;
}

/** OP-FP (single precision): funct7 selects the operation, low two bits = fmt S. */
function fpOp(name: string, f7: number, op: FpuOp, summary: string, o: FpOpts = {}): InstrDef {
  const rm = o.f3 === undefined;
  return {
    name, format: 'R', opcode: OP.OP_FP, funct3: o.f3, funct7: f7, alu: 'FPU', fpu: op, aluSrcA: 'REG', aluSrcB: 'REG',
    regWrite: true, wbSrc: 'ALU', files: o.files ?? FFF, rs2Sel: o.rs2Sel, rm, summary,
    syntax: o.syntax ?? `${name} rd, rs1, rs2${rm ? '[, rm]' : ''}`,
  };
}
function fma(name: string, opcode: number, op: FpuOp, summary: string): InstrDef {
  return { name, format: 'R4', opcode, alu: 'FPU', fpu: op, aluSrcA: 'REG', aluSrcB: 'REG', regWrite: true, wbSrc: 'ALU', files: FFF, rm: true, summary, syntax: `${name} rd, rs1, rs2, rs3[, rm]` };
}
function csrOp(name: string, f3: number, kind: 'RW' | 'RS' | 'RC', imm: boolean, summary: string): InstrDef {
  return { name, format: 'I', opcode: OP.SYSTEM, funct3: f3, alu: 'ADD', aluSrcA: 'REG', aluSrcB: 'IMM', regWrite: true, wbSrc: 'CSR', csr: kind, csrImm: imm, summary, syntax: `${name} rd, csr, ${imm ? 'uimm' : 'rs1'}` };
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
  // Zicsr
  csrOp('csrrw', 1, 'RW', false, 'rd = csr; csr = rs1'),
  csrOp('csrrs', 2, 'RS', false, 'rd = csr; csr |= rs1 (no write if rs1 is x0)'),
  csrOp('csrrc', 3, 'RC', false, 'rd = csr; csr &= ~rs1 (no write if rs1 is x0)'),
  csrOp('csrrwi', 5, 'RW', true, 'rd = csr; csr = uimm'),
  csrOp('csrrsi', 6, 'RS', true, 'rd = csr; csr |= uimm (no write if uimm is 0)'),
  csrOp('csrrci', 7, 'RC', true, 'rd = csr; csr &= ~uimm (no write if uimm is 0)'),
  // RV32F loads and stores
  { name: 'flw', format: 'I', opcode: OP.LOAD_FP, funct3: 2, alu: 'ADD', aluSrcA: 'REG', aluSrcB: 'IMM', regWrite: true, wbSrc: 'MEM', memRead: 'W', files: { rd: 'F' }, summary: 'rd (float) = word at rs1 + offset', syntax: 'flw rd, offset(rs1)' },
  { name: 'fsw', format: 'S', opcode: OP.STORE_FP, funct3: 2, alu: 'ADD', aluSrcA: 'REG', aluSrcB: 'IMM', regWrite: false, wbSrc: 'NONE', memWrite: 'W', files: { rs2: 'F' }, summary: 'store float rs2 at rs1 + offset', syntax: 'fsw rs2, offset(rs1)' },
  // RV32F arithmetic
  fpOp('fadd.s', 0x00, 'FADD', 'rd = rs1 + rs2'),
  fpOp('fsub.s', 0x04, 'FSUB', 'rd = rs1 - rs2'),
  fpOp('fmul.s', 0x08, 'FMUL', 'rd = rs1 × rs2'),
  fpOp('fdiv.s', 0x0c, 'FDIV', 'rd = rs1 ÷ rs2'),
  fpOp('fsqrt.s', 0x2c, 'FSQRT', 'rd = √rs1', { rs2Sel: 0, syntax: 'fsqrt.s rd, rs1[, rm]' }),
  fpOp('fmin.s', 0x14, 'FMIN', 'rd = the smaller of rs1, rs2 (a NaN operand is ignored)', { f3: 0 }),
  fpOp('fmax.s', 0x14, 'FMAX', 'rd = the larger of rs1, rs2 (a NaN operand is ignored)', { f3: 1 }),
  fma('fmadd.s', OP.MADD, 'FMADD', 'rd = rs1 × rs2 + rs3, rounded once'),
  fma('fmsub.s', OP.MSUB, 'FMSUB', 'rd = rs1 × rs2 − rs3, rounded once'),
  fma('fnmsub.s', OP.NMSUB, 'FNMSUB', 'rd = −(rs1 × rs2) + rs3, rounded once'),
  fma('fnmadd.s', OP.NMADD, 'FNMADD', 'rd = −(rs1 × rs2) − rs3, rounded once'),
  // RV32F sign injection
  fpOp('fsgnj.s', 0x10, 'FSGNJ', 'rd = |rs1| with the sign of rs2', { f3: 0 }),
  fpOp('fsgnjn.s', 0x10, 'FSGNJN', 'rd = |rs1| with the opposite sign of rs2', { f3: 1 }),
  fpOp('fsgnjx.s', 0x10, 'FSGNJX', 'rd = rs1 with its sign XOR the sign of rs2', { f3: 2 }),
  // RV32F compare and classify (integer results)
  fpOp('feq.s', 0x50, 'FEQ', 'x rd = (rs1 == rs2) ? 1 : 0 (quiet)', { f3: 2, files: { rs1: 'F', rs2: 'F' } }),
  fpOp('flt.s', 0x50, 'FLT', 'x rd = (rs1 < rs2) ? 1 : 0 (signals on NaN)', { f3: 1, files: { rs1: 'F', rs2: 'F' } }),
  fpOp('fle.s', 0x50, 'FLE', 'x rd = (rs1 <= rs2) ? 1 : 0 (signals on NaN)', { f3: 0, files: { rs1: 'F', rs2: 'F' } }),
  fpOp('fclass.s', 0x70, 'FCLASS', "x rd = one-hot mask of rs1's category (zero, normal, NaN, ...)", { f3: 1, rs2Sel: 0, files: { rs1: 'F' }, syntax: 'fclass.s rd, rs1' }),
  // RV32F conversions and moves
  fpOp('fcvt.w.s', 0x60, 'FCVT_W_S', 'x rd = rs1 converted to a signed integer', { rs2Sel: 0, files: { rs1: 'F' }, syntax: 'fcvt.w.s rd, rs1[, rm]' }),
  fpOp('fcvt.wu.s', 0x60, 'FCVT_WU_S', 'x rd = rs1 converted to an unsigned integer', { rs2Sel: 1, files: { rs1: 'F' }, syntax: 'fcvt.wu.s rd, rs1[, rm]' }),
  fpOp('fcvt.s.w', 0x68, 'FCVT_S_W', 'rd = signed integer x rs1 converted to float', { rs2Sel: 0, files: { rd: 'F' }, syntax: 'fcvt.s.w rd, rs1[, rm]' }),
  fpOp('fcvt.s.wu', 0x68, 'FCVT_S_WU', 'rd = unsigned integer x rs1 converted to float', { rs2Sel: 1, files: { rd: 'F' }, syntax: 'fcvt.s.wu rd, rs1[, rm]' }),
  fpOp('fmv.x.w', 0x70, 'FMV_X_W', 'x rd = the raw bits of f rs1', { f3: 0, rs2Sel: 0, files: { rs1: 'F' }, syntax: 'fmv.x.w rd, rs1' }),
  fpOp('fmv.w.x', 0x78, 'FMV_W_X', 'f rd = the raw bits of x rs1', { f3: 0, rs2Sel: 0, files: { rd: 'F' }, syntax: 'fmv.w.x rd, rs1' }),
];

export const INSTR_BY_NAME: ReadonlyMap<string, InstrDef> = new Map(INSTRUCTIONS.map((d) => [d.name, d]));

export const OPCODES = OP;
