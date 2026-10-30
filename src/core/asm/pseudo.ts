/**
 * Pseudo-instruction expansion. Each expander returns the list of real
 * instruction lines (mnemonic + operands) it lowers to. Symbolic operands are
 * passed through untouched so the encoder can resolve them.
 */
export interface Expanded {
  readonly op: string;
  readonly operands: readonly string[];
}

type Expander = (ops: readonly string[]) => Expanded[] | string;

const one = (op: string, ...operands: string[]): Expanded => ({ op, operands });

function arity(n: number, fn: Expander): Expander {
  return (ops) => (ops.length === n ? fn(ops) : `expected ${n} operand${n === 1 ? '' : 's'}, got ${ops.length}`);
}

/** Does this token look like a plain integer we can lower `li` for at expansion time? */
export function parseIntLiteral(tok: string): number | null {
  const t = tok.trim();
  if (/^-?0[xX][0-9a-fA-F]+$/.test(t)) return Number.parseInt(t, 16) | 0;
  if (/^-?0[bB][01]+$/.test(t)) return (t.startsWith('-') ? -1 : 1) * Number.parseInt(t.replace(/^-?0[bB]/, ''), 2) | 0;
  if (/^-?\d+$/.test(t)) return Number.parseInt(t, 10) | 0;
  return null;
}

const PSEUDO: Record<string, Expander> = {
  nop: arity(0, () => [one('addi', 'x0', 'x0', '0')]),
  mv: arity(2, ([rd, rs]) => [one('addi', rd, rs, '0')]),
  not: arity(2, ([rd, rs]) => [one('xori', rd, rs, '-1')]),
  neg: arity(2, ([rd, rs]) => [one('sub', rd, 'x0', rs)]),
  seqz: arity(2, ([rd, rs]) => [one('sltiu', rd, rs, '1')]),
  snez: arity(2, ([rd, rs]) => [one('sltu', rd, 'x0', rs)]),
  sltz: arity(2, ([rd, rs]) => [one('slt', rd, rs, 'x0')]),
  sgtz: arity(2, ([rd, rs]) => [one('slt', rd, 'x0', rs)]),
  beqz: arity(2, ([rs, l]) => [one('beq', rs, 'x0', l)]),
  bnez: arity(2, ([rs, l]) => [one('bne', rs, 'x0', l)]),
  blez: arity(2, ([rs, l]) => [one('bge', 'x0', rs, l)]),
  bgez: arity(2, ([rs, l]) => [one('bge', rs, 'x0', l)]),
  bltz: arity(2, ([rs, l]) => [one('blt', rs, 'x0', l)]),
  bgtz: arity(2, ([rs, l]) => [one('blt', 'x0', rs, l)]),
  bgt: arity(3, ([a, b, l]) => [one('blt', b, a, l)]),
  ble: arity(3, ([a, b, l]) => [one('bge', b, a, l)]),
  bgtu: arity(3, ([a, b, l]) => [one('bltu', b, a, l)]),
  bleu: arity(3, ([a, b, l]) => [one('bgeu', b, a, l)]),
  j: arity(1, ([l]) => [one('jal', 'x0', l)]),
  jr: arity(1, ([rs]) => [one('jalr', 'x0', '0', rs)]),
  ret: arity(0, () => [one('jalr', 'x0', '0', 'ra')]),
  call: arity(1, ([l]) => [one('auipc', 'ra', `%pcrel_hi(${l})`), one('jalr', 'ra', `%pcrel_lo(${l})`, 'ra')]),
  tail: arity(1, ([l]) => [one('auipc', 't1', `%pcrel_hi(${l})`), one('jalr', 'x0', `%pcrel_lo(${l})`, 't1')]),
  la: arity(2, ([rd, sym]) => [one('auipc', rd, `%pcrel_hi(${sym})`), one('addi', rd, rd, `%pcrel_lo(${sym})`)]),
  li: arity(2, ([rd, immTok]) => {
    const v = parseIntLiteral(immTok);
    if (v === null) return [one('lui', rd, `%hi(${immTok})`), one('addi', rd, rd, `%lo(${immTok})`)];
    if (v >= -2048 && v <= 2047) return [one('addi', rd, 'x0', String(v))];
    const lo = (v << 20) >> 20;
    const hi = ((v - lo) >>> 12) & 0xfffff;
    if (lo === 0) return [one('lui', rd, String(hi))];
    return [one('lui', rd, String(hi)), one('addi', rd, rd, String(lo))];
  }),
  jal: (ops) => (ops.length === 1 ? [one('jal', 'ra', ops[0])] : [one('jal', ...ops)]),
  jalr: (ops) => {
    if (ops.length === 1) return [one('jalr', 'ra', '0', ops[0])];
    if (ops.length === 2 && !/\(/.test(ops[1])) return [one('jalr', ops[0], '0', ops[1])];
    return [one('jalr', ...ops)];
  },
};

// Loads and stores with a bare symbol: `lw rd, symbol` / `sw rs, symbol, rt`.
for (const ld of ['lb', 'lh', 'lw', 'lbu', 'lhu']) {
  PSEUDO[ld] = (ops) => {
    if (ops.length === 2 && !/\(/.test(ops[1]) && parseIntLiteral(ops[1]) === null) {
      return [one('auipc', ops[0], `%pcrel_hi(${ops[1]})`), one(ld, ops[0], `%pcrel_lo(${ops[1]})(${ops[0]})`)];
    }
    return [one(ld, ...ops)];
  };
}
for (const st of ['sb', 'sh', 'sw']) {
  PSEUDO[st] = (ops) => {
    if (ops.length === 3) {
      return [one('auipc', ops[2], `%pcrel_hi(${ops[1]})`), one(st, ops[0], `%pcrel_lo(${ops[1]})(${ops[2]})`)];
    }
    return [one(st, ...ops)];
  };
}

// FP loads and stores with a bare symbol: `flw fd, symbol, rt` / `fsw fs, symbol, rt`
// (rt is an integer scratch register for the address, as in GNU as).
PSEUDO.flw = (ops) => {
  if (ops.length === 3 && !/\(/.test(ops[1]) && parseIntLiteral(ops[1]) === null) {
    return [one('auipc', ops[2], `%pcrel_hi(${ops[1]})`), one('flw', ops[0], `%pcrel_lo(${ops[1]})(${ops[2]})`)];
  }
  return [one('flw', ...ops)];
};
PSEUDO.fsw = (ops) => {
  if (ops.length === 3) return [one('auipc', ops[2], `%pcrel_hi(${ops[1]})`), one('fsw', ops[0], `%pcrel_lo(${ops[1]})(${ops[2]})`)];
  return [one('fsw', ...ops)];
};

// Single-precision helpers built from sign injection and compares.
Object.assign(PSEUDO, {
  'fmv.s': arity(2, ([rd, rs]) => [one('fsgnj.s', rd, rs, rs)]),
  'fneg.s': arity(2, ([rd, rs]) => [one('fsgnjn.s', rd, rs, rs)]),
  'fabs.s': arity(2, ([rd, rs]) => [one('fsgnjx.s', rd, rs, rs)]),
  'fgt.s': arity(3, ([rd, a, b]) => [one('flt.s', rd, b, a)]),
  'fge.s': arity(3, ([rd, a, b]) => [one('fle.s', rd, b, a)]),
  'fmv.x.s': arity(2, ([rd, rs]) => [one('fmv.x.w', rd, rs)]),
  'fmv.s.x': arity(2, ([rd, rs]) => [one('fmv.w.x', rd, rs)]),
} satisfies Record<string, Expander>);

/** Read / swap / swap-immediate accessors for one CSR, e.g. frrm / fsrm / fsrmi. */
function csrAccessors(csr: string, read: string, write: string, writeImm?: string): void {
  PSEUDO[read] = arity(1, ([rd]) => [one('csrrs', rd, csr, 'x0')]);
  PSEUDO[write] = (ops) => {
    if (ops.length === 1) return [one('csrrw', 'x0', csr, ops[0])];
    if (ops.length === 2) return [one('csrrw', ops[0], csr, ops[1])];
    return `expected 1 or 2 operands, got ${ops.length}`;
  };
  if (!writeImm) return;
  PSEUDO[writeImm] = (ops) => {
    if (ops.length === 1) return [one('csrrwi', 'x0', csr, ops[0])];
    if (ops.length === 2) return [one('csrrwi', ops[0], csr, ops[1])];
    return `expected 1 or 2 operands, got ${ops.length}`;
  };
}
csrAccessors('fcsr', 'frcsr', 'fscsr');
csrAccessors('frm', 'frrm', 'fsrm', 'fsrmi');
csrAccessors('fflags', 'frflags', 'fsflags', 'fsflagsi');

// Generic CSR shorthands and the counters.
Object.assign(PSEUDO, {
  csrr: arity(2, ([rd, csr]) => [one('csrrs', rd, csr, 'x0')]),
  csrw: arity(2, ([csr, rs]) => [one('csrrw', 'x0', csr, rs)]),
  csrs: arity(2, ([csr, rs]) => [one('csrrs', 'x0', csr, rs)]),
  csrc: arity(2, ([csr, rs]) => [one('csrrc', 'x0', csr, rs)]),
  csrwi: arity(2, ([csr, imm]) => [one('csrrwi', 'x0', csr, imm)]),
  csrsi: arity(2, ([csr, imm]) => [one('csrrsi', 'x0', csr, imm)]),
  csrci: arity(2, ([csr, imm]) => [one('csrrci', 'x0', csr, imm)]),
} satisfies Record<string, Expander>);
for (const counter of ['cycle', 'time', 'instret', 'cycleh', 'timeh', 'instreth']) {
  PSEUDO[`rd${counter}`] = arity(1, ([rd]) => [one('csrrs', rd, counter, 'x0')]);
}

/** Expand a pseudo-instruction, or return null if `op` is not a pseudo. */
export function expandPseudo(op: string, operands: readonly string[]): Expanded[] | string | null {
  const fn = PSEUDO[op];
  return fn ? fn(operands) : null;
}

export const PSEUDO_NAMES: readonly string[] = Object.keys(PSEUDO);
