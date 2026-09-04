import { describe, expect, it } from 'vitest';
import { assemble, DATA_BASE } from '../src/core/asm/assembler';
import { decode, disassemble } from '../src/core/isa/decode';

const words = (src: string) => {
  const p = assemble(src);
  expect(p.errors).toEqual([]);
  return p.text.map((t) => t.word);
};

describe('assembler', () => {
  it('encodes R/I/S/B/U/J formats', () => {
    expect(words('add x1, x2, x3')).toEqual([0x003100b3]);
    expect(words('addi t0, zero, -1')).toEqual([0xfff00293]);
    expect(words('sw a0, 8(sp)')).toEqual([0x00a12423]);
    expect(words('lw a0, -4(s0)')).toEqual([0xffc42503]);
    expect(words('lui a0, 0x12345')).toEqual([0x12345537]);
    expect(words('srai a1, a2, 3')).toEqual([0x40365593]);
    expect(words('loop: beq x1, x2, loop')).toEqual([0x00208063]);
    expect(words('jal ra, 8\n nop\n nop')[0]).toEqual(0x008000ef);
    expect(words('mul a0, a1, a2')).toEqual([0x02c58533]);
  });

  it('handles backward and forward branch targets', () => {
    const w = words('start:\n addi x1, x0, 1\n bne x1, x0, end\n addi x2, x0, 2\nend:\n j start');
    expect(disassemble(decode(w[1]), 4)).toBe('bne ra, zero, 0xc');
    expect(decode(w[3]).imm).toBe(-12);
  });

  it('expands pseudo-instructions', () => {
    expect(words('li a0, 5')).toEqual([0x00500513]);
    expect(words('li a0, 0x12345678').length).toBe(2);
    const p = assemble('li a0, 0x12345678');
    // lui+addi round-trip must reconstruct the value.
    const hi = decode(p.text[0].word).imm, lo = decode(p.text[1].word).imm;
    expect(((hi + lo) | 0) >>> 0).toBe(0x12345678);
    expect(words('mv a0, a1')).toEqual([0x00058513]);
    expect(words('ret')).toEqual([0x00008067]);
    expect(words('nop')).toEqual([0x00000013]);
    expect(words('bgt a0, a1, 0')).toEqual([0x00a5c063]);
    expect(words('la a0, 0x100').length).toBe(2);
  });

  it('lays out data and resolves labels across sections', () => {
    const p = assemble('.data\nx: .word 1, 2, 3\nmsg: .asciz "hi"\n.text\nla a0, x\nlw a1, 0(a0)');
    expect(p.errors).toEqual([]);
    expect(p.labels.get('x')).toBe(DATA_BASE);
    expect(p.labels.get('msg')).toBe(DATA_BASE + 12);
    expect(p.segments.find((d) => d.addr === DATA_BASE + 12)?.bytes).toEqual(Uint8Array.from([104, 105, 0]));
  });

  it('reports errors with line numbers', () => {
    const p = assemble('addi x1, x2\nfoo x1\naddi x1, x2, 5000');
    expect(p.errors.map((e) => e.line)).toEqual([1, 2, 3]);
    expect(p.errors[2].message).toMatch(/out of range/);
  });

  it('supports .equ, expressions, and comments', () => {
    const p = assemble('.equ N, 4\n# comment\naddi a0, zero, N*2+1 // trailing');
    expect(p.errors).toEqual([]);
    expect(decode(p.text[0].word).imm).toBe(9);
  });

  it('maps source lines to addresses', () => {
    const p = assemble('\nstart:\n  li a0, 1\n  li a1, 0x12345678\n  ecall');
    expect(p.lineToAddr.get(3)).toBe(0);
    expect(p.lineToAddr.get(4)).toBe(4);
    expect(p.lineToAddr.get(5)).toBe(12);
    expect(p.addrToLine.get(8)).toBe(4);
  });
});
