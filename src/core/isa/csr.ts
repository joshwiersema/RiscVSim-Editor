/** Control and status registers the simulator implements (Zicsr subset). */
export const CSR = {
  FFLAGS: 0x001, FRM: 0x002, FCSR: 0x003,
  CYCLE: 0xc00, TIME: 0xc01, INSTRET: 0xc02,
  CYCLEH: 0xc80, TIMEH: 0xc81, INSTRETH: 0xc82,
} as const;

export const CSR_NAMES: ReadonlyMap<number, string> = new Map([
  [CSR.FFLAGS, 'fflags'], [CSR.FRM, 'frm'], [CSR.FCSR, 'fcsr'],
  [CSR.CYCLE, 'cycle'], [CSR.TIME, 'time'], [CSR.INSTRET, 'instret'],
  [CSR.CYCLEH, 'cycleh'], [CSR.TIMEH, 'timeh'], [CSR.INSTRETH, 'instreth'],
]);

const BY_NAME: ReadonlyMap<string, number> = new Map([...CSR_NAMES].map(([n, s]) => [s, n]));

export const CSR_DESCRIPTIONS: ReadonlyMap<number, string> = new Map([
  [CSR.FFLAGS, 'Accrued FP exception flags (NV DZ OF UF NX)'],
  [CSR.FRM, 'Dynamic FP rounding mode'],
  [CSR.FCSR, 'FP control/status: frm in bits 7:5, fflags in bits 4:0'],
  [CSR.CYCLE, 'Clock cycles since reset (low 32 bits, read-only)'],
  [CSR.TIME, 'Timer; equal to cycle in the simulator (read-only)'],
  [CSR.INSTRET, 'Instructions retired (low 32 bits, read-only)'],
  [CSR.CYCLEH, 'Upper 32 bits of cycle (read-only)'],
  [CSR.TIMEH, 'Upper 32 bits of time (read-only)'],
  [CSR.INSTRETH, 'Upper 32 bits of instret (read-only)'],
]);

export function csrNumber(name: string): number | undefined {
  return BY_NAME.get(name.toLowerCase());
}

export function csrName(addr: number): string {
  return CSR_NAMES.get(addr & 0xfff) ?? `0x${(addr & 0xfff).toString(16)}`;
}

/** CSRs whose top two address bits are 11 are read-only by convention. */
export function csrReadOnly(addr: number): boolean {
  return ((addr >>> 10) & 3) === 3;
}
