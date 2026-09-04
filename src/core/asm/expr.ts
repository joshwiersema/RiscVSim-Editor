/**
 * Tiny expression evaluator for immediates: integers (dec/hex/bin/octal/char),
 * symbols, unary -/~, binary + - * / % & | ^ << >>, parentheses, and the
 * relocation helpers %hi(sym) / %lo(sym).
 */
export type SymbolLookup = (name: string) => number | undefined;

export class ExprError extends Error {}

type Tok = { t: 'num'; v: number } | { t: 'id'; v: string } | { t: 'op'; v: string } | { t: 'fn'; v: string };

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '%') {
      const m = /^%(hi|lo|pcrel_hi|pcrel_lo)/.exec(src.slice(i));
      if (!m) throw new ExprError(`bad relocation at '${src.slice(i)}'`);
      toks.push({ t: 'fn', v: m[1] }); i += m[0].length; continue;
    }
    if (c === "'") {
      const m = /^'(\\.|[^'])'/.exec(src.slice(i));
      if (!m) throw new ExprError('bad character literal');
      const body = m[1];
      const v = body.length === 2 ? ({ n: 10, t: 9, r: 13, '0': 0, '\\': 92, "'": 39 } as Record<string, number>)[body[1]] ?? body.charCodeAt(1) : body.charCodeAt(0);
      toks.push({ t: 'num', v }); i += m[0].length; continue;
    }
    const num = /^(0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO]?[0-7]+|\d+)/.exec(src.slice(i));
    if (num) {
      const s = num[1];
      let v: number;
      if (/^0[xX]/.test(s)) v = parseInt(s.slice(2), 16);
      else if (/^0[bB]/.test(s)) v = parseInt(s.slice(2), 2);
      else if (/^0[oO]/.test(s)) v = parseInt(s.slice(2), 8);
      else if (/^0\d/.test(s)) v = parseInt(s, 8);
      else v = parseInt(s, 10);
      toks.push({ t: 'num', v: v | 0 }); i += s.length; continue;
    }
    const id = /^[A-Za-z_.$][\w.$]*/.exec(src.slice(i));
    if (id) { toks.push({ t: 'id', v: id[0] }); i += id[0].length; continue; }
    const op = /^(<<|>>|[-+*/%&|^~()])/.exec(src.slice(i));
    if (op) { toks.push({ t: 'op', v: op[1] }); i += op[1].length; continue; }
    throw new ExprError(`unexpected character '${c}'`);
  }
  return toks;
}

const PREC: Record<string, number> = { '|': 1, '^': 2, '&': 3, '<<': 4, '>>': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 };

export function evalExpr(src: string, lookup: SymbolLookup, pc?: number): number {
  const toks = tokenize(src);
  let pos = 0;
  const peek = (): Tok | undefined => toks[pos];
  const next = (): Tok => {
    const t = toks[pos++];
    if (!t) throw new ExprError('unexpected end of expression');
    return t;
  };
  const primary = (): number => {
    const t = next();
    if (t.t === 'num') return t.v;
    if (t.t === 'id') {
      const v = lookup(t.v);
      if (v === undefined) throw new ExprError(`undefined symbol '${t.v}'`);
      return v;
    }
    if (t.t === 'fn') {
      const open = next();
      if (open.t !== 'op' || open.v !== '(') throw new ExprError(`expected '(' after %${t.v}`);
      let inner = expr(0);
      const close = next();
      if (close.t !== 'op' || close.v !== ')') throw new ExprError(`expected ')'`);
      if (t.v.startsWith('pcrel')) {
        if (pc === undefined) throw new ExprError('pc-relative relocation needs a PC');
        inner = inner - pc;
      }
      if (t.v.endsWith('hi')) return ((inner + 0x800) >> 12) & 0xfffff;
      return (inner << 20) >> 20;
    }
    if (t.v === '(') { const v = expr(0); const c = next(); if (c.t !== 'op' || c.v !== ')') throw new ExprError("expected ')'"); return v; }
    if (t.v === '-') return -primary() | 0;
    if (t.v === '~') return ~primary();
    if (t.v === '+') return primary();
    throw new ExprError(`unexpected '${t.v}'`);
  };
  const expr = (minPrec: number): number => {
    let lhs = primary();
    for (;;) {
      const t = peek();
      if (!t || t.t !== 'op' || !(t.v in PREC) || PREC[t.v] < minPrec) return lhs;
      pos++;
      const rhs = expr(PREC[t.v] + 1);
      switch (t.v) {
        case '+': lhs = (lhs + rhs) | 0; break;
        case '-': lhs = (lhs - rhs) | 0; break;
        case '*': lhs = Math.imul(lhs, rhs); break;
        case '/': if (rhs === 0) throw new ExprError('division by zero'); lhs = (lhs / rhs) | 0; break;
        case '%': if (rhs === 0) throw new ExprError('division by zero'); lhs = lhs % rhs; break;
        case '&': lhs &= rhs; break;
        case '|': lhs |= rhs; break;
        case '^': lhs ^= rhs; break;
        case '<<': lhs <<= rhs; break;
        case '>>': lhs >>= rhs; break;
      }
    }
  };
  const v = expr(0);
  if (pos !== toks.length) throw new ExprError(`unexpected trailing '${JSON.stringify(toks[pos])}'`);
  return v;
}
