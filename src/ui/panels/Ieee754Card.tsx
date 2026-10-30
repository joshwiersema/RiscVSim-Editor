import { fclass } from '@/core/fp/softfloat';
import { CATEGORY_LABELS, decompose, FCLASS_NAMES, formatFloat, type FloatFields } from '@/core/fp/format';
import { hex32 } from '@/core/util/format';

const EXP_BIAS = 127;
const FRACTION_BITS = 23;
const SIGNIFICAND_DIGITS = 9;

interface Ieee754CardProps {
  readonly bits: number;
  readonly label: string;
  readonly pinned: boolean;
  readonly onUnpin: () => void;
}

/** Bit-level anatomy of one binary32 value: sign, exponent, fraction, and the formula they encode. */
export function Ieee754Card({ bits, label, pinned, onUnpin }: Ieee754CardProps) {
  const f = decompose(bits);
  const cls = fclass(bits);
  const clsBit = 31 - Math.clz32(cls);
  const binary = (bits >>> 0).toString(2).padStart(32, '0');
  return (
    <div className="ieee-card">
      <div className="section-title">
        <span>IEEE-754 · {label}</span>
        {pinned
          ? <button className="btn btn-ghost btn-xs" onClick={onUnpin} title="Follow the most recently written f register again">unpin</button>
          : <span className="ieee-follow">following writes</span>}
      </div>
      <div className="ieee-value">
        <span className="mono">{formatFloat(bits)}</span>
        <span className={`ieee-chip cat-${f.category}`}>{CATEGORY_LABELS[f.category]}</span>
      </div>
      <div className="ieee-bits mono" aria-label={`bits ${binary}`}>
        <BitGroup bits={binary.slice(0, 1)} kind="sign" />
        <BitGroup bits={binary.slice(1, 9)} kind="exp" />
        <BitGroup bits={binary.slice(9)} kind="frac" />
      </div>
      <div className="ieee-legend">
        <span className="leg-sign">sign {f.sign}</span>
        <span className="leg-exp">exponent {f.exponent}{exponentNote(f)}</span>
        <span className="leg-frac">fraction 0x{f.fraction.toString(16).padStart(6, '0')}</span>
      </div>
      <p className="ieee-formula mono">{formula(f, bits)}</p>
      <p className="ieee-meta muted">
        <span className="mono">{hex32(bits)}</span> · fclass bit {clsBit}: {FCLASS_NAMES[clsBit]}
      </p>
    </div>
  );
}

function BitGroup({ bits, kind }: { bits: string; kind: 'sign' | 'exp' | 'frac' }) {
  return (
    <span className={`ieee-group g-${kind}`}>
      {[...bits].map((b, i) => <i key={i} className={b === '1' ? 'is-one' : ''}>{b}</i>)}
    </span>
  );
}

function exponentNote(f: FloatFields): string {
  if (f.category === 'normal') return ` → 2^${f.exponent - EXP_BIAS}`;
  if (f.exponent === 0) return ' (zero/subnormal)';
  return ' (all ones: inf/NaN)';
}

function trim(n: number): string {
  return String(Number(n.toPrecision(SIGNIFICAND_DIGITS)));
}

/** The value written out as (−1)^s × significand × 2^e. */
function formula(f: FloatFields, bits: number): string {
  const sign = f.sign ? '−1' : '+1';
  const frac = f.fraction / 2 ** FRACTION_BITS;
  switch (f.category) {
    case 'normal': return `${sign} × ${trim(1 + frac)} × 2^${f.exponent - EXP_BIAS} = ${formatFloat(bits)}`;
    case 'subnormal': return `${sign} × ${trim(frac)} × 2^-126 = ${formatFloat(bits)} (no hidden 1)`;
    case 'zero': return `exponent and fraction all zero → ${formatFloat(bits)}`;
    case 'infinity': return `exponent all ones, fraction zero → ${formatFloat(bits)}`;
    case 'qnan': return 'exponent all ones, fraction ≠ 0, top fraction bit set → quiet NaN';
    case 'snan': return 'exponent all ones, fraction ≠ 0, top fraction bit clear → signalling NaN';
  }
}
