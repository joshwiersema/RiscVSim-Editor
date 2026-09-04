import { useMemo, useState } from 'react';
import { DATA_BASE, STACK_TOP, TEXT_BASE } from '@/core/asm/assembler';
import { PSEUDO_NAMES } from '@/core/asm/pseudo';
import { COMPRESSED_NAMES } from '@/core/isa/compressed';
import { INSTRUCTIONS, type InstrDef } from '@/core/isa/instructions';
import { ABI_NAMES, REGISTER_ROLES } from '@/core/isa/registers';
import { CHAR_OUT_BASE, CYCLES_BASE, DPAD_BASE, IO_BASE, LED_BASE, SWITCH_BASE } from '@/core/io/devices';
import { SYSCALL_TABLE } from '@/core/sim/ecall';
import { classify, INSTR_CLASSES } from '@/core/sim/stats';
import { hex32 } from '@/core/util/format';
import { Icon } from '../components/Icons';

type Section = 'isa' | 'regs' | 'sys' | 'asm';

const DIRECTIVES: readonly [string, string][] = [
  ['.text / .data', 'Switch to the code or data section'],
  ['.word / .half / .byte', '32-, 16-, or 8-bit values (comma separated)'],
  ['.ascii / .asciz / .string', 'Text without / with a terminating NUL'],
  ['.space n / .zero n', 'Reserve n zero bytes'],
  ['.align n / .balign n', 'Align to 2^n bytes / to n bytes'],
  ['.equ name, value', 'Define a constant'],
  ['.globl name', 'Accepted for compatibility'],
];

/** Searchable ISA, register, syscall, and assembler reference for students. */
export function ReferencePanel() {
  const [section, setSection] = useState<Section>('isa');
  const [query, setQuery] = useState('');
  return (
    <div className="reference">
      <div className="reference-bar">
        <div className="segmented">
          <button className={section === 'isa' ? 'is-on' : ''} onClick={() => setSection('isa')}>Instructions</button>
          <button className={section === 'regs' ? 'is-on' : ''} onClick={() => setSection('regs')}>Registers</button>
          <button className={section === 'sys' ? 'is-on' : ''} onClick={() => setSection('sys')}>Syscalls & I/O</button>
          <button className={section === 'asm' ? 'is-on' : ''} onClick={() => setSection('asm')}>Assembler</button>
        </div>
        {section === 'isa' && (
          <label className="search">
            <Icon name="search" size={14} />
            <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="filter, e.g. branch or lw" />
          </label>
        )}
      </div>
      <div className="panel-scroll reference-body">
        {section === 'isa' && <Instructions query={query} />}
        {section === 'regs' && <Registers />}
        {section === 'sys' && <Syscalls />}
        {section === 'asm' && <Assembler />}
      </div>
    </div>
  );
}

function Instructions({ query }: { query: string }) {
  const q = query.trim().toLowerCase();
  const groups = useMemo(() => {
    const by = new Map<string, InstrDef[]>();
    for (const d of INSTRUCTIONS) {
      const cls = classify(d);
      const label = INSTR_CLASSES.find((c) => c.id === cls)?.label ?? cls;
      if (q && !(d.name.includes(q) || d.summary.toLowerCase().includes(q) || label.toLowerCase().includes(q) || d.format.toLowerCase() === q)) continue;
      by.set(label, [...(by.get(label) ?? []), d]);
    }
    return [...by.entries()];
  }, [q]);
  if (!groups.length) return <div className="panel-empty">No instruction matches “{query}”.</div>;
  return (
    <>
      {groups.map(([label, defs]) => (
        <section key={label} className="ref-group">
          <div className="section-title"><span>{label}</span></div>
          <table className="table ref-table">
            <tbody>
              {defs.map((d) => (
                <tr key={d.name}>
                  <td className="mono ref-name">{d.name}</td>
                  <td className="mono muted ref-syntax">{d.syntax}</td>
                  <td>{d.summary}</td>
                  <td><span className="fmt-tag">{d.format}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </>
  );
}

function Registers() {
  const saver = (i: number) => (i === 0 ? '—' : i === 1 || (i >= 5 && i <= 7) || (i >= 10 && i <= 17) || i >= 28 ? 'caller' : 'callee');
  return (
    <table className="table ref-table">
      <thead><tr><th>reg</th><th>abi</th><th>role</th><th>saved by</th></tr></thead>
      <tbody>
        {ABI_NAMES.map((n, i) => (
          <tr key={n}><td className="mono">x{i}</td><td className="mono ref-name">{n}{i === 8 ? ' / fp' : ''}</td><td>{REGISTER_ROLES[i]}</td><td className="muted">{saver(i)}</td></tr>
        ))}
      </tbody>
    </table>
  );
}

function Syscalls() {
  return (
    <>
      <section className="ref-group">
        <div className="section-title"><span>Syscalls: set a7, then <code>ecall</code></span></div>
        <table className="table ref-table">
          <tbody>{SYSCALL_TABLE.map((s) => <tr key={s.code}><td className="mono ref-name">{s.code}</td><td>{s.name}</td><td className="muted">{s.args || '—'}</td></tr>)}</tbody>
        </table>
      </section>
      <section className="ref-group">
        <div className="section-title"><span>Memory map</span></div>
        <table className="table ref-table">
          <tbody>
            <tr><td className="mono ref-name">{hex32(TEXT_BASE)}</td><td>.text — program code, entry at <code>main</code> or the first instruction</td></tr>
            <tr><td className="mono ref-name">{hex32(DATA_BASE)}</td><td>.data — initialised data; <code>gp</code> points 0x800 past it</td></tr>
            <tr><td className="mono ref-name">{hex32(STACK_TOP)}</td><td>initial <code>sp</code>; the stack grows downward</td></tr>
            <tr><td className="mono ref-name">{hex32(IO_BASE)}</td><td>memory-mapped devices (below)</td></tr>
          </tbody>
        </table>
      </section>
      <section className="ref-group">
        <div className="section-title"><span>Devices</span></div>
        <table className="table ref-table">
          <tbody>
            <tr><td className="mono ref-name">{hex32(LED_BASE)}</td><td>LED matrix: 16×16 words of 0x00RRGGBB, row-major; <code>sw</code> a colour to light one</td></tr>
            <tr><td className="mono ref-name">{hex32(SWITCH_BASE)}</td><td>switches: bit i = switch i (read-only)</td></tr>
            <tr><td className="mono ref-name">{hex32(DPAD_BASE)}</td><td>d-pad: up=1 down=2 left=4 right=8 centre=16 (read-only)</td></tr>
            <tr><td className="mono ref-name">{hex32(CHAR_OUT_BASE)}</td><td>character output: <code>sb</code> a byte to print it</td></tr>
            <tr><td className="mono ref-name">{hex32(CYCLES_BASE)}</td><td>cycle counter (read-only)</td></tr>
          </tbody>
        </table>
      </section>
    </>
  );
}

function Assembler() {
  return (
    <>
      <section className="ref-group">
        <div className="section-title"><span>Directives</span></div>
        <table className="table ref-table">
          <tbody>{DIRECTIVES.map(([d, what]) => <tr key={d}><td className="mono ref-name">{d}</td><td>{what}</td></tr>)}</tbody>
        </table>
      </section>
      <section className="ref-group">
        <div className="section-title"><span>Pseudo-instructions</span></div>
        <p className="mono ref-chips">{PSEUDO_NAMES.map((n) => <span key={n}>{n}</span>)}</p>
      </section>
      <section className="ref-group">
        <div className="section-title"><span>RV32C mnemonics</span></div>
        <p className="mono ref-chips">{COMPRESSED_NAMES.map((n) => <span key={n}>{n}</span>)}</p>
        <p className="muted">Tick <em>auto-compress</em> in the toolbar to let the assembler pick 16-bit encodings wherever possible.</p>
      </section>
    </>
  );
}
