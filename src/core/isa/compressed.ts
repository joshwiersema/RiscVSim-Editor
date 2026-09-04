/**
 * RV32C: expansion of 16-bit compressed instructions into their 32-bit
 * equivalents, and compression of 32-bit instructions when a compressed
 * form exists. The simulator always executes the expanded form, exactly
 * like a hardware "decompressor" in front of the decoder.
 */
import { encode } from './encode';
import { INSTR_BY_NAME } from './instructions';
import { bits } from './decode';

const f = (word: number, hi: number, lo: number) => bits(word, hi, lo);
const sext = (v: number, w: number) => (v << (32 - w)) >> (32 - w);
/** Map a 3-bit register field (x8..x15). */
const rp = (r3: number) => 8 + r3;

export interface Expanded {
  readonly word: number;
  /** Compressed mnemonic, e.g. "c.addi". */
  readonly name: string;
}

const enc = (name: string, ops: { rd?: number; rs1?: number; rs2?: number; imm?: number }): number => {
  const def = INSTR_BY_NAME.get(name);
  if (!def) throw new Error(`no such instruction ${name}`);
  return encode(def, ops);
};

/** Expand a 16-bit instruction. Returns null for illegal/unsupported encodings. */
export function expandCompressed(h: number): Expanded | null {
  const op = h & 3;
  const funct3 = f(h, 15, 13);
  if (op === 3) return null;

  if (op === 0) {
    switch (funct3) {
      case 0: { // c.addi4spn
        const imm = (f(h, 10, 7) << 6) | (f(h, 12, 11) << 4) | (f(h, 5, 5) << 3) | (f(h, 6, 6) << 2);
        if (imm === 0) return null;
        return { word: enc('addi', { rd: rp(f(h, 4, 2)), rs1: 2, imm }), name: 'c.addi4spn' };
      }
      case 2: { // c.lw
        const imm = (f(h, 5, 5) << 6) | (f(h, 12, 10) << 3) | (f(h, 6, 6) << 2);
        return { word: enc('lw', { rd: rp(f(h, 4, 2)), rs1: rp(f(h, 9, 7)), imm }), name: 'c.lw' };
      }
      case 6: { // c.sw
        const imm = (f(h, 5, 5) << 6) | (f(h, 12, 10) << 3) | (f(h, 6, 6) << 2);
        return { word: enc('sw', { rs2: rp(f(h, 4, 2)), rs1: rp(f(h, 9, 7)), imm }), name: 'c.sw' };
      }
      default: return null;
    }
  }

  if (op === 1) {
    const rd = f(h, 11, 7);
    const imm6 = sext((f(h, 12, 12) << 5) | f(h, 6, 2), 6);
    switch (funct3) {
      case 0: // c.nop / c.addi
        return { word: enc('addi', { rd, rs1: rd, imm: imm6 }), name: rd === 0 ? 'c.nop' : 'c.addi' };
      case 1: return { word: enc('jal', { rd: 1, imm: cjImm(h) }), name: 'c.jal' };
      case 2: return { word: enc('addi', { rd, rs1: 0, imm: imm6 }), name: 'c.li' };
      case 3: {
        if (rd === 2) { // c.addi16sp
          const imm = sext((f(h, 12, 12) << 9) | (f(h, 4, 3) << 7) | (f(h, 5, 5) << 6) | (f(h, 2, 2) << 5) | (f(h, 6, 6) << 4), 10);
          if (imm === 0) return null;
          return { word: enc('addi', { rd: 2, rs1: 2, imm }), name: 'c.addi16sp' };
        }
        if (imm6 === 0) return null;
        return { word: enc('lui', { rd, imm: (imm6 << 12) >>> 0 }), name: 'c.lui' };
      }
      case 4: {
        const rdp = rp(f(h, 9, 7));
        const sub = f(h, 11, 10);
        const shamt = (f(h, 12, 12) << 5) | f(h, 6, 2);
        if (sub === 0) return shamt === 0 || shamt > 31 ? null : { word: enc('srli', { rd: rdp, rs1: rdp, imm: shamt }), name: 'c.srli' };
        if (sub === 1) return shamt === 0 || shamt > 31 ? null : { word: enc('srai', { rd: rdp, rs1: rdp, imm: shamt }), name: 'c.srai' };
        if (sub === 2) return { word: enc('andi', { rd: rdp, rs1: rdp, imm: imm6 }), name: 'c.andi' };
        if (f(h, 12, 12) === 1) return null; // RV64-only ops
        const rs2p = rp(f(h, 4, 2));
        const names = ['sub', 'xor', 'or', 'and'];
        const n = names[f(h, 6, 5)];
        return { word: enc(n, { rd: rdp, rs1: rdp, rs2: rs2p }), name: `c.${n}` };
      }
      case 5: return { word: enc('jal', { rd: 0, imm: cjImm(h) }), name: 'c.j' };
      case 6: return { word: enc('beq', { rs1: rp(f(h, 9, 7)), rs2: 0, imm: cbImm(h) }), name: 'c.beqz' };
      case 7: return { word: enc('bne', { rs1: rp(f(h, 9, 7)), rs2: 0, imm: cbImm(h) }), name: 'c.bnez' };
      default: return null;
    }
  }

  // op === 2
  const rd = f(h, 11, 7);
  const rs2 = f(h, 6, 2);
  switch (funct3) {
    case 0: {
      const shamt = (f(h, 12, 12) << 5) | rs2;
      if (shamt === 0 || shamt > 31 || rd === 0) return null;
      return { word: enc('slli', { rd, rs1: rd, imm: shamt }), name: 'c.slli' };
    }
    case 2: {
      if (rd === 0) return null;
      const imm = (f(h, 3, 2) << 6) | (f(h, 12, 12) << 5) | (f(h, 6, 4) << 2);
      return { word: enc('lw', { rd, rs1: 2, imm }), name: 'c.lwsp' };
    }
    case 4: {
      if (f(h, 12, 12) === 0) {
        if (rs2 === 0) return rd === 0 ? null : { word: enc('jalr', { rd: 0, rs1: rd, imm: 0 }), name: 'c.jr' };
        return { word: enc('add', { rd, rs1: 0, rs2 }), name: 'c.mv' };
      }
      if (rs2 === 0) {
        if (rd === 0) return { word: enc('ebreak', {}), name: 'c.ebreak' };
        return { word: enc('jalr', { rd: 1, rs1: rd, imm: 0 }), name: 'c.jalr' };
      }
      return { word: enc('add', { rd, rs1: rd, rs2 }), name: 'c.add' };
    }
    case 6: {
      const imm = (f(h, 8, 7) << 6) | (f(h, 12, 9) << 2);
      return { word: enc('sw', { rs2, rs1: 2, imm }), name: 'c.swsp' };
    }
    default: return null;
  }
}

function cjImm(h: number): number {
  return sext((f(h, 12, 12) << 11) | (f(h, 8, 8) << 10) | (f(h, 10, 9) << 8) | (f(h, 6, 6) << 7) | (f(h, 7, 7) << 6) | (f(h, 2, 2) << 5) | (f(h, 11, 11) << 4) | (f(h, 5, 3) << 1), 12);
}
function cbImm(h: number): number {
  return sext((f(h, 12, 12) << 8) | (f(h, 6, 5) << 6) | (f(h, 2, 2) << 5) | (f(h, 11, 10) << 3) | (f(h, 4, 3) << 1), 9);
}

/* ------------------------------------------------------------ compression */

const inRange = (v: number, w: number) => v >= -(1 << (w - 1)) && v < 1 << (w - 1);
const isRp = (r: number) => r >= 8 && r <= 15;
const cj = (imm: number) => (bit(imm, 11) << 12) | (bit(imm, 4) << 11) | (bits2(imm, 9, 8) << 9) | (bit(imm, 10) << 8) | (bit(imm, 6) << 7) | (bit(imm, 7) << 6) | (bits2(imm, 3, 1) << 3) | (bit(imm, 5) << 2);
const cb = (imm: number) => (bit(imm, 8) << 12) | (bits2(imm, 4, 3) << 10) | (bits2(imm, 7, 6) << 5) | (bits2(imm, 2, 1) << 3) | (bit(imm, 5) << 2);
const bit = (v: number, i: number) => (v >>> i) & 1;
const bits2 = (v: number, hi: number, lo: number) => (v >>> lo) & ((1 << (hi - lo + 1)) - 1);
const imm6 = (v: number) => (bit(v, 5) << 12) | (bits2(v, 4, 0) << 2);

/**
 * Try to compress a 32-bit instruction. Returns the 16-bit encoding and
 * compressed mnemonic, or null if no compressed form applies.
 */
export function compressWord(word: number): Expanded | null {
  const opcode = f(word, 6, 0), rd = f(word, 11, 7), f3 = f(word, 14, 12), rs1 = f(word, 19, 15), rs2 = f(word, 24, 20), f7 = f(word, 31, 25);
  const immI = sext(f(word, 31, 20), 12);
  switch (opcode) {
    case 0x13: { // OP-IMM
      if (f3 === 0) {
        if (rd === 0 && rs1 === 0 && immI === 0) return { word: 0x0001, name: 'c.nop' };
        if (rd !== 0 && rs1 === rd && immI !== 0 && inRange(immI, 6)) return { word: 0x0001 | (rd << 7) | imm6(immI), name: 'c.addi' };
        if (rd !== 0 && rs1 === 0 && inRange(immI, 6)) return { word: 0x4001 | (rd << 7) | imm6(immI), name: 'c.li' };
        if (rd === 2 && rs1 === 2 && immI !== 0 && (immI & 0xf) === 0 && inRange(immI, 10)) {
          return { word: 0x6101 | (bit(immI, 9) << 12) | (bit(immI, 4) << 6) | (bit(immI, 6) << 5) | (bits2(immI, 8, 7) << 3) | (bit(immI, 5) << 2), name: 'c.addi16sp' };
        }
        if (isRp(rd) && rs1 === 2 && immI > 0 && (immI & 3) === 0 && immI < 1024) {
          return { word: 0x0000 | (bits2(immI, 5, 4) << 11) | (bits2(immI, 9, 6) << 7) | (bit(immI, 2) << 6) | (bit(immI, 3) << 5) | ((rd - 8) << 2), name: 'c.addi4spn' };
        }
        return null;
      }
      const shamt = immI & 0x1f;
      if (f3 === 1 && f7 === 0 && rd !== 0 && rs1 === rd && shamt !== 0) return { word: 0x0002 | (rd << 7) | (shamt << 2), name: 'c.slli' };
      if (f3 === 5 && isRp(rd) && rs1 === rd && shamt !== 0) {
        if (f7 === 0) return { word: 0x8001 | ((rd - 8) << 7) | (shamt << 2), name: 'c.srli' };
        if (f7 === 0x20) return { word: 0x8401 | ((rd - 8) << 7) | (shamt << 2), name: 'c.srai' };
      }
      if (f3 === 7 && isRp(rd) && rs1 === rd && inRange(immI, 6)) return { word: 0x8801 | ((rd - 8) << 7) | imm6(immI), name: 'c.andi' };
      return null;
    }
    case 0x33: { // OP
      if (f7 === 0 && f3 === 0) {
        if (rd !== 0 && rs1 === 0 && rs2 !== 0) return { word: 0x8002 | (rd << 7) | (rs2 << 2), name: 'c.mv' };
        if (rd !== 0 && rs1 === rd && rs2 !== 0) return { word: 0x9002 | (rd << 7) | (rs2 << 2), name: 'c.add' };
      }
      if (isRp(rd) && rs1 === rd && isRp(rs2)) {
        const table: Record<string, number> = { '32-0': 0, '0-4': 1, '0-6': 2, '0-7': 3 };
        const k = `${f7}-${f3}`;
        if (k in table) return { word: 0x8c01 | ((rd - 8) << 7) | (table[k] << 5) | ((rs2 - 8) << 2), name: `c.${['sub', 'xor', 'or', 'and'][table[k]]}` };
      }
      return null;
    }
    case 0x03: { // LOAD (lw only)
      if (f3 !== 2) return null;
      if (rd !== 0 && rs1 === 2 && immI >= 0 && (immI & 3) === 0 && immI < 256) return { word: 0x4002 | (rd << 7) | (bit(immI, 5) << 12) | (bits2(immI, 4, 2) << 4) | (bits2(immI, 7, 6) << 2), name: 'c.lwsp' };
      if (isRp(rd) && isRp(rs1) && immI >= 0 && (immI & 3) === 0 && immI < 128) return { word: 0x4000 | (bits2(immI, 5, 3) << 10) | ((rs1 - 8) << 7) | (bit(immI, 2) << 6) | (bit(immI, 6) << 5) | ((rd - 8) << 2), name: 'c.lw' };
      return null;
    }
    case 0x23: { // STORE (sw only)
      if (f3 !== 2) return null;
      const immS = sext((f7 << 5) | rd, 12);
      if (rs1 === 2 && immS >= 0 && (immS & 3) === 0 && immS < 256) return { word: 0xc002 | (bits2(immS, 5, 2) << 9) | (bits2(immS, 7, 6) << 7) | (rs2 << 2), name: 'c.swsp' };
      if (isRp(rs1) && isRp(rs2) && immS >= 0 && (immS & 3) === 0 && immS < 128) return { word: 0xc000 | (bits2(immS, 5, 3) << 10) | ((rs1 - 8) << 7) | (bit(immS, 2) << 6) | (bit(immS, 6) << 5) | ((rs2 - 8) << 2), name: 'c.sw' };
      return null;
    }
    case 0x37: { // LUI
      const imm = word >> 12;
      if (rd !== 0 && rd !== 2 && imm !== 0 && inRange(imm, 6)) return { word: 0x6001 | (rd << 7) | imm6(imm), name: 'c.lui' };
      return null;
    }
    case 0x6f: { // JAL
      const imm = sext((bit(word, 31) << 20) | (bits2(word, 19, 12) << 12) | (bit(word, 20) << 11) | (bits2(word, 30, 21) << 1), 21);
      if (!inRange(imm, 12)) return null;
      if (rd === 0) return { word: 0xa001 | cj(imm), name: 'c.j' };
      if (rd === 1) return { word: 0x2001 | cj(imm), name: 'c.jal' };
      return null;
    }
    case 0x67: { // JALR
      if (f3 !== 0 || immI !== 0 || rs1 === 0) return null;
      if (rd === 0) return { word: 0x8002 | (rs1 << 7), name: 'c.jr' };
      if (rd === 1) return { word: 0x9002 | (rs1 << 7), name: 'c.jalr' };
      return null;
    }
    case 0x63: { // BRANCH
      if (f3 !== 0 && f3 !== 1) return null;
      if (!isRp(rs1) || rs2 !== 0) return null;
      const imm = sext((bit(word, 31) << 12) | (bit(word, 7) << 11) | (bits2(word, 30, 25) << 5) | (bits2(word, 11, 8) << 1), 13);
      if (!inRange(imm, 9)) return null;
      return { word: (f3 === 0 ? 0xc001 : 0xe001) | ((rs1 - 8) << 7) | cb(imm), name: f3 === 0 ? 'c.beqz' : 'c.bnez' };
    }
    case 0x73:
      if (word === 0x00100073) return { word: 0x9002, name: 'c.ebreak' };
      return null;
    default: return null;
  }
}

/** Names of all RV32C mnemonics the assembler accepts explicitly. */
export const COMPRESSED_NAMES: readonly string[] = [
  'c.addi4spn', 'c.lw', 'c.sw', 'c.nop', 'c.addi', 'c.jal', 'c.li', 'c.addi16sp', 'c.lui', 'c.srli', 'c.srai', 'c.andi',
  'c.sub', 'c.xor', 'c.or', 'c.and', 'c.j', 'c.beqz', 'c.bnez', 'c.slli', 'c.lwsp', 'c.jr', 'c.mv', 'c.ebreak', 'c.jalr', 'c.add', 'c.swsp',
];

/**
 * Lower an explicit `c.*` mnemonic to the 32-bit instruction it expands to,
 * so the assembler can reuse the normal operand parser and then compress.
 */
export function lowerCompressedMnemonic(name: string, ops: readonly string[]): { op: string; operands: string[] } | string {
  const need = (n: number) => (ops.length === n ? null : `${name} expects ${n} operand${n === 1 ? '' : 's'}`);
  switch (name) {
    case 'c.nop': return need(0) ?? { op: 'addi', operands: ['x0', 'x0', '0'] };
    case 'c.addi': return need(2) ?? { op: 'addi', operands: [ops[0], ops[0], ops[1]] };
    case 'c.addi16sp': return need(1) ?? { op: 'addi', operands: ['sp', 'sp', ops[0]] };
    case 'c.addi4spn': return need(2) ?? { op: 'addi', operands: [ops[0], 'sp', ops[1]] };
    case 'c.li': return need(2) ?? { op: 'addi', operands: [ops[0], 'x0', ops[1]] };
    case 'c.lui': return need(2) ?? { op: 'lui', operands: [ops[0], ops[1]] };
    case 'c.mv': return need(2) ?? { op: 'add', operands: [ops[0], 'x0', ops[1]] };
    case 'c.add': return need(2) ?? { op: 'add', operands: [ops[0], ops[0], ops[1]] };
    case 'c.sub': case 'c.xor': case 'c.or': case 'c.and': return need(2) ?? { op: name.slice(2), operands: [ops[0], ops[0], ops[1]] };
    case 'c.andi': return need(2) ?? { op: 'andi', operands: [ops[0], ops[0], ops[1]] };
    case 'c.slli': case 'c.srli': case 'c.srai': return need(2) ?? { op: name.slice(2), operands: [ops[0], ops[0], ops[1]] };
    case 'c.lw': return need(2) ?? { op: 'lw', operands: [ops[0], ops[1]] };
    case 'c.sw': return need(2) ?? { op: 'sw', operands: [ops[0], ops[1]] };
    case 'c.lwsp': return need(2) ?? { op: 'lw', operands: [ops[0], /\(/.test(ops[1]) ? ops[1] : `${ops[1]}(sp)`] };
    case 'c.swsp': return need(2) ?? { op: 'sw', operands: [ops[0], /\(/.test(ops[1]) ? ops[1] : `${ops[1]}(sp)`] };
    case 'c.j': return need(1) ?? { op: 'jal', operands: ['x0', ops[0]] };
    case 'c.jal': return need(1) ?? { op: 'jal', operands: ['ra', ops[0]] };
    case 'c.jr': return need(1) ?? { op: 'jalr', operands: ['x0', '0', ops[0]] };
    case 'c.jalr': return need(1) ?? { op: 'jalr', operands: ['ra', '0', ops[0]] };
    case 'c.beqz': return need(2) ?? { op: 'beq', operands: [ops[0], 'x0', ops[1]] };
    case 'c.bnez': return need(2) ?? { op: 'bne', operands: [ops[0], 'x0', ops[1]] };
    case 'c.ebreak': return need(0) ?? { op: 'ebreak', operands: [] };
    default: return `unknown compressed instruction ${name}`;
  }
}
