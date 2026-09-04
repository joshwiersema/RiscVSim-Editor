import { describe, expect, it } from 'vitest';
import { assemble } from '../src/core/asm/assembler';
import { INSTR_BY_NAME } from '../src/core/isa/instructions';
import { Machine } from '../src/core/sim/machine';
import type { ModelKind } from '../src/core/sim/processor';
import { classify, summarize } from '../src/core/sim/stats';

const MIXED = `
.data
v: .word 5
.text
main:
  lui  t0, 0x10000
  lw   t1, 0(t0)
  sw   t1, 4(t0)
  and  t2, t1, t1
  sll  t3, t1, t1
  mul  t4, t1, t1
  beq  zero, zero, done
  addi t5, t5, 1
done:
  jal  ra, fin
fin:
  li   a7, 10
  ecall
`;

function run(model: ModelKind) {
  const p = assemble(MIXED);
  expect(p.errors).toEqual([]);
  const m = new Machine(p, model);
  m.run(10000);
  expect(m.finished).toBe(true);
  return m;
}

describe('classify', () => {
  it('buckets instructions by what the datapath does with them', () => {
    const c = (n: string) => classify(INSTR_BY_NAME.get(n) ?? null);
    expect(c('add')).toBe('arith');
    expect(c('addi')).toBe('arith');
    expect(c('lui')).toBe('arith');
    expect(c('and')).toBe('logic');
    expect(c('xori')).toBe('logic');
    expect(c('srai')).toBe('shift');
    expect(c('rem')).toBe('muldiv');
    expect(c('lbu')).toBe('load');
    expect(c('sh')).toBe('store');
    expect(c('bge')).toBe('branch');
    expect(c('jalr')).toBe('jump');
    expect(c('ecall')).toBe('system');
    expect(classify(null)).toBe('other');
  });
});

describe('summarize', () => {
  it.each(['single', 'pipeline'] as ModelKind[])('counts retired instructions on the %s processor', (model) => {
    const m = run(model);
    const s = summarize(m.traces, m.core.stats);
    expect(s.instructions).toBe(10);
    expect(s.mix).toEqual({ arith: 2, logic: 1, shift: 1, muldiv: 1, load: 1, store: 1, branch: 1, jump: 1, system: 1, other: 0 });
    expect(s.branches).toEqual({ total: 1, taken: 1 });
    expect(s.loads).toBe(1);
    expect(s.stores).toBe(1);
    expect(s.jumps).toBe(1);
    expect(s.cycles).toBe(m.core.stats.cycles);
    expect(s.cpi).toBeCloseTo(m.core.stats.cycles / 10);
    expect(s.sampledCycles).toBe(m.traces.length);
  });

  it('reports pipeline idle cycles and flushes', () => {
    const m = run('pipeline');
    const s = summarize(m.traces, m.core.stats);
    expect(s.flushes).toBeGreaterThan(0);
    expect(s.idleCycles).toBeGreaterThan(0);
    expect(s.idleCycles + s.instructions).toBe(s.cycles);
  });

  it('handles an empty history', () => {
    const s = summarize([], { cycles: 0, instructions: 0, stalls: 0, flushes: 0 });
    expect(s.cpi).toBeNull();
    expect(s.instructions).toBe(0);
    expect(s.regWrites).toBe(0);
  });
});
