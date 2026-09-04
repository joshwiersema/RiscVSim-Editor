import { decodeAt, disassemble } from '../isa/decode';
import type { Program, TextWord } from '../program';
import { parseElf } from './elf';

/** Turn an ELF image into a Program by loading its segments and disassembling the code. */
export function programFromElf(data: Uint8Array): Program {
  const img = parseElf(data);
  const labels = new Map(img.symbols);
  const byAddr = new Map<number, string>();
  for (const [name, addr] of labels) if (!byAddr.has(addr)) byAddr.set(addr, name);

  const text: TextWord[] = [];
  const range = img.textRange;
  if (range) {
    const bytes = new Map<number, number>();
    for (const s of img.segments) for (let i = 0; i < s.bytes.length; i++) bytes.set((s.addr + i) >>> 0, s.bytes[i]);
    const rd = (a: number, n: number) => { let v = 0; for (let i = n - 1; i >= 0; i--) v = (v << 8) | (bytes.get((a + i) >>> 0) ?? 0); return v >>> 0; };
    let pc = range.start;
    while (pc < range.end) {
      const half = rd(pc, 2);
      const d = decodeAt(half, (half & 3) === 3 ? rd(pc, 4) : half);
      const asm = disassemble(d, pc, (a) => byAddr.get(a));
      text.push({ addr: pc, word: d.word, size: d.size, raw: d.size === 2 ? half : d.word, line: null, source: asm, text: asm });
      pc += d.size;
    }
  }
  return {
    kind: 'elf',
    entry: img.entry,
    text,
    segments: img.segments.map((s) => ({ addr: s.addr, bytes: s.bytes })),
    labels,
    errors: [],
    lineToAddr: new Map(),
    addrToLine: new Map(),
    textStart: range?.start ?? img.entry,
    textEnd: range?.end ?? img.entry,
  };
}
