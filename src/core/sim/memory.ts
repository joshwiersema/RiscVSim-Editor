/**
 * Sparse little-endian byte memory backed by fixed-size pages, with
 * memory-mapped device windows. Mutable for speed; exposes snapshot/restore
 * for reversible simulation.
 */
import type { Device } from '../io/devices';

const PAGE_BITS = 12;
const PAGE_SIZE = 1 << PAGE_BITS;
const PAGE_MASK = PAGE_SIZE - 1;

export interface MemoryAccess {
  readonly addr: number;
  readonly width: 1 | 2 | 4;
  readonly kind: 'read' | 'write';
  readonly value: number;
}

export class Memory {
  private pages = new Map<number, Uint8Array>();
  private devices: Device[] = [];

  /** Route accesses in [base, base+size) to a device. */
  mapDevice(device: Device): void {
    this.devices.push(device);
  }

  deviceAt(addr: number): Device | null {
    const a = addr >>> 0;
    for (const d of this.devices) if (a >= d.base && a < d.base + d.size) return d;
    return null;
  }

  private page(addr: number, create: boolean): Uint8Array | undefined {
    const key = addr >>> PAGE_BITS;
    let p = this.pages.get(key);
    if (!p && create) {
      p = new Uint8Array(PAGE_SIZE);
      this.pages.set(key, p);
    }
    return p;
  }

  readByte(addr: number): number {
    const a = addr >>> 0;
    if (a >= 0xf0000000) { const d = this.deviceAt(a); if (d) return d.readByte(a - d.base); }
    const p = this.page(a, false);
    return p ? p[a & PAGE_MASK] : 0;
  }

  writeByte(addr: number, value: number): void {
    const a = addr >>> 0;
    if (a >= 0xf0000000) { const d = this.deviceAt(a); if (d) { d.writeByte(a - d.base, value & 0xff); return; } }
    const p = this.page(a, true)!;
    p[a & PAGE_MASK] = value & 0xff;
  }

  read(addr: number, width: 1 | 2 | 4): number {
    let v = 0;
    for (let i = width - 1; i >= 0; i--) v = (v << 8) | this.readByte(addr + i);
    return v >>> 0;
  }

  write(addr: number, width: 1 | 2 | 4, value: number): void {
    for (let i = 0; i < width; i++) this.writeByte(addr + i, value >>> (8 * i));
  }

  readWord(addr: number): number { return this.read(addr, 4); }
  readHalf(addr: number): number { return this.read(addr, 2); }
  writeWord(addr: number, value: number): void { this.write(addr, 4, value); }

  /** Addresses of all touched pages, ascending. */
  touchedPages(): number[] {
    return [...this.pages.keys()].sort((a, b) => a - b).map((k) => k << PAGE_BITS);
  }

  snapshot(): Map<number, Uint8Array> {
    const copy = new Map<number, Uint8Array>();
    for (const [k, p] of this.pages) copy.set(k, new Uint8Array(p));
    return copy;
  }

  restore(snap: Map<number, Uint8Array>): void {
    this.pages = new Map();
    for (const [k, p] of snap) this.pages.set(k, new Uint8Array(p));
  }

  clear(): void { this.pages.clear(); }
}

export const PAGE_SIZE_BYTES = PAGE_SIZE;
