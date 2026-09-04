export function hex32(v: number): string {
  return '0x' + (v >>> 0).toString(16).padStart(8, '0');
}
export function hex(v: number, digits = 0): string {
  return '0x' + (v >>> 0).toString(16).padStart(digits, '0');
}
export function signed(v: number): number {
  return v | 0;
}
export function unsigned(v: number): number {
  return v >>> 0;
}
export function bin(v: number, width: number): string {
  return (v >>> 0).toString(2).padStart(width, '0').slice(-width);
}
export type NumberBase = 'hex' | 'dec' | 'udec' | 'bin';
export function formatValue(v: number, base: NumberBase): string {
  switch (base) {
    case 'hex': return hex32(v);
    case 'dec': return String(v | 0);
    case 'udec': return String(v >>> 0);
    case 'bin': return '0b' + bin(v, 32);
  }
}
