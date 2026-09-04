/** RISC-V integer register ABI names, indexed by register number. */
export const ABI_NAMES: readonly string[] = [
  'zero', 'ra', 'sp', 'gp', 'tp', 't0', 't1', 't2',
  's0', 's1', 'a0', 'a1', 'a2', 'a3', 'a4', 'a5',
  'a6', 'a7', 's2', 's3', 's4', 's5', 's6', 's7',
  's8', 's9', 's10', 's11', 't3', 't4', 't5', 't6',
];

/** Human descriptions of each register's conventional role. */
export const REGISTER_ROLES: readonly string[] = [
  'Hard-wired zero. Writes are ignored.',
  'Return address, written by jal/jalr.',
  'Stack pointer.',
  'Global pointer.',
  'Thread pointer.',
  'Temporary (caller-saved).', 'Temporary (caller-saved).', 'Temporary (caller-saved).',
  'Saved register / frame pointer (callee-saved).', 'Saved register (callee-saved).',
  'Function argument 0 / return value 0.', 'Function argument 1 / return value 1.',
  'Function argument 2.', 'Function argument 3.', 'Function argument 4.', 'Function argument 5.',
  'Function argument 6.', 'Function argument 7.',
  'Saved register (callee-saved).', 'Saved register (callee-saved).', 'Saved register (callee-saved).',
  'Saved register (callee-saved).', 'Saved register (callee-saved).', 'Saved register (callee-saved).',
  'Saved register (callee-saved).', 'Saved register (callee-saved).', 'Saved register (callee-saved).',
  'Saved register (callee-saved).',
  'Temporary (caller-saved).', 'Temporary (caller-saved).', 'Temporary (caller-saved).', 'Temporary (caller-saved).',
];

const ALIASES: Record<string, number> = { fp: 8, s0: 8 };

/** Resolve a register token (x5, t0, fp, ...) to its index, or null if invalid. */
export function parseRegister(token: string): number | null {
  const t = token.toLowerCase();
  if (t in ALIASES) return ALIASES[t];
  const abi = ABI_NAMES.indexOf(t);
  if (abi >= 0) return abi;
  const m = /^x(\d{1,2})$/.exec(t);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 0 && n < 32 ? n : null;
}

export function regName(index: number): string {
  return ABI_NAMES[index] ?? `x${index}`;
}
