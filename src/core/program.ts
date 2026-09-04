/**
 * A loaded program: the memory image to install plus a listing of the
 * instructions in it. Produced by the assembler or the ELF loader.
 */
export interface AsmError {
  readonly line: number;
  readonly message: string;
}

export interface TextWord {
  readonly addr: number;
  /** The 32-bit (expanded) instruction word. */
  readonly word: number;
  /** Encoded size in bytes: 2 for RV32C, 4 otherwise. */
  readonly size: 2 | 4;
  /** The bits actually stored in memory (16 or 32 of them). */
  readonly raw: number;
  /** 1-based source line, or null when there is no source (ELF). */
  readonly line: number | null;
  /** Original source text of the line (trimmed), or the disassembly for ELF. */
  readonly source: string;
  /** Canonical text of the real instruction (post-expansion). */
  readonly text: string;
}

export interface Segment {
  readonly addr: number;
  readonly bytes: Uint8Array;
}

export interface Program {
  readonly kind: 'asm' | 'elf';
  readonly entry: number;
  /** Instruction listing, ascending by address. */
  readonly text: readonly TextWord[];
  /** Everything to load into memory, including code. */
  readonly segments: readonly Segment[];
  readonly labels: ReadonlyMap<string, number>;
  readonly errors: readonly AsmError[];
  readonly lineToAddr: ReadonlyMap<number, number>;
  readonly addrToLine: ReadonlyMap<number, number>;
  /** [textStart, textEnd) covers all instructions. */
  readonly textStart: number;
  readonly textEnd: number;
}

export const EMPTY_PROGRAM: Program = {
  kind: 'asm', entry: 0, text: [], segments: [], labels: new Map(), errors: [], lineToAddr: new Map(), addrToLine: new Map(), textStart: 0, textEnd: 0,
};
