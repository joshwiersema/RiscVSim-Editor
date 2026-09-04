import type { AluOp, BranchCond } from '../isa/instructions';

const toU = (v: number) => v >>> 0;
const toS = (v: number) => v | 0;

function mulhu(a: number, b: number): number {
  const r = (BigInt(toU(a)) * BigInt(toU(b))) >> 32n;
  return Number(r & 0xffffffffn) | 0;
}

export function alu(op: AluOp, a: number, b: number): number {
  switch (op) {
    case 'ADD': return (a + b) | 0;
    case 'SUB': return (a - b) | 0;
    case 'AND': return a & b;
    case 'OR': return a | b;
    case 'XOR': return a ^ b;
    case 'SLL': return a << (b & 31);
    case 'SRL': return toS(toU(a) >>> (b & 31));
    case 'SRA': return a >> (b & 31);
    case 'SLT': return toS(a) < toS(b) ? 1 : 0;
    case 'SLTU': return toU(a) < toU(b) ? 1 : 0;
    case 'MUL': return Math.imul(a, b);
    case 'MULH': return Number(((BigInt(toS(a)) * BigInt(toS(b))) >> 32n) & 0xffffffffn) | 0;
    case 'MULHSU': return Number(((BigInt(toS(a)) * BigInt(toU(b))) >> 32n) & 0xffffffffn) | 0;
    case 'MULHU': return mulhu(a, b);
    case 'DIV': {
      if (b === 0) return -1;
      if (toS(a) === -2147483648 && toS(b) === -1) return -2147483648;
      return (toS(a) / toS(b)) | 0;
    }
    case 'DIVU': return b === 0 ? -1 : toS(Math.floor(toU(a) / toU(b)));
    case 'REM': {
      if (b === 0) return toS(a);
      if (toS(a) === -2147483648 && toS(b) === -1) return 0;
      return toS(a) % toS(b);
    }
    case 'REMU': return b === 0 ? toS(a) : toS(toU(a) % toU(b));
    case 'COPY_B': return b | 0;
  }
}

export function branchTaken(cond: BranchCond, a: number, b: number): boolean {
  switch (cond) {
    case 'EQ': return a === b;
    case 'NE': return a !== b;
    case 'LT': return toS(a) < toS(b);
    case 'GE': return toS(a) >= toS(b);
    case 'LTU': return toU(a) < toU(b);
    case 'GEU': return toU(a) >= toU(b);
  }
}

/** Human-readable symbol for an ALU op, used in narration. */
export function aluSymbol(op: AluOp): string {
  const map: Record<AluOp, string> = {
    ADD: '+', SUB: '-', AND: '&', OR: '|', XOR: '^', SLL: '<<', SRL: '>>>', SRA: '>>',
    SLT: '<', SLTU: '<u', MUL: '*', MULH: '*h', MULHSU: '*hsu', MULHU: '*hu',
    DIV: '/', DIVU: '/u', REM: '%', REMU: '%u', COPY_B: 'pass',
  };
  return map[op];
}
