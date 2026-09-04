import { describe, expect, it } from 'vitest';
import { assemble } from '../src/core/asm/assembler';
import { CHAR_OUT_BASE, LED_BASE, SWITCH_BASE, CYCLES_BASE } from '../src/core/io/devices';
import { Machine } from '../src/core/sim/machine';

describe('memory-mapped I/O', () => {
  it('writes LEDs, reads switches, prints via the character device, reads the cycle counter', () => {
    const p = assemble(`
      li t0, ${LED_BASE}
      li t1, 0x00ff0000
      sw t1, 0(t0)          # LED 0 red
      sw t1, 4(t0)          # LED 1 red
      li t2, ${SWITCH_BASE}
      lw a0, 0(t2)          # switches
      li t3, ${CHAR_OUT_BASE}
      li t4, 72             # 'H'
      sb t4, 0(t3)
      li t5, ${CYCLES_BASE}
      lw a1, 0(t5)
    `);
    expect(p.errors).toEqual([]);
    const m = new Machine(p, 'single');
    m.core.devices.switches.value = 0b101;
    m.run(100);
    expect(m.core.devices.leds.pixels[0]).toBe(0x00ff0000);
    expect(m.core.devices.leds.pixels[1]).toBe(0x00ff0000);
    expect(m.core.devices.leds.pixels[2]).toBe(0);
    expect(m.core.regs[10]).toBe(5);
    expect(m.output).toBe('H');
    expect(m.core.regs[11]).toBeGreaterThan(0);
    // Undo restores LED state and output.
    while (m.canUndo) m.undo();
    expect(m.core.devices.leds.pixels[0]).toBe(0);
    expect(m.output).toBe('');
  });

  it('does not route I/O accesses through the data cache', () => {
    const p = assemble(`li t0, ${LED_BASE}\nsw zero, 0(t0)\nlw t1, 0(t0)`);
    const m = new Machine(p, 'single');
    m.run(100);
    expect(m.dcache.stats.reads + m.dcache.stats.writes).toBe(0);
  });
});

describe('input syscalls', () => {
  it('blocks on read_int until input is provided, in both models', () => {
    for (const model of ['single', 'pipeline'] as const) {
      const p = assemble('li a7, 5\necall\naddi a0, a0, 1\nli a7, 1\necall\nli a7, 10\necall');
      const m = new Machine(p, model);
      const r = m.run(1000);
      expect(r.stoppedAtBreakpoint).toBe(false);
      expect(m.blocked).toBe(true);
      expect(m.finished).toBe(false);
      expect(m.step()).toBeNull();
      m.provideInput('41');
      expect(m.blocked).toBe(false);
      m.run(1000);
      expect(m.finished).toBe(true);
      expect(m.output).toBe('41\n42');
    }
  });

  it('read_string stores a NUL-terminated string that undo removes', () => {
    const p = assemble('.data\nbuf: .space 16\n.text\nla a0, buf\nli a1, 16\nli a7, 8\necall\nlbu t0, 1(a0)');
    const m = new Machine(p, 'single');
    m.run(100);
    expect(m.blocked).toBe(true);
    m.provideInput('hi');
    m.run(100);
    expect(m.core.regs[5]).toBe('i'.charCodeAt(0));
    expect(m.core.mem.readByte(0x10000002)).toBe(0);
    while (m.canUndo) m.undo();
    expect(m.core.mem.readByte(0x10000000)).toBe(0);
  });
});
