/**
 * Memory-mapped I/O devices. Each device owns a window of the address space;
 * the Memory routes reads and writes inside that window to the device.
 */
export interface Device {
  readonly name: string;
  readonly base: number;
  readonly size: number;
  readonly description: string;
  readByte(offset: number): number;
  writeByte(offset: number, value: number): void;
  snapshot(): unknown;
  restore(s: unknown): void;
}

export const IO_BASE = 0xf0000000;

/** LED matrix: one 32-bit word (0x00RRGGBB) per LED, row-major. */
export class LedMatrix implements Device {
  readonly name = 'LED matrix';
  readonly size: number;
  pixels: Uint32Array;
  constructor(readonly base: number, readonly width: number, readonly height: number) {
    this.size = width * height * 4;
    this.pixels = new Uint32Array(width * height);
  }
  get description(): string { return `${this.width}×${this.height} LEDs, one word per LED (0x00RRGGBB), row-major from the top-left.`; }
  readByte(offset: number): number {
    const px = this.pixels[offset >>> 2] ?? 0;
    return (px >>> (8 * (offset & 3))) & 0xff;
  }
  writeByte(offset: number, value: number): void {
    const i = offset >>> 2;
    if (i >= this.pixels.length) return;
    const shift = 8 * (offset & 3);
    this.pixels[i] = ((this.pixels[i] & ~(0xff << shift)) | ((value & 0xff) << shift)) >>> 0;
  }
  snapshot(): unknown { return new Uint32Array(this.pixels); }
  restore(s: unknown): void { this.pixels = new Uint32Array(s as Uint32Array); }
}

/** Read-only word whose bits reflect UI-controlled switches or buttons. */
export class InputWord implements Device {
  readonly size = 4;
  value = 0;
  constructor(readonly name: string, readonly base: number, readonly bitNames: readonly string[], readonly description: string) {}
  readByte(offset: number): number { return (this.value >>> (8 * (offset & 3))) & 0xff; }
  writeByte(): void { /* read-only */ }
  snapshot(): unknown { return this.value; }
  restore(s: unknown): void { this.value = s as number; }
}

/** Character output: writing a byte appends it to the program's console. */
export class CharOutput implements Device {
  readonly name = 'Character output';
  readonly size = 4;
  readonly description = 'Write a byte (or a word whose low byte is the character) to print it to the console.';
  onChar: ((c: string) => void) | null = null;
  constructor(readonly base: number) {}
  readByte(): number { return 0; }
  writeByte(offset: number, value: number): void {
    if (offset === 0) this.onChar?.(String.fromCharCode(value & 0xff));
  }
  snapshot(): unknown { return null; }
  restore(): void { /* stateless */ }
}

/** Read-only cycle counter (low 32 bits). */
export class CycleCounter implements Device {
  readonly name = 'Cycle counter';
  readonly size = 4;
  readonly description = 'Read-only: the number of clock cycles elapsed since reset.';
  cycles = 0;
  constructor(readonly base: number) {}
  readByte(offset: number): number { return (this.cycles >>> (8 * (offset & 3))) & 0xff; }
  writeByte(): void { /* read-only */ }
  snapshot(): unknown { return this.cycles; }
  restore(s: unknown): void { this.cycles = s as number; }
}

/** The standard device set, with fixed addresses documented in the Help. */
export interface DeviceSet {
  readonly leds: LedMatrix;
  readonly switches: InputWord;
  readonly dpad: InputWord;
  readonly charOut: CharOutput;
  readonly cycles: CycleCounter;
  readonly all: readonly Device[];
}

export const LED_BASE = IO_BASE;
export const SWITCH_BASE = IO_BASE + 0x1000;
export const DPAD_BASE = IO_BASE + 0x1004;
export const CHAR_OUT_BASE = IO_BASE + 0x2000;
export const CYCLES_BASE = IO_BASE + 0x3000;

export function createDevices(ledWidth = 16, ledHeight = 16): DeviceSet {
  const leds = new LedMatrix(LED_BASE, ledWidth, ledHeight);
  const switches = new InputWord('Switches', SWITCH_BASE, Array.from({ length: 8 }, (_, i) => `SW${i}`), 'Read-only word: bit i is 1 while switch i is on.');
  const dpad = new InputWord('D-pad', DPAD_BASE, ['UP', 'DOWN', 'LEFT', 'RIGHT', 'CENTER'], 'Read-only word: bit 0 up, 1 down, 2 left, 3 right, 4 centre. A bit is 1 while the button is held.');
  const charOut = new CharOutput(CHAR_OUT_BASE);
  const cycles = new CycleCounter(CYCLES_BASE);
  return { leds, switches, dpad, charOut, cycles, all: [leds, switches, dpad, charOut, cycles] };
}
