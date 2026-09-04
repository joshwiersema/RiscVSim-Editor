import { describe, expect, it } from 'vitest';
import { assemble } from '../src/core/asm/assembler';
import { parseElf } from '../src/core/elf/elf';
import { programFromElf } from '../src/core/elf/loadElf';
import { Machine } from '../src/core/sim/machine';

/** Build a minimal RISC-V ELF32 with one code segment, one data segment, and a symbol table. */
function buildElf(text: Uint8Array, textAddr: number, data: Uint8Array, dataAddr: number, symbols: [string, number][]): Uint8Array {
  const strtab = [0, ...symbols.flatMap(([n]) => [...new TextEncoder().encode(n), 0])];
  const nameOffsets: number[] = [];
  let off = 1;
  for (const [n] of symbols) { nameOffsets.push(off); off += n.length + 1; }
  const symEntries = 1 + symbols.length;
  const symtab = new Uint8Array(16 * symEntries);
  const sdv = new DataView(symtab.buffer);
  symbols.forEach(([, value], i) => {
    const o = 16 * (i + 1);
    sdv.setUint32(o, nameOffsets[i], true);
    sdv.setUint32(o + 4, value, true);
    symtab[o + 12] = 0x12; // GLOBAL FUNC
    sdv.setUint16(o + 14, 1, true); // defined in section 1
  });

  const ehsize = 52, phentsize = 32, shentsize = 40;
  const phoff = ehsize, phnum = 2;
  const textOff = phoff + phnum * phentsize;
  const dataOff = textOff + text.length;
  const strOff = dataOff + data.length;
  const symOff = strOff + strtab.length;
  const shoff = symOff + symtab.length;
  const shnum = 4; // null, .text, .strtab, .symtab
  const total = shoff + shnum * shentsize;
  const buf = new Uint8Array(total);
  const dv = new DataView(buf.buffer);
  buf.set([0x7f, 0x45, 0x4c, 0x46, 1, 1, 1, 0]);
  dv.setUint16(16, 2, true); dv.setUint16(18, 0xf3, true); dv.setUint32(20, 1, true);
  dv.setUint32(24, textAddr, true); dv.setUint32(28, phoff, true); dv.setUint32(32, shoff, true);
  dv.setUint16(40, ehsize, true); dv.setUint16(42, phentsize, true); dv.setUint16(44, phnum, true);
  dv.setUint16(46, shentsize, true); dv.setUint16(48, shnum, true); dv.setUint16(50, 2, true);
  const ph = (i: number, offset: number, vaddr: number, size: number, flags: number) => {
    const o = phoff + i * phentsize;
    dv.setUint32(o, 1, true); dv.setUint32(o + 4, offset, true); dv.setUint32(o + 8, vaddr, true); dv.setUint32(o + 12, vaddr, true);
    dv.setUint32(o + 16, size, true); dv.setUint32(o + 20, size, true); dv.setUint32(o + 24, flags, true); dv.setUint32(o + 28, 4, true);
  };
  ph(0, textOff, textAddr, text.length, 5);
  ph(1, dataOff, dataAddr, data.length, 6);
  buf.set(text, textOff); buf.set(data, dataOff); buf.set(strtab, strOff); buf.set(symtab, symOff);
  const sh = (i: number, type: number, offset: number, size: number, link: number, entsize: number) => {
    const o = shoff + i * shentsize;
    dv.setUint32(o + 4, type, true); dv.setUint32(o + 16, offset, true); dv.setUint32(o + 20, size, true); dv.setUint32(o + 24, link, true); dv.setUint32(o + 36, entsize, true);
  };
  sh(1, 1, textOff, text.length, 0, 0);
  sh(2, 3, strOff, strtab.length, 0, 0);
  sh(3, 2, symOff, symtab.length, 2, 16);
  return buf;
}

describe('ELF loader', () => {
  it('loads segments, entry, and symbols, and the program runs', () => {
    const asm = assemble('.data\nv: .word 41\n.text\nmain:\nlui t0, 0x10000\nlw a0, 0(t0)\naddi a0, a0, 1\nli a7, 1\necall\nli a7, 10\necall');
    expect(asm.errors).toEqual([]);
    const text = asm.segments[0].bytes;
    const data = Uint8Array.from([41, 0, 0, 0]);
    const elf = buildElf(text, 0x0, data, 0x10000000, [['main', 0], ['v', 0x10000000]]);
    const img = parseElf(elf);
    expect(img.entry).toBe(0);
    expect(img.symbols.get('main')).toBe(0);
    expect(img.textRange).toEqual({ start: 0, end: text.length });
    const program = programFromElf(elf);
    expect(program.kind).toBe('elf');
    expect(program.text.length).toBe(7);
    expect(program.text[1].text).toBe('lw a0, 0(t0)');
    const m = new Machine(program, 'pipeline');
    m.run(1000);
    expect(m.output).toBe('42');
  });

  it('rejects non-RISC-V and 64-bit files', () => {
    const bad = buildElf(new Uint8Array(4), 0, new Uint8Array(0), 0, []);
    bad[4] = 2;
    expect(() => parseElf(bad)).toThrow(/32-bit/);
    const notElf = new Uint8Array(64);
    expect(() => parseElf(notElf)).toThrow(/not an ELF/);
  });
});
