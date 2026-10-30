import { describe, expect, it } from 'vitest';
import { assemble, DATA_BASE } from '../src/core/asm/assembler';
import { decode, disassemble } from '../src/core/isa/decode';
import { INSTRUCTIONS } from '../src/core/isa/instructions';
import { FP_REG_BASE } from '../src/core/isa/registers';
import { floatToBits, bitsToFloat } from '../src/core/fp/format';
import { FLAG } from '../src/core/fp/softfloat';
import { Machine } from '../src/core/sim/machine';
import { EXAMPLES } from '../src/ui/examples';
import type { ModelKind } from '../src/core/sim/processor';
import type { CycleTrace } from '../src/core/sim/types';

const F = (n: number) => FP_REG_BASE + n;
const fa = (i: number) => F(10 + i);
const ft = (i: number) => F(i);

function run(src: string, model: ModelKind, opts = { forwarding: true, hazardDetection: true }) {
  const p = assemble(src);
  expect(p.errors).toEqual([]);
  const m = new Machine(p, model, opts);
  m.run(100000);
  return m;
}

const float = (m: Machine, reg: number) => bitsToFloat(m.core.regs[reg]);

describe('RV32F encoding matches GNU as', () => {
  const word = (line: string) => {
    const p = assemble(line);
    expect(p.errors).toEqual([]);
    return p.text[0].word >>> 0;
  };
  it.each([
    ['fadd.s ft0, ft1, ft2', 0x0020f053],
    ['flw fa0, 4(sp)', 0x00412507],
    ['fsw fa0, 8(sp)', 0x00a12427],
    ['fcvt.w.s a0, fa0, rtz', 0xc0051553],
    ['fmadd.s fa0, fa1, fa2, fa3', 0x68c5f543],
    ['fmv.x.w a0, fa0', 0xe0050553],
    ['feq.s a0, fa0, fa1', 0xa0b52553],
    ['frcsr a0', 0x00302573],
    ['fsrmi 1', 0x0020d073],
  ])('%s', (line, expected) => {
    expect(word(line)).toBe(expected);
  });
});

describe('every RV32F/Zicsr instruction decodes back to itself', () => {
  const sample: Record<string, string> = {
    R: 'f1, f2, f3', R4: 'f1, f2, f3, f4', I: 'f1, 4(a0)', S: 'f1, 4(a0)',
  };
  for (const def of INSTRUCTIONS.filter((d) => d.fpu || d.csr || d.name === 'flw' || d.name === 'fsw')) {
    it(def.name, () => {
      let ops = sample[def.format];
      if (def.csr) ops = def.csrImm ? 'a0, fcsr, 3' : 'a0, fcsr, a1';
      else if (def.files) {
        const reg = (op: 'rd' | 'rs1' | 'rs2', n: number) => `${def.files?.[op] === 'F' ? 'f' : 'x'}${n}`;
        if (def.format === 'R') ops = def.rs2Sel !== undefined ? `${reg('rd', 5)}, ${reg('rs1', 6)}` : `${reg('rd', 5)}, ${reg('rs1', 6)}, ${reg('rs2', 7)}`;
      }
      const p = assemble(`${def.name} ${ops}`);
      expect(p.errors).toEqual([]);
      const d = decode(p.text[0].word);
      expect(d.def?.name).toBe(def.name);
      expect(disassemble(d).split(' ')[0]).toBe(def.name);
    });
  }
  it('rejects the reserved rounding modes 5 and 6', () => {
    const w = assemble('fadd.s ft0, ft1, ft2, rne').text[0].word;
    expect(decode((w & ~0x7000) | (5 << 12)).def).toBeNull();
  });
  it('shows a static rounding mode in the disassembly', () => {
    expect(disassemble(decode(assemble('fcvt.w.s a0, fa0, rtz').text[0].word))).toBe('fcvt.w.s a0, fa0, rtz');
  });
});

describe('assembler checks register files', () => {
  it('rejects an integer register where a float is required', () => {
    expect(assemble('fadd.s a0, ft1, ft2').errors[0].message).toMatch(/floating-point register/);
    expect(assemble('fcvt.w.s ft0, fa0').errors[0].message).toMatch(/integer register/);
    expect(assemble('fadd.s ft0, ft1, ft2, fast').errors[0].message).toMatch(/rounding mode/);
  });
  it('emits IEEE-754 words for .float', () => {
    const p = assemble('.data\nx: .float 1.5, -0.1, inf, nan\n.text\nnop');
    const bytes = p.segments.filter((s) => s.addr >= DATA_BASE).flatMap((s) => [...s.bytes]);
    const words = [0, 4, 8, 12].map((o) => (bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16) | (bytes[o + 3] << 24)) | 0);
    expect(words).toEqual([floatToBits(1.5), floatToBits(-0.1), 0x7f800000, 0x7fc00000]);
  });
});

const PROGRAM = `
.data
vals: .float 1.5, 2.25, -4.0
out:  .float 0
.text
  la t0, vals
  flw ft0, 0(t0)
  flw ft1, 4(t0)
  fadd.s ft2, ft0, ft1        # 3.75 (forwarded straight into fmul)
  fmul.s ft3, ft2, ft1        # 8.4375
  flw ft4, 8(t0)
  fmadd.s ft5, ft0, ft1, ft4  # 1.5*2.25 - 4 = -0.625
  fsqrt.s ft6, ft1            # 1.5
  fneg.s ft7, ft6             # -1.5
  fabs.s fs0, ft7             # 1.5
  fmin.s fs1, ft4, ft0        # -4
  flt.s a1, ft4, ft0          # 1
  fle.s a2, ft0, ft4          # 0
  feq.s a3, ft6, ft0          # 1
  fcvt.w.s a4, ft3, rtz       # 8
  fcvt.w.s a5, ft3            # 8 (rne: 8.4375 -> 8)
  li t1, -7
  fcvt.s.w fs2, t1            # -7.0
  fmv.x.w a6, ft0             # 0x3fc00000
  fsw ft3, 12(t0)
  fclass.s s2, ft4            # negative normal = bit 1
  fmv.s fa0, ft5
  li a7, 2
  ecall                       # print_float -0.625
`;

for (const model of ['single', 'pipeline'] as ModelKind[]) {
  describe(`${model} processor runs floating-point code`, () => {
    const m = run(PROGRAM, model);
    it('computes arithmetic, fused ops, and sign injection', () => {
      expect(float(m, ft(2))).toBe(3.75);
      expect(float(m, ft(3))).toBe(8.4375);
      expect(float(m, ft(5))).toBe(-0.625);
      expect(float(m, ft(6))).toBe(1.5);
      expect(float(m, ft(7))).toBe(-1.5);
      expect(float(m, F(8))).toBe(1.5);
      expect(float(m, F(9))).toBe(-4);
      expect(float(m, F(18))).toBe(-7);
    });
    it('writes integer results of compares, conversions, and moves to x registers', () => {
      expect(m.core.regs.slice(11, 17)).toEqual([1, 0, 1, 8, 8, 0x3fc00000]);
      expect(m.core.regs[18]).toBe(1 << 1);
    });
    it('stores floats to memory and prints them', () => {
      expect(m.core.mem.readWord(DATA_BASE + 12) | 0).toBe(floatToBits(8.4375));
      expect(m.output).toBe('-0.625');
    });
    it('accrues the inexact flag from fcvt.w.s 8.4375', () => {
      expect(m.core.fcsr & FLAG.NX).toBe(FLAG.NX);
    });
  });

  describe(`${model}: fcsr and rounding modes`, () => {
    it('frm changes how later instructions round, and flags are sticky until cleared', () => {
      const m = run(`
        li t0, 1
        li t1, 3
        fcvt.s.w ft0, t0
        fcvt.s.w ft1, t1
        fdiv.s ft2, ft0, ft1      # rne: rounds up
        fsrmi 1                   # rtz
        fdiv.s ft3, ft0, ft1      # dyn -> rtz: truncates
        fdiv.s ft4, ft0, ft1, rup # static rm overrides frm
        frflags a0                # NX
        fsflags x0                # clear
        frflags a1
        frrm a2
        fdiv.s ft5, ft0, ft0
        frcsr a3                  # rtz, no flags (1/1 is exact)
      `, model);
      expect(m.core.regs[ft(2)]).toBe(0x3eaaaaab);
      expect(m.core.regs[ft(3)]).toBe(0x3eaaaaaa);
      expect(m.core.regs[ft(4)]).toBe(0x3eaaaaab);
      expect(m.core.regs.slice(10, 14)).toEqual([FLAG.NX, 0, 1, 1 << 5]);
    });
    it('reads the cycle and instret counters', () => {
      const m = run('nop\nnop\nrdinstret a0\nrdcycle a1', model);
      expect(m.core.regs[10]).toBe(2);
      expect(m.core.regs[11]).toBeGreaterThanOrEqual(2);
    });
    it('traps on an invalid dynamic rounding mode', () => {
      const m = run('fsrmi 5\nfadd.s ft0, ft1, ft2\nli a0, 1', model);
      expect(m.core.error).toMatch(/frm = 5/);
      expect(m.core.regs[10]).toBe(0);
    });
    it('traps when writing a read-only CSR', () => {
      expect(run('csrw cycle, a0', model).core.error).toMatch(/read-only/);
    });
    it('reads a float from the console with read_float', () => {
      const m = new Machine(assemble('li a7, 6\necall\nfadd.s fa1, fa0, fa0'), model);
      m.run(1000);
      expect(m.blocked).toBe(true);
      m.provideInput('1.25');
      m.run(1000);
      expect(float(m, fa(1))).toBe(2.5);
    });
  });
}

describe('pipeline hazards across the FP register file', () => {
  it('forwards FP results from EX/MEM and MEM/WB, including the third FMA operand', () => {
    const p = assemble('li t0, 2\nfcvt.s.w ft0, t0\nfadd.s ft1, ft0, ft0\nfmadd.s ft2, ft1, ft0, ft1');
    const m = new Machine(p, 'pipeline');
    const traces: CycleTrace[] = [];
    while (!m.finished) traces.push(m.step()!);
    const ex = (name: string) => traces.map((t) => t.stages.EX.trace).find((t) => t?.instr.def?.name === name)!;
    expect(ex('fadd.s').fwdA).toBe('EXMEM');
    expect(ex('fmadd.s')).toMatchObject({ fwdA: 'EXMEM', fwdB: 'MEMWB', fwdC: 'EXMEM' });
    expect(bitsToFloat(m.core.regs[ft(2)])).toBe(4 * 2 + 4);
    expect(m.core.stats.stalls).toBe(0);
  });
  it('does not confuse x and f registers with the same number', () => {
    const m = run('li t0, 5\nfcvt.s.w ft5, t0\naddi t0, t0, 1\nfadd.s ft6, ft5, ft5', 'pipeline');
    expect(m.core.regs[5]).toBe(6);
    expect(float(m, ft(6))).toBe(10);
  });
  it('stalls once on an flw load-use hazard', () => {
    const m = run('.data\nv: .float 3\n.text\nla t0, v\nflw ft0, 0(t0)\nfadd.s ft1, ft0, ft0', 'pipeline');
    expect(float(m, ft(1))).toBe(6);
    expect(m.core.stats.stalls).toBe(1);
  });
  it('serializes behind CSR instructions until they reach WB', () => {
    const m = run('fsrmi 1\nli t0, 1\nfcvt.s.w ft0, t0', 'pipeline');
    expect(m.core.stats.stalls).toBe(2);
    expect(m.core.fcsr).toBe(1 << 5);
  });
});

describe('undo and compression', () => {
  it('undo restores f registers and fcsr', () => {
    const m = new Machine(assemble('li t0, 1\nli t1, 3\nfcvt.s.w ft0, t0\nfcvt.s.w ft1, t1\nfdiv.s ft2, ft0, ft1\nfsrmi 2'), 'pipeline');
    const initial = [...m.core.regs];
    while (!m.finished) m.step();
    expect(m.core.fcsr).toBe((2 << 5) | FLAG.NX);
    while (m.canUndo) m.undo();
    expect(m.core.regs).toEqual(initial);
    expect(m.core.fcsr).toBe(0);
  });
  it('auto-compresses flw/fsw to c.flw/c.fsw/c.flwsp/c.fswsp and runs them', () => {
    const src = '.data\nv: .float 2.5\n.text\nla s0, v\nflw fa0, 0(s0)\naddi sp, sp, -16\nfsw fa0, 4(sp)\nflw fa1, 4(sp)\nfsw fa1, 4(s0)';
    const p = assemble(src, { autoCompress: true });
    expect(p.errors).toEqual([]);
    const names = p.text.map((t) => (t.size === 2 ? decode(t.word, { half: t.raw, name: '' }) : null)).filter(Boolean);
    expect(names.length).toBeGreaterThanOrEqual(4);
    const m = new Machine(p, 'single');
    m.run(1000);
    expect(float(m, fa(1))).toBe(2.5);
    expect(m.core.mem.readWord(DATA_BASE + 4) | 0).toBe(floatToBits(2.5));
  });
});

describe('the Floating point example program', () => {
  it.each(['single', 'pipeline'] as ModelKind[])('%s: prints, rounds, and accrues flags as described', (model) => {
    const src = EXAMPLES.find((e) => e.id === 'float')!.source;
    const m = run(src, model);
    expect(m.core.error).toBeNull();
    expect(m.output).toMatch(/^area = 19\.63\d+\np\(r\) = 3\.0\nround\(area\) = 20$/);
    expect(m.core.regs.slice(18, 20)).toEqual([19, 20]); // s2 (rtz), s3 (rne)
    expect(m.core.regs[20]).toBe(FLAG.NV | FLAG.DZ | FLAG.NX); // s4
    expect(m.core.regs[28]).toBe(1 << 9); // t3: quiet NaN
    expect(m.core.fcsr).toBe(0);
  });
});
