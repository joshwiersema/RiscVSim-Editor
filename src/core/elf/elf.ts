/**
 * Minimal ELF32 little-endian loader for RISC-V executables produced by
 * riscv*-elf-gcc. Loads PT_LOAD segments, reads the entry point, and
 * harvests function/object symbols as labels.
 */
export interface ElfSegment {
  readonly addr: number;
  readonly bytes: Uint8Array;
  readonly executable: boolean;
}

export interface ElfImage {
  readonly entry: number;
  readonly segments: readonly ElfSegment[];
  readonly symbols: ReadonlyMap<string, number>;
  /** [start, end) of executable code, or null if none. */
  readonly textRange: { readonly start: number; readonly end: number } | null;
}

export class ElfError extends Error {}

const EM_RISCV = 0xf3;
const PT_LOAD = 1;
const PF_X = 1;
const SHT_SYMTAB = 2;

export function parseElf(data: Uint8Array): ElfImage {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data.length < 52 || dv.getUint32(0, false) !== 0x7f454c46) throw new ElfError('not an ELF file');
  if (data[4] !== 1) throw new ElfError('only 32-bit ELF files are supported (compile with -march=rv32… -mabi=ilp32)');
  if (data[5] !== 1) throw new ElfError('only little-endian ELF files are supported');
  const machine = dv.getUint16(18, true);
  if (machine !== EM_RISCV) throw new ElfError(`not a RISC-V executable (e_machine = ${machine})`);
  const entry = dv.getUint32(24, true);
  const phoff = dv.getUint32(28, true);
  const shoff = dv.getUint32(32, true);
  const phentsize = dv.getUint16(42, true);
  const phnum = dv.getUint16(44, true);
  const shentsize = dv.getUint16(46, true);
  const shnum = dv.getUint16(48, true);

  const segments: ElfSegment[] = [];
  let text: { start: number; end: number } | null = null;
  for (let i = 0; i < phnum; i++) {
    const off = phoff + i * phentsize;
    if (off + 32 > data.length) throw new ElfError('truncated program header');
    const type = dv.getUint32(off, true);
    if (type !== PT_LOAD) continue;
    const p_offset = dv.getUint32(off + 4, true);
    const p_vaddr = dv.getUint32(off + 8, true);
    const p_filesz = dv.getUint32(off + 16, true);
    const p_memsz = dv.getUint32(off + 20, true);
    const p_flags = dv.getUint32(off + 24, true);
    if (p_offset + p_filesz > data.length) throw new ElfError('segment extends past end of file');
    const bytes = new Uint8Array(p_memsz);
    bytes.set(data.subarray(p_offset, p_offset + p_filesz));
    const executable = (p_flags & PF_X) !== 0;
    segments.push({ addr: p_vaddr >>> 0, bytes, executable });
    if (executable && p_filesz > 0) {
      const start = p_vaddr >>> 0, end = (p_vaddr + p_filesz) >>> 0;
      text = text ? { start: Math.min(text.start, start), end: Math.max(text.end, end) } : { start, end };
    }
  }

  const symbols = new Map<string, number>();
  if (shoff && shnum) {
    const sections: { type: number; offset: number; size: number; link: number; entsize: number }[] = [];
    for (let i = 0; i < shnum; i++) {
      const off = shoff + i * shentsize;
      if (off + 40 > data.length) break;
      sections.push({ type: dv.getUint32(off + 4, true), offset: dv.getUint32(off + 16, true), size: dv.getUint32(off + 20, true), link: dv.getUint32(off + 24, true), entsize: dv.getUint32(off + 36, true) });
    }
    for (const s of sections) {
      if (s.type !== SHT_SYMTAB || !s.entsize) continue;
      const strtab = sections[s.link];
      if (!strtab) continue;
      const count = Math.floor(s.size / s.entsize);
      for (let i = 0; i < count; i++) {
        const off = s.offset + i * s.entsize;
        if (off + 16 > data.length) break;
        const nameOff = dv.getUint32(off, true);
        const value = dv.getUint32(off + 4, true);
        const info = data[off + 12];
        const type = info & 0xf; // 1 = OBJECT, 2 = FUNC, 0 = NOTYPE
        const shndx = dv.getUint16(off + 14, true);
        if (shndx === 0 || (type !== 1 && type !== 2 && type !== 0)) continue;
        const name = readCString(data, strtab.offset + nameOff);
        if (!name || name.startsWith('$') || name.startsWith('.L')) continue;
        if (!symbols.has(name)) symbols.set(name, value >>> 0);
      }
    }
  }
  return { entry: entry >>> 0, segments, symbols, textRange: text };
}

function readCString(data: Uint8Array, off: number): string {
  let s = '';
  for (let i = off; i < data.length && data[i] !== 0; i++) s += String.fromCharCode(data[i]);
  return s;
}
