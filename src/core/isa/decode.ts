import { INSTRUCTIONS, OPCODES, type InstrDef, type Format } from './instructions';
import { expandCompressed } from './compressed';
import { csrName } from './csr';
import { operandName } from './operands';
import { RM_MNEMONICS } from '../fp/format';

/** Bit-level view of a 32-bit instruction word plus the matching definition. */
export interface Decoded {
  /** The 32-bit (expanded) instruction word. */
  readonly word: number;
  /** 2 for RV32C instructions, else 4. */
  readonly size: 2 | 4;
  /** Original 16-bit encoding and compressed mnemonic, if compressed. */
  readonly compressed: { readonly half: number; readonly name: string } | null;
  readonly def: InstrDef | null;
  readonly opcode: number;
  readonly rd: number;
  readonly rs1: number;
  readonly rs2: number;
  /** Third source register (R4 fused multiply-add), bits 31:27. */
  readonly rs3: number;
  readonly funct3: number;
  readonly funct7: number;
  /** Sign-extended immediate for the instruction's format (0 for R-type). */
  readonly imm: number;
  readonly format: Format | null;
}

export const NOP_WORD = 0x00000013; // addi x0, x0, 0

export function bits(word: number, hi: number, lo: number): number {
  return (word >>> lo) & ((1 << (hi - lo + 1)) - 1);
}

function signExtend(value: number, width: number): number {
  const shift = 32 - width;
  return (value << shift) >> shift;
}

/** Extract the immediate for a given format. */
export function extractImm(word: number, format: Format): number {
  switch (format) {
    case 'I': return signExtend(bits(word, 31, 20), 12);
    case 'S': return signExtend((bits(word, 31, 25) << 5) | bits(word, 11, 7), 12);
    case 'B': return signExtend((bits(word, 31, 31) << 12) | (bits(word, 7, 7) << 11) | (bits(word, 30, 25) << 5) | (bits(word, 11, 8) << 1), 13);
    case 'U': return (word & 0xfffff000) | 0;
    case 'J': return signExtend((bits(word, 31, 31) << 20) | (bits(word, 19, 12) << 12) | (bits(word, 20, 20) << 11) | (bits(word, 30, 21) << 1), 21);
    case 'R': case 'R4': return 0;
  }
}

function matchDef(word: number): InstrDef | null {
  const opcode = bits(word, 6, 0);
  const funct3 = bits(word, 14, 12);
  const funct7 = bits(word, 31, 25);
  const imm12 = bits(word, 31, 20);
  for (const def of INSTRUCTIONS) {
    if (def.opcode !== opcode) continue;
    if (def.funct3 !== undefined && def.funct3 !== funct3) continue;
    if (def.funct7 !== undefined && def.funct7 !== funct7) continue;
    if (def.rs2Sel !== undefined && def.rs2Sel !== bits(word, 24, 20)) continue;
    if (def.rm && (funct3 === 5 || funct3 === 6)) continue; // reserved rounding modes
    if (def.format === 'R4' && bits(word, 26, 25) !== 0) continue; // fmt must be single precision
    if (def.system === 'ECALL' && imm12 !== 0) continue;
    if (def.system === 'EBREAK' && imm12 !== 1) continue;
    return def;
  }
  return null;
}

export function decode(word: number, compressed: Decoded['compressed'] = null): Decoded {
  const w = word >>> 0;
  const def = matchDef(w);
  const format = def?.format ?? null;
  return {
    word: w,
    size: compressed ? 2 : 4,
    compressed,
    def,
    opcode: bits(w, 6, 0),
    rd: bits(w, 11, 7),
    rs1: bits(w, 19, 15),
    rs2: bits(w, 24, 20),
    rs3: bits(w, 31, 27),
    funct3: bits(w, 14, 12),
    funct7: bits(w, 31, 25),
    imm: format ? extractImm(w, format) : 0,
    format,
  };
}

/** Render a decoded instruction as canonical assembly text. */
export function disassemble(d: Decoded, pc?: number, labelFor?: (addr: number) => string | undefined): string {
  const text = disassembleExpanded(d, pc, labelFor);
  if (!d.compressed || !d.def) return text;
  // Show the compressed mnemonic with the expanded operands, e.g. "c.addi t0, t0, 1".
  return `${d.compressed.name} ${text.replace(/^\S+\s*/, '')}`.trim();
}

function disassembleExpanded(d: Decoded, pc?: number, labelFor?: (addr: number) => string | undefined): string {
  const def = d.def;
  if (!def) return d.compressed ? `.half 0x${d.compressed.half.toString(16).padStart(4, '0')}` : `.word 0x${d.word.toString(16).padStart(8, '0')}`;
  if (d.word === NOP_WORD) return 'nop';
  const rd = operandName(d, 'rd'), rs1 = operandName(d, 'rs1'), rs2 = operandName(d, 'rs2');
  // Show the rounding mode only when it is not the default (dynamic).
  const rm = def.rm && d.funct3 !== 7 ? `, ${RM_MNEMONICS[d.funct3]}` : '';
  const target = (offset: number): string => {
    if (pc === undefined) return String(offset);
    const addr = (pc + offset) >>> 0;
    const label = labelFor?.(addr);
    return label ? `${label}` : `0x${addr.toString(16)}`;
  };
  switch (def.format) {
    case 'R':
      if (def.rs2Sel !== undefined) return `${def.name} ${rd}, ${rs1}${rm}`;
      return `${def.name} ${rd}, ${rs1}, ${rs2}${rm}`;
    case 'R4': return `${def.name} ${rd}, ${rs1}, ${rs2}, ${operandName(d, 'rs3')}${rm}`;
    case 'I':
      if (def.system) return def.name;
      if (def.csr) return `${def.name} ${rd}, ${csrName(d.imm)}, ${def.csrImm ? d.rs1 : rs1}`;
      if (def.memRead) return `${def.name} ${rd}, ${d.imm}(${rs1})`;
      if (def.jump === 'JALR') return `${def.name} ${rd}, ${d.imm}(${rs1})`;
      if (def.name === 'slli' || def.name === 'srli' || def.name === 'srai') return `${def.name} ${rd}, ${rs1}, ${d.imm & 0x1f}`;
      return `${def.name} ${rd}, ${rs1}, ${d.imm}`;
    case 'S': return `${def.name} ${rs2}, ${d.imm}(${rs1})`;
    case 'B': return `${def.name} ${rs1}, ${rs2}, ${target(d.imm)}`;
    case 'U': return `${def.name} ${rd}, 0x${((d.imm >>> 12) & 0xfffff).toString(16)}`;
    case 'J': return `${def.name} ${rd}, ${target(d.imm)}`;
  }
}

export function isStoreOpcode(opcode: number): boolean {
  return opcode === OPCODES.STORE;
}

/**
 * Decode the instruction whose first halfword is `half` (and full word is
 * `word` if it turns out to be 32-bit). Compressed instructions are
 * expanded to their 32-bit equivalent, tagged with size 2.
 */
export function decodeAt(half: number, word: number): Decoded {
  if ((half & 3) !== 3) {
    const ex = expandCompressed(half & 0xffff);
    if (!ex) return { ...decode(0), size: 2, compressed: { half: half & 0xffff, name: 'c.illegal' }, def: null };
    return decode(ex.word, { half: half & 0xffff, name: ex.name });
  }
  return decode(word);
}

/** Illegal 32-bit instruction (all-zero) helper. */
export const ILLEGAL: Decoded = decode(0);
