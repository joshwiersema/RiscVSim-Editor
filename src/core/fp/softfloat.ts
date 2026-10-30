/**
 * Exact IEEE-754 binary32 arithmetic for the RV32F extension.
 *
 * JavaScript only has doubles, which are fine for round-to-nearest but cannot
 * honour the other four RISC-V rounding modes or report the exception flags
 * precisely. Every operation here computes the exact (or exact-plus-sticky)
 * result with BigInt and rounds it once, the way a hardware FPU does.
 *
 * Values travel as raw 32-bit patterns (int32), exactly as they sit in the
 * f registers.
 */

export type RoundingMode = 'RNE' | 'RTZ' | 'RDN' | 'RUP' | 'RMM';

/** Indexed by the 3-bit rm encoding (0..4). */
export const ROUNDING_MODES: readonly RoundingMode[] = ['RNE', 'RTZ', 'RDN', 'RUP', 'RMM'];

/** fflags bits, as laid out in the fcsr. */
export const FLAG = { NX: 1, UF: 2, OF: 4, DZ: 8, NV: 16 } as const;

export interface FpResult {
  /** Result bits (int32). For compares/conversions to integer, the integer value. */
  readonly bits: number;
  /** Exception flags raised (FLAG bits). */
  readonly flags: number;
}

export const CANONICAL_NAN = 0x7fc00000;
const SIG_BITS = 24; // including the hidden bit
const MIN_EXP = -126;
const QUANTUM_MIN = MIN_EXP - (SIG_BITS - 1); // 2^-149, the smallest subnormal
const MAX_BIASED = 255;
const BIAS = 127;
const HIDDEN = 1n << BigInt(SIG_BITS - 1);
const DIV_EXTRA_BITS = 64n;
const SQRT_EXTRA_BITS = 40;

type Kind = 'zero' | 'finite' | 'inf' | 'qnan' | 'snan';

interface Unpacked {
  readonly sign: 0 | 1;
  readonly kind: Kind;
  /** Integer significand; value = sig * 2^exp. Zero for non-finite kinds. */
  readonly sig: bigint;
  readonly exp: number;
}

export function unpack(bits: number): Unpacked {
  const u = bits >>> 0;
  const sign = (u >>> 31) as 0 | 1;
  const e = (u >>> 23) & 0xff;
  const f = u & 0x7fffff;
  if (e === 0xff) {
    if (f === 0) return { sign, kind: 'inf', sig: 0n, exp: 0 };
    return { sign, kind: f & 0x400000 ? 'qnan' : 'snan', sig: 0n, exp: 0 };
  }
  if (e === 0) return f === 0 ? { sign, kind: 'zero', sig: 0n, exp: 0 } : { sign, kind: 'finite', sig: BigInt(f), exp: QUANTUM_MIN };
  return { sign, kind: 'finite', sig: BigInt(f) | HIDDEN, exp: e - BIAS - (SIG_BITS - 1) };
}

const isNan = (u: Unpacked) => u.kind === 'qnan' || u.kind === 'snan';
const signed = (sign: 0 | 1, bits: number) => (sign ? bits | 0x80000000 : bits) | 0;
const zero = (sign: 0 | 1): FpResult => ({ bits: signed(sign, 0), flags: 0 });
const inf = (sign: 0 | 1, flags = 0): FpResult => ({ bits: signed(sign, 0x7f800000), flags });
const nan = (flags: number): FpResult => ({ bits: CANONICAL_NAN, flags });

function bitLength(v: bigint): number {
  return v === 0n ? 0 : v.toString(2).length;
}

/**
 * Drop `shift` low bits of `sig` under rounding mode `rm`. `sticky` says the
 * true value carried more nonzero bits below `sig`.
 */
export function roundShift(sig: bigint, shift: number, sticky: boolean, sign: 0 | 1, rm: RoundingMode): { mant: bigint; inexact: boolean } {
  let mant: bigint;
  let cmp: -1 | 0 | 1; // remainder vs. half an ulp
  let inexact: boolean;
  if (shift <= 0) {
    mant = sig << BigInt(-shift);
    inexact = sticky;
    cmp = -1;
  } else {
    const s = BigInt(shift);
    mant = sig >> s;
    const rem = sig & ((1n << s) - 1n);
    const half = 1n << (s - 1n);
    inexact = rem !== 0n || sticky;
    cmp = rem > half ? 1 : rem < half ? -1 : sticky ? 1 : 0;
  }
  if (!inexact) return { mant, inexact };
  const odd = (mant & 1n) === 1n;
  const up = rm === 'RNE' ? cmp > 0 || (cmp === 0 && odd)
    : rm === 'RMM' ? cmp >= 0
      : rm === 'RDN' ? sign === 1
        : rm === 'RUP' ? sign === 0
          : false;
  return { mant: up ? mant + 1n : mant, inexact };
}

/** Round sign * (sig + sticky) * 2^exp to binary32. `sig` must be > 0. */
export function roundPack(sign: 0 | 1, sig: bigint, exp: number, sticky: boolean, rm: RoundingMode): FpResult {
  const lead = exp + bitLength(sig) - 1; // exponent of the leading 1
  let quantum = Math.max(lead - (SIG_BITS - 1), QUANTUM_MIN);
  const r = roundShift(sig, quantum - exp, sticky, sign, rm);
  let mant = r.mant;
  if (mant >> BigInt(SIG_BITS) !== 0n) { mant >>= 1n; quantum += 1; } // rounding carried into a new bit

  let flags = r.inexact ? FLAG.NX : 0;
  // RISC-V detects tininess after rounding: tiny unless rounding at full
  // precision would have reached the smallest normal.
  if (lead < MIN_EXP && r.inexact) {
    const unbounded = roundShift(sig, lead - (SIG_BITS - 1) - exp, sticky, sign, rm).mant;
    const reachesNormal = lead === MIN_EXP - 1 && unbounded >> BigInt(SIG_BITS) !== 0n;
    if (!reachesNormal) flags |= FLAG.UF;
  }
  if (mant === 0n) return { bits: signed(sign, 0), flags };
  if (mant < HIDDEN) return { bits: signed(sign, Number(mant)), flags }; // subnormal

  const biased = quantum + (SIG_BITS - 1) + BIAS;
  if (biased >= MAX_BIASED) return overflow(sign, rm);
  return { bits: signed(sign, (biased << 23) | Number(mant & (HIDDEN - 1n))), flags };
}

function overflow(sign: 0 | 1, rm: RoundingMode): FpResult {
  const flags = FLAG.OF | FLAG.NX;
  const toInf = rm === 'RNE' || rm === 'RMM' || (rm === 'RUP' && sign === 0) || (rm === 'RDN' && sign === 1);
  return toInf ? inf(sign, flags) : { bits: signed(sign, 0x7f7fffff), flags };
}

/** NaN propagation shared by the arithmetic ops: canonical NaN, NV on sNaN. */
function nanResult(...ops: Unpacked[]): FpResult {
  return nan(ops.some((o) => o.kind === 'snan') ? FLAG.NV : 0);
}

/** Exact sum of two signed terms sig*2^exp, rounded once. */
function sumTerms(sa: 0 | 1, siga: bigint, ea: number, sb: 0 | 1, sigb: bigint, eb: number, rm: RoundingMode): FpResult {
  const e = Math.min(ea, eb);
  const a = siga << BigInt(ea - e);
  const b = sigb << BigInt(eb - e);
  const s = (sa ? -a : a) + (sb ? -b : b);
  if (s === 0n) return zero(sa === sb ? sa : rm === 'RDN' ? 1 : 0);
  return s < 0n ? roundPack(1, -s, e, false, rm) : roundPack(0, s, e, false, rm);
}

export function fadd(x: number, y: number, rm: RoundingMode): FpResult {
  const a = unpack(x), b = unpack(y);
  if (isNan(a) || isNan(b)) return nanResult(a, b);
  if (a.kind === 'inf' || b.kind === 'inf') {
    if (a.kind === 'inf' && b.kind === 'inf' && a.sign !== b.sign) return nan(FLAG.NV);
    return inf(a.kind === 'inf' ? a.sign : b.sign);
  }
  return sumTerms(a.sign, a.sig, a.exp, b.sign, b.sig, b.exp, rm);
}

export function fsub(x: number, y: number, rm: RoundingMode): FpResult {
  return fadd(x, (y ^ 0x80000000) | 0, rm);
}

export function fmul(x: number, y: number, rm: RoundingMode): FpResult {
  const a = unpack(x), b = unpack(y);
  if (isNan(a) || isNan(b)) return nanResult(a, b);
  const sign = (a.sign ^ b.sign) as 0 | 1;
  if (a.kind === 'inf' || b.kind === 'inf') return a.kind === 'zero' || b.kind === 'zero' ? nan(FLAG.NV) : inf(sign);
  if (a.kind === 'zero' || b.kind === 'zero') return zero(sign);
  return roundPack(sign, a.sig * b.sig, a.exp + b.exp, false, rm);
}

export function fdiv(x: number, y: number, rm: RoundingMode): FpResult {
  const a = unpack(x), b = unpack(y);
  if (isNan(a) || isNan(b)) return nanResult(a, b);
  const sign = (a.sign ^ b.sign) as 0 | 1;
  if (a.kind === 'inf') return b.kind === 'inf' ? nan(FLAG.NV) : inf(sign);
  if (b.kind === 'inf') return zero(sign);
  if (b.kind === 'zero') return a.kind === 'zero' ? nan(FLAG.NV) : inf(sign, FLAG.DZ);
  if (a.kind === 'zero') return zero(sign);
  const num = a.sig << DIV_EXTRA_BITS;
  const q = num / b.sig;
  return roundPack(sign, q, a.exp - b.exp - Number(DIV_EXTRA_BITS), num % b.sig !== 0n, rm);
}

function isqrt(n: bigint): bigint {
  if (n < 2n) return n;
  let x = 1n << BigInt(Math.ceil(bitLength(n) / 2));
  for (;;) {
    const y = (x + n / x) >> 1n;
    if (y >= x) return x;
    x = y;
  }
}

export function fsqrt(x: number, rm: RoundingMode): FpResult {
  const a = unpack(x);
  if (isNan(a)) return nanResult(a);
  if (a.kind === 'zero') return zero(a.sign);
  if (a.sign === 1) return nan(FLAG.NV);
  if (a.kind === 'inf') return inf(0);
  let sig = a.sig, e = a.exp;
  if (e & 1) { sig <<= 1n; e -= 1; }
  sig <<= BigInt(2 * SQRT_EXTRA_BITS);
  e -= 2 * SQRT_EXTRA_BITS;
  const root = isqrt(sig);
  return roundPack(0, root, e / 2, root * root !== sig, rm);
}

/** (±a·b) ± c with a single rounding: fmadd/fmsub/fnmsub/fnmadd. */
export function ffma(x: number, y: number, z: number, negProduct: boolean, negAddend: boolean, rm: RoundingMode): FpResult {
  const a = unpack(x), b = unpack(y), c = unpack(z);
  const infTimesZero = (a.kind === 'inf' && b.kind === 'zero') || (a.kind === 'zero' && b.kind === 'inf');
  if (isNan(a) || isNan(b) || isNan(c) || infTimesZero) {
    const nv = infTimesZero || [a, b, c].some((o) => o.kind === 'snan');
    return nan(nv ? FLAG.NV : 0);
  }
  const sp = ((a.sign ^ b.sign) ^ (negProduct ? 1 : 0)) as 0 | 1;
  const sc = (c.sign ^ (negAddend ? 1 : 0)) as 0 | 1;
  if (a.kind === 'inf' || b.kind === 'inf') return c.kind === 'inf' && sc !== sp ? nan(FLAG.NV) : inf(sp);
  if (c.kind === 'inf') return inf(sc);
  return sumTerms(sp, a.sig * b.sig, a.exp + b.exp, sc, c.sig, c.exp, rm);
}

/** Exact numeric value (binary32 values are all exactly representable as doubles). */
function toDouble(bits: number): number {
  const u = unpack(bits);
  switch (u.kind) {
    case 'zero': return u.sign ? -0 : 0;
    case 'inf': return u.sign ? -Infinity : Infinity;
    case 'qnan': case 'snan': return Number.NaN;
    case 'finite': return (u.sign ? -1 : 1) * Number(u.sig) * 2 ** u.exp;
  }
}

/** fmin/fmax (IEEE 754-2019 minimumNumber/maximumNumber, -0 < +0). */
export function fminmax(x: number, y: number, max: boolean): FpResult {
  const a = unpack(x), b = unpack(y);
  const flags = a.kind === 'snan' || b.kind === 'snan' ? FLAG.NV : 0;
  if (isNan(a) && isNan(b)) return nan(flags);
  if (isNan(a)) return { bits: y | 0, flags };
  if (isNan(b)) return { bits: x | 0, flags };
  const da = toDouble(x), db = toDouble(y);
  if (da === db) {
    // Equal values differ only for ±0: min prefers -0, max prefers +0.
    const pickA = max ? a.sign <= b.sign : a.sign >= b.sign;
    return { bits: (pickA ? x : y) | 0, flags };
  }
  return { bits: ((da < db) !== max ? x : y) | 0, flags };
}

export type CompareOp = 'EQ' | 'LT' | 'LE';

/** feq (quiet: NV only for sNaN) and flt/fle (signalling: NV for any NaN). */
export function fcompare(x: number, y: number, op: CompareOp): FpResult {
  const a = unpack(x), b = unpack(y);
  if (isNan(a) || isNan(b)) {
    const nv = op !== 'EQ' || a.kind === 'snan' || b.kind === 'snan';
    return { bits: 0, flags: nv ? FLAG.NV : 0 };
  }
  const da = toDouble(x), db = toDouble(y);
  const r = op === 'EQ' ? da === db : op === 'LT' ? da < db : da <= db;
  return { bits: r ? 1 : 0, flags: 0 };
}

/** fclass: a one-hot mask describing the value's category. */
export function fclass(x: number): number {
  const u = unpack(x);
  const neg = u.sign === 1;
  switch (u.kind) {
    case 'inf': return neg ? 1 << 0 : 1 << 7;
    case 'zero': return neg ? 1 << 3 : 1 << 4;
    case 'snan': return 1 << 8;
    case 'qnan': return 1 << 9;
    case 'finite': {
      const subnormal = u.sig < HIDDEN;
      return neg ? (subnormal ? 1 << 2 : 1 << 1) : subnormal ? 1 << 5 : 1 << 6;
    }
  }
}

const INT_MAX = 0x7fffffff, INT_MIN = -0x80000000, UINT_MAX = 0xffffffff;

/** fcvt.w.s / fcvt.wu.s: float to (un)signed int32 with saturation. */
export function fcvtToInt(x: number, unsignedResult: boolean, rm: RoundingMode): FpResult {
  const a = unpack(x);
  const lo = unsignedResult ? 0 : INT_MIN;
  const hi = unsignedResult ? UINT_MAX : INT_MAX;
  const invalid = (v: number): FpResult => ({ bits: v | 0, flags: FLAG.NV });
  if (isNan(a)) return invalid(hi);
  if (a.kind === 'inf') return invalid(a.sign ? lo : hi);
  if (a.kind === 'zero') return { bits: 0, flags: 0 };
  const r = roundShift(a.sig, -a.exp, false, a.sign, rm);
  const value = a.sign ? -r.mant : r.mant;
  if (value < BigInt(lo) || value > BigInt(hi)) return invalid(a.sign ? lo : hi);
  return { bits: Number(value) | 0, flags: r.inexact ? FLAG.NX : 0 };
}

/** fcvt.s.w / fcvt.s.wu: (un)signed int32 to float. */
export function fcvtFromInt(v: number, unsignedSource: boolean, rm: RoundingMode): FpResult {
  const n = unsignedSource ? v >>> 0 : v | 0;
  if (n === 0) return zero(0);
  return roundPack(n < 0 ? 1 : 0, BigInt(Math.abs(n)), 0, false, rm);
}
