import { describe, expect, it } from 'vitest';
import {
  CANONICAL_NAN, FLAG, fadd, fclass, fcompare, fcvtFromInt, fcvtToInt, fdiv, ffma, fminmax, fmul, fsqrt, fsub,
} from '../src/core/fp/softfloat';
import { bitsToFloat, decompose, floatToBits, formatFloat } from '../src/core/fp/format';

const f = (v: number) => floatToBits(v);
const v = (bits: number) => bitsToFloat(bits);

/** Deterministic PRNG so failures are reproducible. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s; };
}

/** Random finite floats spanning normals, subnormals, and wide exponents. */
function randomFloats(n: number, seed: number): number[] {
  const next = rng(seed);
  const out: number[] = [];
  while (out.length < n) {
    const bits = next() | 0;
    const exp = (bits >>> 23) & 0xff;
    if (exp !== 0xff) out.push(bits);
  }
  return out;
}

/** JS doubles round correctly to binary32 for + - * / sqrt (53 >= 2*24+2). */
function hostBits(r: number): number {
  return floatToBits(Math.fround(r));
}

describe('soft-float round-to-nearest matches correctly rounded host arithmetic', () => {
  const xs = randomFloats(400, 1), ys = randomFloats(400, 2);
  it('add, sub, mul, div', () => {
    for (let i = 0; i < xs.length; i++) {
      const a = xs[i], b = ys[i];
      expect(fadd(a, b, 'RNE').bits).toBe(hostBits(v(a) + v(b)));
      expect(fsub(a, b, 'RNE').bits).toBe(hostBits(v(a) - v(b)));
      expect(fmul(a, b, 'RNE').bits).toBe(hostBits(v(a) * v(b)));
      expect(fdiv(a, b, 'RNE').bits).toBe(hostBits(v(a) / v(b)));
    }
  });
  it('sqrt of positive values', () => {
    for (const a of xs.map((x) => x & 0x7fffffff)) expect(fsqrt(a, 'RNE').bits).toBe(hostBits(Math.sqrt(v(a))));
  });
  it('int -> float conversion', () => {
    const next = rng(3);
    for (let i = 0; i < 300; i++) {
      const n = next() | 0;
      expect(fcvtFromInt(n, false, 'RNE').bits).toBe(hostBits(n));
      expect(fcvtFromInt(n, true, 'RNE').bits).toBe(hostBits(n >>> 0));
    }
  });
});

describe('rounding modes', () => {
  const one = f(1), three = f(3);
  it('1/3 (0x3eaaaaab under RNE) truncates for RTZ/RDN and rounds up for RUP', () => {
    const rne = fdiv(one, three, 'RNE').bits;
    expect(rne).toBe(0x3eaaaaab);
    expect(fdiv(one, three, 'RTZ').bits).toBe(rne - 1);
    expect(fdiv(one, three, 'RDN').bits).toBe(rne - 1);
    expect(fdiv(one, three, 'RUP').bits).toBe(rne);
    expect(fdiv(one, three, 'RNE').flags).toBe(FLAG.NX);
  });
  it('negative results round towards -inf with RDN', () => {
    const r = fdiv(f(-1), three, 'RDN').bits;
    expect(v(r)).toBeLessThan(-1 / 3);
    expect(v(fdiv(f(-1), three, 'RTZ').bits)).toBeGreaterThan(-1 / 3);
  });
  it('ties: RNE goes to even, RMM away from zero', () => {
    // 2^24 + 1 is exactly halfway between two floats.
    expect(fcvtFromInt(16777217, false, 'RNE').bits).toBe(f(16777216));
    expect(fcvtFromInt(16777217, false, 'RMM').bits).toBe(f(16777218));
    expect(fcvtFromInt(16777219, false, 'RNE').bits).toBe(f(16777220));
  });
  it('x - x is +0, except -0 under RDN', () => {
    expect(fsub(f(5), f(5), 'RNE').bits).toBe(0);
    expect(fsub(f(5), f(5), 'RDN').bits).toBe(0x80000000 | 0);
  });
});

describe('exceptions and special values', () => {
  const max = 0x7f7fffff;
  it('overflow goes to inf or max-finite by mode', () => {
    expect(fmul(max, f(2), 'RNE')).toEqual({ bits: 0x7f800000, flags: FLAG.OF | FLAG.NX });
    expect(fmul(max, f(2), 'RTZ')).toEqual({ bits: max, flags: FLAG.OF | FLAG.NX });
    expect(fmul(max | 0x80000000, f(2), 'RUP').bits).toBe(max | 0x80000000);
  });
  it('divide by zero raises DZ, 0/0 raises NV', () => {
    expect(fdiv(f(1), 0, 'RNE')).toEqual({ bits: 0x7f800000, flags: FLAG.DZ });
    expect(fdiv(0, 0, 'RNE')).toEqual({ bits: CANONICAL_NAN, flags: FLAG.NV });
  });
  it('inf - inf and sqrt(-1) are invalid', () => {
    expect(fsub(0x7f800000, 0x7f800000, 'RNE').flags).toBe(FLAG.NV);
    expect(fsqrt(f(-1), 'RNE')).toEqual({ bits: CANONICAL_NAN, flags: FLAG.NV });
    expect(fsqrt(0x80000000 | 0, 'RNE').bits).toBe(0x80000000 | 0);
  });
  it('tiny inexact results raise underflow', () => {
    const r = fmul(f(1e-30), f(1e-15), 'RNE');
    expect(r.flags & FLAG.UF).toBe(FLAG.UF);
    expect(decompose(r.bits).category).toBe('subnormal');
    // An exact subnormal result is not an underflow.
    expect(fmul(0x00800000, f(0.5), 'RNE')).toEqual({ bits: 0x00400000, flags: 0 });
  });
  it('quiet NaN inputs propagate without NV; signalling ones raise it', () => {
    expect(fadd(CANONICAL_NAN, f(1), 'RNE')).toEqual({ bits: CANONICAL_NAN, flags: 0 });
    expect(fadd(0x7f800001, f(1), 'RNE')).toEqual({ bits: CANONICAL_NAN, flags: FLAG.NV });
  });
});

describe('fused multiply-add', () => {
  it('rounds once', () => {
    // a*b = 1 - 2^-46 exactly; a separate multiply would round it to 1.
    const a = f(1 + 2 ** -23), b = f(1 - 2 ** -23);
    expect(ffma(a, b, f(-1), false, false, 'RNE').bits).toBe(f(-(2 ** -46)));
    expect(fadd(fmul(a, b, 'RNE').bits, f(-1), 'RNE').bits).toBe(0);
  });
  it('implements the four sign variants', () => {
    const [a, b, c] = [f(2), f(3), f(1)];
    expect(v(ffma(a, b, c, false, false, 'RNE').bits)).toBe(7);
    expect(v(ffma(a, b, c, false, true, 'RNE').bits)).toBe(5);
    expect(v(ffma(a, b, c, true, false, 'RNE').bits)).toBe(-5);
    expect(v(ffma(a, b, c, true, true, 'RNE').bits)).toBe(-7);
  });
  it('inf * 0 is invalid even with a quiet NaN addend', () => {
    expect(ffma(0x7f800000, 0, CANONICAL_NAN, false, false, 'RNE').flags).toBe(FLAG.NV);
  });
});

describe('compare, min/max, classify, convert', () => {
  it('feq is quiet, flt/fle signal on NaN', () => {
    expect(fcompare(CANONICAL_NAN, f(1), 'EQ')).toEqual({ bits: 0, flags: 0 });
    expect(fcompare(CANONICAL_NAN, f(1), 'LT')).toEqual({ bits: 0, flags: FLAG.NV });
    expect(fcompare(0, 0x80000000 | 0, 'EQ').bits).toBe(1);
    expect(fcompare(f(1), f(2), 'LE').bits).toBe(1);
  });
  it('min/max return the number when one side is NaN and order -0 < +0', () => {
    expect(fminmax(CANONICAL_NAN, f(3), false).bits).toBe(f(3));
    expect(fminmax(0, 0x80000000 | 0, false).bits).toBe(0x80000000 | 0);
    expect(fminmax(0, 0x80000000 | 0, true).bits).toBe(0);
    expect(fminmax(f(-2), f(5), true).bits).toBe(f(5));
  });
  it('classifies each category', () => {
    expect(fclass(0xff800000 | 0)).toBe(1 << 0);
    expect(fclass(f(-1))).toBe(1 << 1);
    expect(fclass(0x80000001 | 0)).toBe(1 << 2);
    expect(fclass(0)).toBe(1 << 4);
    expect(fclass(0x7f800001)).toBe(1 << 8);
    expect(fclass(CANONICAL_NAN)).toBe(1 << 9);
  });
  it('float -> int honours rm, saturates, and flags', () => {
    expect(fcvtToInt(f(2.5), false, 'RNE')).toEqual({ bits: 2, flags: FLAG.NX });
    expect(fcvtToInt(f(-2.5), false, 'RTZ')).toEqual({ bits: -2, flags: FLAG.NX });
    expect(fcvtToInt(f(-2.5), false, 'RDN').bits).toBe(-3);
    expect(fcvtToInt(f(3e9), false, 'RNE')).toEqual({ bits: 0x7fffffff, flags: FLAG.NV });
    expect(fcvtToInt(f(3e9), true, 'RNE')).toEqual({ bits: 3e9 | 0, flags: 0 });
    expect(fcvtToInt(f(-0.25), true, 'RTZ')).toEqual({ bits: 0, flags: FLAG.NX });
    expect(fcvtToInt(f(-1), true, 'RTZ')).toEqual({ bits: 0, flags: FLAG.NV });
    expect(fcvtToInt(CANONICAL_NAN, false, 'RNE')).toEqual({ bits: 0x7fffffff, flags: FLAG.NV });
  });
});

describe('display helpers', () => {
  it('prints the shortest round-trip decimal', () => {
    expect(formatFloat(f(0.1))).toBe('0.1');
    expect(formatFloat(f(3))).toBe('3.0');
    expect(formatFloat(f(-2.5))).toBe('-2.5');
    expect(formatFloat(0x80000000 | 0)).toBe('-0.0');
    expect(formatFloat(0x7f800000)).toBe('+inf');
    expect(formatFloat(CANONICAL_NAN)).toBe('NaN');
    expect(formatFloat(f(1e-30))).toBe('1e-30');
  });
  it('decomposes into sign, exponent, fraction', () => {
    expect(decompose(f(-6))).toEqual({ sign: 1, exponent: 129, fraction: 0x400000, category: 'normal' });
  });
});
