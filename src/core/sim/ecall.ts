import type { Memory } from './memory';

export type InputKind = 'int' | 'string' | 'char';

export interface EcallResult {
  readonly code: number;
  readonly output: string;
  readonly exit: boolean;
  readonly exitCode: number;
  readonly description: string;
  /** Set when the program must wait for console input. */
  readonly input: { readonly kind: InputKind; readonly addr: number; readonly maxLen: number } | null;
}

function readCString(mem: Memory, addr: number, limit = 4096): string {
  let s = '';
  for (let i = 0; i < limit; i++) {
    const b = mem.readByte(addr + i);
    if (b === 0) break;
    s += String.fromCharCode(b);
  }
  return s;
}

/** Ripes-compatible syscall numbers (a7). */
export function performEcall(regs: readonly number[], mem: Memory): EcallResult {
  const a7 = regs[17], a0 = regs[10], a1 = regs[11];
  const base = { code: a7, output: '', exit: false, exitCode: 0, input: null };
  switch (a7) {
    case 1: return { ...base, output: String(a0 | 0), description: `print_int: prints a0 = ${a0 | 0}` };
    case 4: { const s = readCString(mem, a0); return { ...base, output: s, description: `print_string: prints the NUL-terminated string at a0 = 0x${(a0 >>> 0).toString(16)}` }; }
    case 5: return { ...base, input: { kind: 'int', addr: 0, maxLen: 0 }, description: 'read_int: waits for an integer typed into the console, then stores it in a0' };
    case 8: return { ...base, input: { kind: 'string', addr: a0 >>> 0, maxLen: a1 | 0 }, description: `read_string: waits for a line of input and stores up to a1 = ${a1 | 0} bytes at a0 = 0x${(a0 >>> 0).toString(16)}` };
    case 10: return { ...base, exit: true, description: 'exit: halts the program' };
    case 11: return { ...base, output: String.fromCharCode(a0 & 0xff), description: `print_char: prints a0 as ASCII '${String.fromCharCode(a0 & 0xff)}'` };
    case 12: return { ...base, input: { kind: 'char', addr: 0, maxLen: 0 }, description: 'read_char: waits for one character typed into the console, then stores it in a0' };
    case 17: return { ...base, exit: true, exitCode: a0 | 0, description: `exit2: halts with exit code a0 = ${a0 | 0}` };
    case 34: return { ...base, output: '0x' + (a0 >>> 0).toString(16), description: 'print_hex: prints a0 in hexadecimal' };
    case 35: return { ...base, output: '0b' + (a0 >>> 0).toString(2), description: 'print_bin: prints a0 in binary' };
    case 36: return { ...base, output: String(a0 >>> 0), description: `print_unsigned: prints a0 = ${a0 >>> 0}` };
    default: return { ...base, output: `[unknown syscall a7=${a7}]\n`, description: `unknown syscall number ${a7} in a7` };
  }
}

export const SYSCALL_TABLE: readonly { code: number; name: string; args: string }[] = [
  { code: 1, name: 'print_int', args: 'a0 = integer' },
  { code: 4, name: 'print_string', args: 'a0 = address of NUL-terminated string' },
  { code: 5, name: 'read_int', args: 'result in a0' },
  { code: 8, name: 'read_string', args: 'a0 = buffer, a1 = max length' },
  { code: 10, name: 'exit', args: '' },
  { code: 11, name: 'print_char', args: 'a0 = character' },
  { code: 12, name: 'read_char', args: 'result in a0' },
  { code: 17, name: 'exit2', args: 'a0 = exit code' },
  { code: 34, name: 'print_hex', args: 'a0 = value' },
  { code: 35, name: 'print_bin', args: 'a0 = value' },
  { code: 36, name: 'print_unsigned', args: 'a0 = value' },
];
