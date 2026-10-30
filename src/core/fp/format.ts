/**
 * Helpers for showing binary32 values to students: conversions between raw
 * bits and numbers, shortest round-trip text, field decomposition, and the
 * names of the fcsr flags and fclass categories.
 */
import { FLAG, ROUNDING_MODES } from './softfloat';

const scratch = new DataView(new ArrayBuffer(4));
const MAX_FLOAT_DIGITS = 9; // enough to round-trip any binary32

/** Interpret raw bits as a float (display only: sNaN payloads may be quieted). */
export function bitsToFloat(bits: number): number {
  scratch.setInt32(0, bits | 0);
  return scratch.getFloat32(0);
}

/** Round a number to binary32 (round-to-nearest-even) and return its bits. */
export function floatToBits(value: number): number {
  if (Number.isNaN(value)) return 0x7fc00000;
  scratch.setFloat32(0, value);
  return scratch.getInt32(0);
}

/** Shortest decimal text that reads back as exactly this float, e.g. "0.1". */
export function formatFloat(bits: number): string {
  const u = bits >>> 0;
  if ((u & 0x7f800000) === 0x7f800000 && (u & 0x7fffff) !== 0) return u & 0x400000 ? 'NaN' : 'sNaN';
  const v = bitsToFloat(bits);
  if (v === Infinity) return '+inf';
  if (v === -Infinity) return '-inf';
  if (v === 0) return Object.is(v, -0) ? '-0.0' : '0.0';
  for (let p = 1; p <= MAX_FLOAT_DIGITS; p++) {
    const text = v.toPrecision(p);
    if (Math.fround(Number(text)) === v) return tidy(text);
  }
  return String(v);
}

/** "3.00" -> "3.0", "1.50e+2" -> "150.0" style cleanup of toPrecision output. */
function tidy(text: string): string {
  const n = Number(text);
  const abs = Math.abs(n);
  if (abs >= 1e-4 && abs < 1e9) {
    const plain = String(n);
    return /[.e]/.test(plain) ? plain : `${plain}.0`;
  }
  return n.toExponential().replace('e+', 'e');
}

export interface FloatFields {
  readonly sign: number;
  /** Biased exponent field (8 bits). */
  readonly exponent: number;
  /** Fraction field (23 bits). */
  readonly fraction: number;
  readonly category: FloatCategory;
}

export type FloatCategory = 'zero' | 'subnormal' | 'normal' | 'infinity' | 'qnan' | 'snan';

export function decompose(bits: number): FloatFields {
  const u = bits >>> 0;
  const sign = u >>> 31;
  const exponent = (u >>> 23) & 0xff;
  const fraction = u & 0x7fffff;
  let category: FloatCategory;
  if (exponent === 0xff) category = fraction === 0 ? 'infinity' : fraction & 0x400000 ? 'qnan' : 'snan';
  else if (exponent === 0) category = fraction === 0 ? 'zero' : 'subnormal';
  else category = 'normal';
  return { sign, exponent, fraction, category };
}

export const CATEGORY_LABELS: Readonly<Record<FloatCategory, string>> = {
  zero: 'zero', subnormal: 'subnormal', normal: 'normal', infinity: 'infinity', qnan: 'quiet NaN', snan: 'signalling NaN',
};

/** fclass bit index -> description. */
export const FCLASS_NAMES: readonly string[] = [
  'negative infinity', 'negative normal', 'negative subnormal', 'negative zero',
  'positive zero', 'positive subnormal', 'positive normal', 'positive infinity',
  'signalling NaN', 'quiet NaN',
];

export interface FlagInfo { readonly bit: number; readonly short: string; readonly name: string }

/** fflags, most significant first as printed in the spec. */
export const FLAG_INFO: readonly FlagInfo[] = [
  { bit: FLAG.NV, short: 'NV', name: 'invalid operation' },
  { bit: FLAG.DZ, short: 'DZ', name: 'divide by zero' },
  { bit: FLAG.OF, short: 'OF', name: 'overflow' },
  { bit: FLAG.UF, short: 'UF', name: 'underflow' },
  { bit: FLAG.NX, short: 'NX', name: 'inexact' },
];

export function flagNames(flags: number): string[] {
  return FLAG_INFO.filter((f) => flags & f.bit).map((f) => f.short);
}

export const ROUNDING_MODE_NAMES: readonly string[] = [
  'round to nearest, ties to even', 'round towards zero', 'round down (towards −∞)',
  'round up (towards +∞)', 'round to nearest, ties to max magnitude',
];

/** Assembler spelling of the rm field (rne, rtz, ..., dyn). */
export const RM_MNEMONICS: readonly string[] = ['rne', 'rtz', 'rdn', 'rup', 'rmm', '', '', 'dyn'];

export function roundingModeLabel(frm: number): string {
  const mode = ROUNDING_MODES[frm];
  return mode ? `${RM_MNEMONICS[frm]} — ${ROUNDING_MODE_NAMES[frm]}` : `invalid (${frm})`;
}
