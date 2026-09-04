import { useMemo } from 'react';
import { decode, disassemble } from '@/core/isa/decode';
import { STAGES, type StageName } from '@/core/sim/narrate';
import { hex32 } from '@/core/util/format';
import { useStore } from '../state/store';

/** Assembled program listing: address, machine code, disassembly, and stage occupancy. */
export function ProgramPanel() {
  const program = useStore((s) => s.program);
  const trace = useStore((s) => s.trace);
  const machine = useStore((s) => s.machine);
  const tick = useStore((s) => s.tick);
  const breakpoints = useStore((s) => s.breakpoints);
  const toggleBreakpoint = useStore((s) => s.toggleBreakpoint);
  void tick;

  const labels = useMemo(() => {
    const m = new Map<number, string>();
    if (program) for (const [name, addr] of program.labels) m.set(addr, name);
    return m;
  }, [program]);

  const stageOf = useMemo(() => {
    const m = new Map<number, StageName[]>();
    if (trace) for (const s of STAGES) { const t = trace.stages[s].trace; if (t) m.set(t.pc, [...(m.get(t.pc) ?? []), s]); }
    return m;
  }, [trace]);

  if (!program) return <div className="panel-empty">Assemble to see the program listing.</div>;
  const nextPc = machine && !machine.finished ? machine.core.pc : -1;

  return (
    <div className="panel-scroll">
      <table className="table program mono">
        <tbody>
          {program.text.map((w) => {
            const label = labels.get(w.addr);
            const stages = stageOf.get(w.addr) ?? [];
            return (
              <tr key={w.addr} className={`${stages.length ? 'is-active' : ''} ${w.addr === nextPc ? 'is-next' : ''}`}>
                <td className="bp-cell" onClick={() => toggleBreakpoint(w.addr)} title="Toggle breakpoint">
                  <span className={`bp-dot ${breakpoints.has(w.addr) ? '' : 'is-off'}`} />
                </td>
                <td className="muted">{hex32(w.addr)}</td>
                <td className="muted">{hex32(w.word)}</td>
                <td className="program-label">{label ? `${label}:` : ''}</td>
                <td>{disassemble(decode(w.word), w.addr, (a) => labels.get(a))}</td>
                <td className="program-stages">{stages.map((s) => <span key={s} className={`stage-tag stage-tag-${s}`}>{s}</span>)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
