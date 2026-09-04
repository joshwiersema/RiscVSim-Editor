import { describe, expect, it } from 'vitest';
import { assemble, DATA_BASE } from '../src/core/asm/assembler';
import { Machine } from '../src/core/sim/machine';
import type { ModelKind } from '../src/core/sim/processor';

function runProgram(src: string, model: ModelKind, opts = { forwarding: true, hazardDetection: true }) {
  const p = assemble(src);
  expect(p.errors).toEqual([]);
  const m = new Machine(p, model, opts);
  const r = m.run(100000);
  expect(r.cycles).toBeLessThan(100000);
  return m;
}

const FIB = `
  li a0, 10
  li t0, 0
  li t1, 1
loop:
  beqz a0, done
  add t2, t0, t1
  mv t0, t1
  mv t1, t2
  addi a0, a0, -1
  j loop
done:
  mv a0, t0
  li a7, 1
  ecall
  li a7, 10
  ecall
`;

for (const model of ['single', 'pipeline'] as ModelKind[]) {
  describe(`${model} processor`, () => {
    it('computes fibonacci and prints it', () => {
      const m = runProgram(FIB, model);
      expect(m.output).toBe('55');
      expect(m.core.regs[10]).toBe(55);
      expect(m.finished).toBe(true);
    });

    it('does loads, stores, and sign extension', () => {
      const m = runProgram(`
        .data
        arr: .word 10, -20, 30
        b: .byte 0xff
        .text
        la t0, arr
        lw t1, 4(t0)
        lb t2, 12(t0)
        lbu t3, 12(t0)
        addi t1, t1, 1
        sw t1, 4(t0)
        lw t4, 4(t0)
        sh t1, 0(t0)
      `, model);
      expect(m.core.regs[6]).toBe(-19);
      expect(m.core.regs[7]).toBe(-1);
      expect(m.core.regs[28]).toBe(255);
      expect(m.core.regs[29]).toBe(-19);
      expect(m.core.mem.readWord(DATA_BASE + 4) | 0).toBe(-19);
      expect(m.core.mem.read(DATA_BASE, 2)).toBe(0xffed);
    });

    it('handles jal/jalr call and return', () => {
      const m = runProgram(`
        li a0, 3
        jal ra, double
        addi a1, a0, 100
        j end
      double:
        add a0, a0, a0
        ret
      end:
        nop
      `, model);
      expect(m.core.regs[10]).toBe(6);
      expect(m.core.regs[11]).toBe(106);
    });

    it('executes M extension ops', () => {
      const m = runProgram('li a0, -7\n li a1, 2\n mul a2, a0, a1\n div a3, a0, a1\n rem a4, a0, a1\n divu a5, a0, a1', model);
      expect(m.core.regs[12]).toBe(-14);
      expect(m.core.regs[13]).toBe(-3);
      expect(m.core.regs[14]).toBe(-1);
      expect(m.core.regs[15]).toBe(0x7ffffffc);
    });

    it('can undo every cycle back to reset', () => {
      const p = assemble(FIB);
      const m = new Machine(p, model);
      const initial = [...m.core.regs];
      for (let i = 0; i < 25; i++) m.step();
      while (m.canUndo) m.undo();
      expect(m.core.regs).toEqual(initial);
      expect(m.core.pc).toBe(0);
      expect(m.core.cycle).toBe(0);
    });
  });
}

describe('pipeline hazards', () => {
  it('stalls once on a load-use hazard and forwards otherwise', () => {
    const m = runProgram(`
      .data
      v: .word 41
      .text
      la t0, v
      lw t1, 0(t0)
      addi t1, t1, 1
      add t2, t1, t1
    `, 'pipeline');
    expect(m.core.regs[6]).toBe(42);
    expect(m.core.regs[7]).toBe(84);
    expect(m.core.stats.stalls).toBe(1);
  });

  it('stalls more without forwarding but still computes correctly', () => {
    const src = 'li t0, 5\n addi t1, t0, 1\n add t2, t1, t0\n sub t3, t2, t1';
    const fwd = runProgram(src, 'pipeline');
    const noFwd = runProgram(src, 'pipeline', { forwarding: false, hazardDetection: true });
    expect(fwd.core.regs[28]).toBe(5);
    expect(noFwd.core.regs[28]).toBe(5);
    expect(noFwd.core.stats.stalls).toBeGreaterThan(fwd.core.stats.stalls);
    expect(fwd.core.stats.stalls).toBe(0);
  });

  it('produces wrong results without hazard detection or forwarding (teaching mode)', () => {
    const m = runProgram('li t0, 5\n addi t1, t0, 1', 'pipeline', { forwarding: false, hazardDetection: false });
    expect(m.core.regs[6]).toBe(1); // read stale t0 = 0
  });

  it('flushes two instructions on a taken branch', () => {
    const m = runProgram('li t0, 1\n beqz zero, skip\n li t1, 99\n li t2, 99\nskip:\n li t3, 7', 'pipeline');
    expect(m.core.regs[6]).toBe(0);
    expect(m.core.regs[7]).toBe(0);
    expect(m.core.regs[28]).toBe(7);
    expect(m.core.stats.flushes).toBe(1);
  });

  it('keeps the same fetch sequence number for the instruction re-fetched during a stall', () => {
    const p = assemble('.data\nv: .word 1\n.text\nla t0, v\nlw t1, 0(t0)\naddi t1, t1, 1\nsw t1, 0(t0)');
    const m = new Machine(p, 'pipeline');
    const traces = [];
    while (!m.finished) traces.push(m.step()!);
    const stallCycle = traces.find((t) => t.hazard.stall)!;
    const next = traces[traces.indexOf(stallCycle) + 1];
    expect(stallCycle.stages.IF.trace?.seq).toBe(next.stages.IF.trace?.seq);
    const seqs = traces.flatMap((t) => (t.stages.WB.trace ? [t.stages.WB.trace.seq] : []));
    expect(seqs).toEqual([1, 2, 3, 4, 5]);
  });

  it('reports the forwarding source in the trace', () => {
    const p = assemble('li t0, 5\n addi t1, t0, 1\n add t2, t1, t0');
    const m = new Machine(p, 'pipeline');
    const traces = [];
    while (!m.finished) traces.push(m.step()!);
    const addiEx = traces.map((t) => t.stages.EX.trace).find((t) => t?.instr.def?.name === 'addi' && t.instr.rd === 6);
    expect(addiEx?.fwdA).toBe('EXMEM');
    const addEx = traces.map((t) => t.stages.EX.trace).find((t) => t?.instr.def?.name === 'add');
    expect(addEx?.fwdA).toBe('EXMEM');
    expect(addEx?.fwdB).toBe('MEMWB');
  });
});
