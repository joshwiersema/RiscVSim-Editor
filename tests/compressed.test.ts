import { describe, expect, it } from 'vitest';
import { assemble } from '../src/core/asm/assembler';
import { compressWord, expandCompressed, COMPRESSED_NAMES } from '../src/core/isa/compressed';
import { decode, decodeAt, disassemble } from '../src/core/isa/decode';
import { Machine } from '../src/core/sim/machine';
import type { ModelKind } from '../src/core/sim/processor';

/** Known-good encodings from the RISC-V spec / GNU assembler. */
const VECTORS: [number, string][] = [
  [0x0001, 'c.nop'],
  [0x0505, 'c.addi a0, a0, 1'],           // c.addi a0, 1
  [0x4501, 'c.li a0, zero, 0'],           // c.li a0, 0
  [0x4529, 'c.li a0, zero, 10'],          // c.li a0, 10
  [0x852e, 'c.mv a0, zero, a1'],          // c.mv a0, a1
  [0x952e, 'c.add a0, a0, a1'],           // c.add a0, a1
  [0x8082, 'c.jr zero, 0(ra)'],           // ret
  [0xc63e, 'c.swsp a5, 12(sp)'],          // c.swsp a5, 12(sp)
  [0x47b2, 'c.lwsp a5, 12(sp)'],          // c.lwsp a5, 12(sp)
  [0x1141, 'c.addi sp, sp, -16'],         // addi sp, sp, -16
  [0x7175, 'c.addi16sp sp, sp, -144'],    // addi sp, sp, -144
  [0x0800, 'c.addi4spn s0, sp, 16'],      // c.addi4spn s0, sp, 16
  [0x4398, 'c.lw a4, 0(a5)'],             // c.lw a4, 0(a5)
  [0xc398, 'c.sw a4, 0(a5)'],             // c.sw a4, 0(a5)
  [0x8e09, 'c.sub a2, a2, a0'],           // c.sub a2, a0
  [0x8d75, 'c.and a0, a0, a3'],           // c.and a0, a3
  [0x0586, 'c.slli a1, a1, 1'],           // c.slli a1, 1
  [0x6785, 'c.lui a5, 0x1'],              // c.lui a5, 1
  [0x9002, 'c.ebreak'],
];

describe('RV32C', () => {
  it('expands known encodings', () => {
    for (const [half, text] of VECTORS) {
      const d = decodeAt(half, half);
      expect(d.size).toBe(2);
      expect(disassemble(d, 0)).toBe(text);
    }
  });

  it('round-trips every compressible 32-bit form through compress -> expand', () => {
    const words = [
      0x00150513, // addi a0, a0, 1
      0x00a00513, // addi a0, zero, 10
      0x00b00533, // add a0, zero, a1
      0x00b50533, // add a0, a0, a1
      0x00008067, // jalr zero, 0(ra)
      0x00f12623, // sw a5, 12(sp)
      0x00c12783, // lw a5, 12(sp)
      0xff010113, // addi sp, sp, -16
      0x01010413, // addi s0, sp, 16
      0x0007a703, // lw a4, 0(a5)
      0x00e7a023, // sw a4, 0(a5)
      0x40a60633, // sub a2, a2, a0
      0x00d57533, // and a0, a0, a3
      0x00159593, // slli a1, a1, 1
      0x000017b7, // lui a5, 1
      0x00100073, // ebreak
      0x0000006f, // jal zero, 0
      0x000000ef, // jal ra, 0
      0x00050063, // beq a0, zero, 0
      0x00051063, // bne a0, zero, 0
      0x0017d793, // srli a5, a5, 1
      0x4017d793, // srai a5, a5, 1
      0x0017f793, // andi a5, a5, 1
    ];
    for (const w of words) {
      const c = compressWord(w);
      expect(c, `compress ${w.toString(16)}`).not.toBeNull();
      const back = expandCompressed(c!.word);
      expect(back?.word, `expand ${c!.name}`).toBe(w >>> 0);
      expect(COMPRESSED_NAMES).toContain(c!.name);
    }
  });

  it('refuses to compress instructions with no compressed form', () => {
    expect(compressWord(decode(0x7ff50513).word)).toBeNull(); // addi a0, a0, 2047
    expect(compressWord(0x00a58533)).toBeNull(); // add a0, a1, a0 (rd != rs1, rs1 != x0)
  });

  it('assembles explicit c.* mnemonics with 2-byte layout', () => {
    const p = assemble('c.li a0, 5\nc.addi a0, 1\nadd a1, a0, a0\nc.j end\nnop\nend:\nc.ebreak');
    expect(p.errors).toEqual([]);
    expect(p.text.map((t) => [t.addr, t.size])).toEqual([[0, 2], [2, 2], [4, 4], [8, 2], [10, 4], [14, 2]]);
    expect(p.labels.get('end')).toBe(14);
    expect(p.text[0].raw).toBe(0x4515);
  });

  it('rejects c.* operands that do not fit', () => {
    const p = assemble('c.addi a0, 100');
    expect(p.errors[0].message).toMatch(/cannot be encoded/);
  });

  it('auto-compresses and relaxes branch offsets until stable', () => {
    const src = 'li a0, 4\nloop:\n addi a0, a0, -1\n bnez a0, loop\n add a1, a0, a0\n mv a2, a1\n li a7, 10\n ecall';
    const plain = assemble(src);
    const small = assemble(src, { autoCompress: true });
    expect(small.errors).toEqual([]);
    expect(small.textEnd).toBeLessThan(plain.textEnd);
    expect(small.text.filter((t) => t.size === 2).length).toBeGreaterThanOrEqual(4);
    for (const model of ['single', 'pipeline'] as ModelKind[]) {
      const m = new Machine(small, model);
      m.run(10000);
      expect(m.finished).toBe(true);
      expect(m.core.regs[10]).toBe(0);
      expect(m.core.regs[12]).toBe(0);
    }
  });

  it('executes a mixed compressed/uncompressed program identically in both models', () => {
    const src = `
      c.li t0, 7
      c.li t1, 3
      c.add t0, t1        # 10
      addi t2, t0, 1000   # 1010 (not compressible)
      c.j skip
      c.li t2, 0
    skip:
      c.mv a0, t2
      li a7, 1
      ecall
      li a7, 10
      ecall`;
    for (const model of ['single', 'pipeline'] as ModelKind[]) {
      const p = assemble(src);
      expect(p.errors).toEqual([]);
      const m = new Machine(p, model);
      m.run(10000);
      expect(m.output).toBe('1010');
      expect(m.core.stats.instructions).toBe(10);
    }
  });
});
