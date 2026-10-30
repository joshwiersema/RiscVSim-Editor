import { INSTR_BY_NAME, type InstrDef } from '../isa/instructions';
import { parseFpRegister, parseRegister } from '../isa/registers';
import { encode, type Operands } from '../isa/encode';
import { csrNumber } from '../isa/csr';
import { regFile, type RegOperand } from '../isa/operands';
import { floatToBits, RM_MNEMONICS } from '../fp/format';
import { compressWord, lowerCompressedMnemonic } from '../isa/compressed';
import type { AsmError, Program, Segment, TextWord } from '../program';
import { lexLine, parseStringLiteral } from './lexer';
import { evalExpr, ExprError } from './expr';
import { expandPseudo } from './pseudo';

export type { AsmError, Program, TextWord } from '../program';

export const TEXT_BASE = 0x00000000;
export const DATA_BASE = 0x10000000;
export const STACK_TOP = 0x7ffffff0;

export interface AssembleOptions {
  /** Emit 16-bit RV32C encodings wherever a 32-bit instruction has one. */
  readonly autoCompress?: boolean;
  /** Accept explicit c.* mnemonics (always on; kept for symmetry). */
  readonly allowCompressed?: boolean;
}

type Section = 'text' | 'data';

interface Item {
  readonly line: number;
  readonly source: string;
  readonly op: string;
  readonly operands: readonly string[];
  /** Explicit c.* mnemonic requested by the user, if any. */
  readonly compressedName: string | null;
  /** Index of the first item of the pseudo-expansion group (for %pcrel_lo). */
  readonly anchorIndex: number;
  /** Address assigned by layout (mutable during relaxation). */
  addr: number;
  size: 2 | 4;
}

interface PendingWord { addr: number; size: number; expr: string; line: number }

const DATA_DIRECTIVES: Record<string, number> = { '.byte': 1, '.half': 2, '.short': 2, '.word': 4, '.long': 4 };
const MAX_RELAX_PASSES = 12;

function alignUp(v: number, a: number): number {
  return (v + a - 1) & ~(a - 1);
}

/* ---------------------------------------------------------- operand parsing */

function parseMemOperand(tok: string): { offset: string; base: string } | null {
  const m = /^(.*)\(\s*([A-Za-z0-9]+)\s*\)$/.exec(tok.trim());
  if (!m) return null;
  return { offset: m[1].trim() || '0', base: m[2] };
}

type Lookup = (s: string) => number | undefined;

/** Parse a register operand from the file (x or f) the instruction expects there. */
function reg(def: InstrDef, op: RegOperand, tok: string): number {
  const t = tok.trim();
  const wantFp = regFile(def, op) === 'F';
  const r = wantFp ? parseFpRegister(t) : parseRegister(t);
  if (r !== null) return r;
  const other = wantFp ? parseRegister(t) : parseFpRegister(t);
  if (other !== null) throw new ExprError(`${def.name} needs ${wantFp ? 'a floating-point' : 'an integer'} register for ${op}, got '${t}'`);
  throw new ExprError(`unknown ${wantFp ? 'floating-point ' : ''}register '${t}'`);
}

function checkRange(value: number, lo: number, hi: number, what: string): void {
  if (value < lo || value > hi) throw new ExprError(`${what} ${value} out of range [${lo}, ${hi}]`);
}

function want(def: InstrDef, ops: readonly string[], n: number): void {
  if (ops.length !== n) throw new ExprError(`${def.name} expects ${n} operand${n === 1 ? '' : 's'}, got ${ops.length}`);
}

/** Split off an optional trailing rounding-mode operand (rne, rtz, rdn, rup, rmm, dyn). */
function withRm(def: InstrDef, ops: readonly string[], regs: number): { regs: readonly string[]; rm?: number } {
  if (!def.rm || ops.length !== regs + 1) { want(def, ops, regs); return { regs: ops }; }
  const tok = ops[regs].trim().toLowerCase();
  const rm = tok ? RM_MNEMONICS.indexOf(tok) : -1;
  if (rm < 0) throw new ExprError(`unknown rounding mode '${ops[regs]}' (use rne, rtz, rdn, rup, rmm, or dyn)`);
  return { regs: ops.slice(0, regs), rm };
}

function csrOperands(def: InstrDef, ops: readonly string[], ev: (s: string) => number): Operands {
  want(def, ops, 3);
  const csr = csrNumber(ops[1].trim()) ?? ev(ops[1]);
  checkRange(csr, 0, 0xfff, 'CSR number');
  if (!def.csrImm) return { rd: reg(def, 'rd', ops[0]), imm: csr, rs1: reg(def, 'rs1', ops[2]) };
  const uimm = ev(ops[2]);
  checkRange(uimm, 0, 31, 'CSR immediate');
  return { rd: reg(def, 'rd', ops[0]), imm: csr, rs1: uimm };
}

function memOperands(def: InstrDef, ops: readonly string[], ev: (s: string) => number, dataOp: RegOperand): Operands {
  if (ops.length === 3 && dataOp === 'rd') {
    const imm = ev(ops[1]); checkRange(imm, -2048, 2047, 'offset');
    return { rd: reg(def, 'rd', ops[0]), rs1: reg(def, 'rs1', ops[2]), imm };
  }
  want(def, ops, 2);
  const mem = parseMemOperand(ops[1]);
  if (!mem) throw new ExprError(`expected offset(base), got '${ops[1]}'`);
  const imm = ev(mem.offset); checkRange(imm, -2048, 2047, 'offset');
  return { [dataOp]: reg(def, dataOp, ops[0]), rs1: reg(def, 'rs1', mem.base), imm };
}

function iOperands(def: InstrDef, ops: readonly string[], ev: (s: string) => number): Operands {
  if (def.system) { want(def, ops, 0); return {}; }
  if (def.csr) return csrOperands(def, ops, ev);
  if (def.memRead || def.jump === 'JALR') return memOperands(def, ops, ev, 'rd');
  want(def, ops, 3);
  const imm = ev(ops[2]);
  if (def.funct7 !== undefined) checkRange(imm, 0, 31, 'shift amount');
  else checkRange(imm, -2048, 2047, 'immediate');
  return { rd: reg(def, 'rd', ops[0]), rs1: reg(def, 'rs1', ops[1]), imm };
}

/** Build encoder operands for a real instruction from its operand strings. */
function operandsFor(def: InstrDef, ops: readonly string[], pc: number, anchorPc: number, lookup: Lookup): Operands {
  const ev = (s: string) => evalExpr(s, lookup, anchorPc);
  switch (def.format) {
    case 'R': {
      const unary = def.rs2Sel !== undefined;
      const { regs, rm } = withRm(def, ops, unary ? 2 : 3);
      const base = { rd: reg(def, 'rd', regs[0]), rs1: reg(def, 'rs1', regs[1]), rm };
      return unary ? base : { ...base, rs2: reg(def, 'rs2', regs[2]) };
    }
    case 'R4': {
      const { regs, rm } = withRm(def, ops, 4);
      return { rd: reg(def, 'rd', regs[0]), rs1: reg(def, 'rs1', regs[1]), rs2: reg(def, 'rs2', regs[2]), rs3: reg(def, 'rs3', regs[3]), rm };
    }
    case 'I': return iOperands(def, ops, ev);
    case 'S': return memOperands(def, ops, ev, 'rs2');
    case 'B': {
      want(def, ops, 3);
      const imm = ev(ops[2]) - pc;
      if (imm & 1) throw new ExprError('branch target is not 2-byte aligned');
      checkRange(imm, -4096, 4095, 'branch offset');
      return { rs1: reg(def, 'rs1', ops[0]), rs2: reg(def, 'rs2', ops[1]), imm };
    }
    case 'U': {
      want(def, ops, 2);
      const imm = ev(ops[1]);
      checkRange(imm, 0, 0xfffff, 'upper immediate');
      return { rd: reg(def, 'rd', ops[0]), imm: imm << 12 };
    }
    case 'J': {
      want(def, ops, 2);
      const imm = ev(ops[1]) - pc;
      if (imm & 1) throw new ExprError('jump target is not 2-byte aligned');
      checkRange(imm, -(1 << 20), (1 << 20) - 1, 'jump offset');
      return { rd: reg(def, 'rd', ops[0]), imm };
    }
  }
}

/** Parse a .float operand: a decimal/hex number, inf, or nan. */
export function parseFloatLiteral(tok: string): number {
  const t = tok.trim().toLowerCase();
  const special: Record<string, number> = { inf: Infinity, '+inf': Infinity, '-inf': -Infinity, infinity: Infinity, '-infinity': -Infinity, nan: Number.NaN };
  if (t in special) return floatToBits(special[t]);
  const n = t === '' ? Number.NaN : Number(t);
  if (Number.isNaN(n)) throw new ExprError(`bad floating-point literal '${tok.trim()}'`);
  return floatToBits(n);
}

/* ----------------------------------------------------------------- assemble */

export function assemble(source: string, options: AssembleOptions = {}): Program {
  const errors: AsmError[] = [];
  const labels = new Map<string, number>();
  const labelItems: { name: string; line: number; section: Section; index: number }[] = [];
  const items: Item[] = [];
  const dataOut: Segment[] = [];
  const pendingWords: PendingWord[] = [];
  const equs = new Map<string, string>();
  const lines = source.split(/\r?\n/);
  let section: Section = 'text';
  const dataPc = { value: DATA_BASE };
  /** Per-item alignment requests inside .text (from .align). */
  const textAligns = new Map<number, number>();
  let pendingTextAlign = 0;

  const fail = (line: number, message: string) => errors.push({ line, message });

  // Pass 1: parse everything, lay out .data immediately (its sizes are fixed),
  // and collect .text items whose addresses depend on compression choices.
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const raw = lines[i];
    let parts;
    try { parts = lexLine(raw); } catch (e) { fail(lineNo, (e as Error).message); continue; }
    if (parts.label) {
      if (section === 'data') {
        if (labels.has(parts.label) || labelItems.some((l) => l.name === parts.label)) fail(lineNo, `duplicate label '${parts.label}'`);
        labels.set(parts.label, dataPc.value);
      } else {
        if (labels.has(parts.label) || labelItems.some((l) => l.name === parts.label)) fail(lineNo, `duplicate label '${parts.label}'`);
        labelItems.push({ name: parts.label, line: lineNo, section: 'text', index: items.length });
      }
    }
    if (!parts.op) continue;
    const { op, operands } = parts;

    if (op.startsWith('.')) {
      try {
        const r = handleDirective({ op, operands, line: lineNo, section, dataPc, labels, dataOut, equs, pendingWords, fail });
        if (r.section) section = r.section;
        if (r.textAlign) pendingTextAlign = Math.max(pendingTextAlign, r.textAlign);
      } catch (e) {
        fail(lineNo, (e as Error).message);
      }
      continue;
    }

    if (section !== 'text') { fail(lineNo, 'instructions are only allowed in .text'); continue; }

    let real: { op: string; operands: readonly string[] }[];
    let compressedName: string | null = null;
    if (op.startsWith('c.')) {
      const lowered = lowerCompressedMnemonic(op, operands);
      if (typeof lowered === 'string') { fail(lineNo, lowered); continue; }
      real = [lowered];
      compressedName = op;
    } else {
      const expanded = expandPseudo(op, operands);
      if (typeof expanded === 'string') { fail(lineNo, `${op}: ${expanded}`); continue; }
      real = expanded ?? [{ op, operands }];
    }
    const anchorIndex = items.length;
    if (pendingTextAlign) { textAligns.set(items.length, pendingTextAlign); pendingTextAlign = 0; }
    for (const r of real) {
      if (!INSTR_BY_NAME.has(r.op)) { fail(lineNo, `unknown instruction '${r.op}'`); break; }
      items.push({ line: lineNo, source: raw.trim(), op: r.op, operands: r.operands, compressedName, anchorIndex, addr: 0, size: compressedName ? 2 : 4 });
    }
  }

  // Layout + encode with relaxation: instruction sizes depend on branch
  // offsets, which depend on sizes. Iterate until stable.
  const lookup = (name: string): number | undefined => {
    if (labels.has(name)) return labels.get(name);
    if (equs.has(name)) return evalExpr(equs.get(name)!, lookup);
    return undefined;
  };
  const wantCompress = options.autoCompress === true;
  let encoded: { word: number; raw: number; size: 2 | 4 }[] = [];
  const encodeErrors: AsmError[] = [];

  for (let pass = 0; pass < MAX_RELAX_PASSES; pass++) {
    // Assign addresses from current sizes.
    let pc = TEXT_BASE;
    for (let i = 0; i < items.length; i++) {
      const align = textAligns.get(i);
      if (align) pc = alignUp(pc, align);
      items[i].addr = pc;
      pc += items[i].size;
    }
    for (const l of labelItems) {
      const at = l.index < items.length ? items[l.index].addr : pc;
      labels.set(l.name, at);
    }

    encodeErrors.length = 0;
    encoded = [];
    let changed = false;
    for (const it of items) {
      const def = INSTR_BY_NAME.get(it.op)!;
      try {
        const ops = operandsFor(def, it.operands, it.addr, items[it.anchorIndex].addr, lookup);
        const word = encode(def, ops);
        const c = it.compressedName || wantCompress ? compressWord(word) : null;
        if (it.compressedName && !c) throw new ExprError(`${it.compressedName}: operands cannot be encoded in compressed form`);
        if (it.compressedName && c && c.name !== it.compressedName && !(c.name === 'c.nop' && it.compressedName === 'c.addi')) {
          throw new ExprError(`${it.compressedName}: these operands encode as ${c.name}`);
        }
        const size: 2 | 4 = c ? 2 : 4;
        if (size !== it.size) { it.size = size; changed = true; }
        encoded.push(c ? { word, raw: c.word, size: 2 } : { word, raw: word, size: 4 });
      } catch (e) {
        encodeErrors.push({ line: it.line, message: `${it.op}: ${(e as Error).message}` });
        encoded.push({ word: 0, raw: 0, size: it.size });
      }
    }
    if (!changed) break;
  }
  errors.push(...encodeErrors);

  // Build the listing and the text segment image.
  const text: TextWord[] = [];
  const lineToAddr = new Map<number, number>();
  const addrToLine = new Map<number, number>();
  const textEnd = items.length ? items[items.length - 1].addr + items[items.length - 1].size : TEXT_BASE;
  const textBytes = new Uint8Array(textEnd - TEXT_BASE);
  items.forEach((it, i) => {
    const e = encoded[i];
    text.push({ addr: it.addr, word: e.word, size: e.size, raw: e.raw, line: it.line, source: it.source, text: `${it.compressedName ?? it.op} ${it.operands.join(', ')}`.trim() });
    if (!lineToAddr.has(it.line)) lineToAddr.set(it.line, it.addr);
    addrToLine.set(it.addr, it.line);
    for (let b = 0; b < e.size; b++) textBytes[it.addr - TEXT_BASE + b] = (e.raw >>> (8 * b)) & 0xff;
  });

  // Resolve deferred data expressions (.word label) now that labels are final.
  const segments: Segment[] = [];
  if (textBytes.length) segments.push({ addr: TEXT_BASE, bytes: textBytes });
  segments.push(...dataOut);
  for (const pending of pendingWords) {
    try {
      const v = evalExpr(pending.expr, lookup);
      const bytes = new Uint8Array(pending.size);
      for (let b = 0; b < pending.size; b++) bytes[b] = (v >>> (8 * b)) & 0xff;
      segments.push({ addr: pending.addr, bytes });
    } catch (e) {
      fail(pending.line, (e as Error).message);
    }
  }

  const sorted = [...errors].sort((a, b) => a.line - b.line);
  return { kind: 'asm', entry: TEXT_BASE, text, segments, labels, errors: sorted, lineToAddr, addrToLine, textStart: TEXT_BASE, textEnd };
}

/* --------------------------------------------------------------- directives */

interface DirectiveCtx {
  readonly op: string;
  readonly operands: readonly string[];
  readonly line: number;
  readonly section: Section;
  readonly dataPc: { value: number };
  readonly labels: Map<string, number>;
  readonly dataOut: Segment[];
  readonly equs: Map<string, string>;
  readonly pendingWords: PendingWord[];
  readonly fail: (line: number, msg: string) => void;
}

function handleDirective(ctx: DirectiveCtx): { section?: Section; textAlign?: number } {
  const { op, operands, line, section, dataPc, labels, dataOut, equs, pendingWords, fail } = ctx;
  const emit = (bytes: Uint8Array) => {
    if (section === 'text') throw new ExprError(`${op} is only allowed in .data`);
    dataOut.push({ addr: dataPc.value, bytes });
    dataPc.value += bytes.length;
  };
  const constLookup = (name: string): number | undefined => labels.get(name) ?? (equs.has(name) ? evalExpr(equs.get(name)!, constLookup) : undefined);

  switch (op) {
    case '.text': return { section: 'text' };
    case '.data': case '.bss': case '.rodata': return { section: 'data' };
    case '.section': {
      const name = (operands[0] ?? '').replace(/^"|"$/g, '');
      return { section: /^\.?(text|init)/.test(name) ? 'text' : 'data' };
    }
    case '.globl': case '.global': case '.option': case '.type': case '.size': case '.file': case '.ident': case '.attribute': case '.local': case '.weak': case '.cfi_startproc': case '.cfi_endproc':
      return {};
    case '.equ': case '.set': {
      if (operands.length !== 2) throw new ExprError(`${op} expects name, value`);
      equs.set(operands[0], operands[1]);
      return {};
    }
    case '.align': case '.p2align': {
      const n = 1 << evalExpr(operands[0] ?? '2', constLookup);
      if (section === 'text') return { textAlign: n };
      dataPc.value = alignUp(dataPc.value, n);
      return {};
    }
    case '.balign': {
      const n = evalExpr(operands[0] ?? '4', constLookup);
      if (section === 'text') return { textAlign: n };
      dataPc.value = alignUp(dataPc.value, n);
      return {};
    }
    case '.space': case '.zero': case '.skip': {
      const n = evalExpr(operands[0] ?? '0', constLookup);
      emit(new Uint8Array(n));
      return {};
    }
    case '.float': case '.single': {
      for (const o of operands) {
        const bits = parseFloatLiteral(o);
        emit(Uint8Array.from([0, 8, 16, 24].map((sh) => (bits >>> sh) & 0xff)));
      }
      return {};
    }
    case '.ascii': case '.asciz': case '.string': {
      for (const o of operands) {
        const bytes = parseStringLiteral(o);
        if (!bytes) throw new ExprError(`bad string literal ${o}`);
        emit(op === '.ascii' ? bytes : Uint8Array.from([...bytes, 0]));
      }
      return {};
    }
    default: {
      const size = DATA_DIRECTIVES[op];
      if (!size) { fail(line, `unknown directive '${op}'`); return {}; }
      if (section === 'text') throw new ExprError(`${op} is only allowed in .data`);
      for (const o of operands) {
        pendingWords.push({ addr: dataPc.value, size, expr: o, line });
        dataPc.value += size;
      }
      return {};
    }
  }
}
