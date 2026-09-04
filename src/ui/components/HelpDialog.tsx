import { SYSCALL_TABLE } from '@/core/sim/ecall';
import { PSEUDO_NAMES } from '@/core/asm/pseudo';
import { COMPRESSED_NAMES } from '@/core/isa/compressed';
import { CHAR_OUT_BASE, CYCLES_BASE, DPAD_BASE, LED_BASE, SWITCH_BASE } from '@/core/io/devices';
import { hex32 } from '@/core/util/format';

interface HelpDialogProps {
  readonly onClose: () => void;
}

const SHORTCUTS: readonly [string, string][] = [
  ['N · F10', 'Step one clock cycle'],
  ['M · F11', 'Walk: reveal the current cycle one stage at a time'],
  ['B · F9', 'Step back one cycle'],
  ['Space · F5', 'Play / pause'],
  ['R', 'Reset the simulation'],
  ['Ctrl+Enter', 'Assemble (or compile C)'],
  ['Ctrl+O / Ctrl+S', 'Open / save the source file'],
  ['Ctrl+wheel', 'Zoom the datapath (drag to pan)'],
  ['Esc', 'Unpin explanation / pause'],
];

export function HelpDialog({ onClose }: HelpDialogProps) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Help">
        <div className="modal-head">
          <strong>How to use RiscSim</strong>
          <button className="btn btn-ghost btn-xs" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <section>
            <h4>The idea</h4>
            <p>Every wire, mux, and block in the datapath knows <em>why</em> it is active for the instruction flowing through it. Hover to read the explanation; click to pin it in the Inspector. Use <b>Walk</b> to reveal a cycle one stage at a time when a full clock step is too much at once.</p>
          </section>
          <section>
            <h4>Keyboard</h4>
            <table className="table">
              <tbody>{SHORTCUTS.map(([k, d]) => <tr key={k}><td><kbd>{k}</kbd></td><td>{d}</td></tr>)}</tbody>
            </table>
          </section>
          <section>
            <h4>Processors</h4>
            <p><b>Single-cycle</b>: one instruction per clock. <b>Pipeline</b>: five stages (IF, ID, EX, MEM, WB) with EX/MEM and MEM/WB forwarding, a load-use hazard unit, and branches resolved in EX (two instructions flushed when taken). Untick <em>forwarding</em> or the <em>hazard unit</em> to see what breaks. An <code>ecall</code> that needs input behaves like a precise trap: younger instructions are squashed.</p>
            <h4>Caches</h4>
            <p>The Cache tab models the L1 instruction and data caches: sets, ways, block size, LRU / FIFO / random replacement, write-back or write-through, and write-allocate. Every fetch and load/store updates them; the address split shows tag / index / offset for the last access.</p>
            <h4>RV32C</h4>
            <p>Write <code>c.*</code> mnemonics directly, or tick <em>auto-compress</em> to let the assembler pick 16-bit encodings wherever possible. The decompressor block in IF expands them and the PC increment mux picks +2 instead of +4.</p>
          </section>
          <section>
            <h4>Syscalls (a7, then <code>ecall</code>)</h4>
            <table className="table">
              <tbody>{SYSCALL_TABLE.map((s) => <tr key={s.code}><td className="mono">{s.code}</td><td>{s.name}</td><td className="muted">{s.args}</td></tr>)}</tbody>
            </table>
            <h4>Memory-mapped I/O</h4>
            <table className="table">
              <tbody>
                <tr><td className="mono">{hex32(LED_BASE)}</td><td>LED matrix, 16×16 words of 0x00RRGGBB (row-major)</td></tr>
                <tr><td className="mono">{hex32(SWITCH_BASE)}</td><td>switches, bit i = switch i (read-only)</td></tr>
                <tr><td className="mono">{hex32(DPAD_BASE)}</td><td>d-pad: up=1 down=2 left=4 right=8 centre=16 (read-only)</td></tr>
                <tr><td className="mono">{hex32(CHAR_OUT_BASE)}</td><td>character output (write a byte)</td></tr>
                <tr><td className="mono">{hex32(CYCLES_BASE)}</td><td>cycle counter (read-only)</td></tr>
              </tbody>
            </table>
          </section>
          <section>
            <h4>Assembler</h4>
            <p className="mono muted">{PSEUDO_NAMES.join(' · ')}</p>
            <p className="mono muted">{COMPRESSED_NAMES.join(' · ')}</p>
            <p className="muted">Directives: .text .data .section .word .half .byte .ascii .asciz .string .space .zero .align .balign .equ .globl. Memory: .text at 0x0, .data at 0x10000000, sp = 0x7ffffff0, I/O at 0xF0000000.</p>
            <h4>C programs</h4>
            <p className="muted">Switch the editor to C, write a program that includes <code>riscsim.h</code>, and press Compile. RiscSim runs your installed RISC-V GCC (configure it under File › Settings), links with its own start-up file and memory map, and loads the ELF. File › Load ELF opens any rv32 ELF built elsewhere.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
