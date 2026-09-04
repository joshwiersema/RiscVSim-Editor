import { useMemo, useState } from 'react';
import { DATA_BASE, STACK_TOP, TEXT_BASE } from '@/core/asm/assembler';
import { hex32 } from '@/core/util/format';
import { useStore } from '../state/store';

const ROWS = 24;
const ROW_BYTES = 16;

export function MemoryPanel() {
  const machine = useStore((s) => s.machine);
  const program = useStore((s) => s.program);
  const tick = useStore((s) => s.tick);
  const trace = useStore((s) => s.trace);
  const [start, setStart] = useState(DATA_BASE);
  const [input, setInput] = useState('0x10000000');

  const labelsByAddr = useMemo(() => {
    const m = new Map<number, string>();
    if (program) for (const [name, addr] of program.labels) m.set(addr, name);
    return m;
  }, [program]);

  const written = useMemo(() => {
    const set = new Set<number>();
    for (const w of trace?.memWrites ?? []) for (let i = 0; i < w.width; i++) set.add((w.addr + i) >>> 0);
    return set;
  }, [trace]);
  const read = useMemo(() => {
    const set = new Set<number>();
    const t = trace?.stages.MEM.trace;
    if (t?.ctrl.memRead) { const n = t.ctrl.memRead.startsWith('B') ? 1 : t.ctrl.memRead.startsWith('H') ? 2 : 4; for (let i = 0; i < n; i++) set.add((t.memAddr + i) >>> 0); }
    return set;
  }, [trace]);

  const rows = useMemo(() => {
    const out: { addr: number; bytes: number[] }[] = [];
    for (let r = 0; r < ROWS; r++) {
      const addr = (start + r * ROW_BYTES) >>> 0;
      const bytes: number[] = [];
      for (let i = 0; i < ROW_BYTES; i++) bytes.push(machine ? machine.core.mem.readByte(addr + i) : 0);
      out.push({ addr, bytes });
    }
    return out;
  }, [machine, start, tick]);

  const go = (addr: number) => { const a = (addr & ~0xf) >>> 0; setStart(a); setInput(hex32(a)); };
  const submit = () => { const v = Number.parseInt(input, 16); if (!Number.isNaN(v)) go(v); };

  return (
    <div className="memory">
      <div className="memory-bar">
        <input className="input mono" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
        <button className="btn btn-xs" onClick={submit}>Go</button>
        <div className="segmented">
          <button onClick={() => go(TEXT_BASE)}>.text</button>
          <button onClick={() => go(DATA_BASE)}>.data</button>
          <button onClick={() => go(STACK_TOP - ROWS * ROW_BYTES + 16)}>stack</button>
          {machine && trace?.stages.MEM.trace && (trace.stages.MEM.trace.ctrl.memRead || trace.stages.MEM.trace.ctrl.memWrite) && (
            <button onClick={() => go(trace.stages.MEM.trace!.memAddr)}>last access</button>
          )}
        </div>
        <div className="memory-nav">
          <button className="btn btn-ghost btn-xs" onClick={() => go(start - ROWS * ROW_BYTES)}>▲</button>
          <button className="btn btn-ghost btn-xs" onClick={() => go(start + ROWS * ROW_BYTES)}>▼</button>
        </div>
      </div>
      <div className="panel-scroll">
        <table className="table memory-table mono">
          <tbody>
            {rows.map((r) => (
              <tr key={r.addr}>
                <td className="mem-addr">
                  {hex32(r.addr)}
                  {labelFor(labelsByAddr, r.addr) && <span className="mem-label">{labelFor(labelsByAddr, r.addr)}</span>}
                </td>
                {[0, 4, 8, 12].map((w) => (
                  <td key={w} className="mem-word">
                    {r.bytes.slice(w, w + 4).map((b, i) => {
                      const a = (r.addr + w + i) >>> 0;
                      return <span key={i} className={`mem-byte ${written.has(a) ? 'is-written' : ''} ${read.has(a) ? 'is-read' : ''}`}>{b.toString(16).padStart(2, '0')}</span>;
                    })}
                  </td>
                ))}
                <td className="mem-ascii">{r.bytes.map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '·')).join('')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="editor-hint">Bytes are little-endian; each group is one word. Yellow = written this cycle, blue = read.</div>
    </div>
  );
}

function labelFor(labels: Map<number, string>, rowAddr: number): string | null {
  for (let i = 0; i < ROW_BYTES; i++) {
    const l = labels.get((rowAddr + i) >>> 0);
    if (l) return i ? `${l}+${-i}` : l;
  }
  return null;
}
