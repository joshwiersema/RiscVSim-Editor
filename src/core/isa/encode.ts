import type { InstrDef } from './instructions';

export interface Operands {
  readonly rd?: number;
  readonly rs1?: number;
  readonly rs2?: number;
  readonly imm?: number;
}

function field(value: number, hi: number, lo: number): number {
  const width = hi - lo + 1;
  const mask = width >= 32 ? 0xffffffff : (1 << width) - 1;
  return ((value & mask) << lo) >>> 0;
}

/** Encode an instruction definition and operands into a 32-bit word. */
export function encode(def: InstrDef, ops: Operands): number {
  const rd = ops.rd ?? 0, rs1 = ops.rs1 ?? 0, rs2 = ops.rs2 ?? 0, imm = ops.imm ?? 0;
  const f3 = def.funct3 ?? 0, f7 = def.funct7 ?? 0;
  let w = def.opcode;
  switch (def.format) {
    case 'R':
      w |= field(rd, 11, 7) | field(f3, 14, 12) | field(rs1, 19, 15) | field(rs2, 24, 20) | field(f7, 31, 25);
      break;
    case 'I': {
      const immField = def.funct7 !== undefined ? (imm & 0x1f) | (f7 << 5) : imm;
      const sys = def.system === 'EBREAK' ? 1 : 0;
      w |= field(rd, 11, 7) | field(f3, 14, 12) | field(rs1, 19, 15) | field(def.system ? sys : immField, 31, 20);
      break;
    }
    case 'S':
      w |= field(imm & 0x1f, 11, 7) | field(f3, 14, 12) | field(rs1, 19, 15) | field(rs2, 24, 20) | field(imm >> 5, 31, 25);
      break;
    case 'B':
      w |= field((imm >> 11) & 1, 7, 7) | field((imm >> 1) & 0xf, 11, 8) | field(f3, 14, 12)
        | field(rs1, 19, 15) | field(rs2, 24, 20) | field((imm >> 5) & 0x3f, 30, 25) | field((imm >> 12) & 1, 31, 31);
      break;
    case 'U':
      w |= field(rd, 11, 7) | field(imm >>> 12, 31, 12);
      break;
    case 'J':
      w |= field(rd, 11, 7) | field((imm >> 12) & 0xff, 19, 12) | field((imm >> 11) & 1, 20, 20)
        | field((imm >> 1) & 0x3ff, 30, 21) | field((imm >> 20) & 1, 31, 31);
      break;
  }
  return w >>> 0;
}
