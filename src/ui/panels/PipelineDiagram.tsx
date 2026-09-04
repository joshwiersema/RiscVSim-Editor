import { useMemo } from 'react';
import { disassemble } from '@/core/isa/decode';
import { STAGES, type StageName } from '@/core/sim/narrate';
import type { CycleTrace } from '@/core/sim/types';
import { useStore } from '../state/store';

interface Row {
  readonly seq: number;
  readonly text: string;
  readonly pc: number;
  /** cycle -> stage (or 'stall' marker when the same stage repeats). */
  readonly cells: Map<number, { stage: StageName; stalled: boolean }>;
  readonly flushedAt: number | null;
}

const MAX_COLS = 60;

/** Classic instruction-vs-cycle pipeline diagram, built from the recorded traces. */
export function PipelineDiagram() {
  const machine = useStore((s) => s.machine);
  const tick = useStore((s) => s.tick);
  const program = useStore((s) => s.program);

  const { rows, cycles } = useMemo(() => buildRows(machine?.traces ?? [], program?.labels), [machine, tick, program]);

  if (!machine || cycles.length === 0) return <div className="panel-empty">Step a few cycles to build the instruction/cycle diagram. Stalls show as bubbles, flushed instructions as ✕.</div>;

  const visible = cycles.slice(-MAX_COLS);
  return (
    <div className="panel-scroll">
      <table className="table pipe-diagram mono">
        <thead>
          <tr>
            <th className="pipe-instr">instruction</th>
            {visible.map((c) => <th key={c}>{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.seq}>
              <td className="pipe-instr" title={`PC 0x${r.pc.toString(16)}`}>{r.text}</td>
              {visible.map((c) => {
                const cell = r.cells.get(c);
                if (cell) return <td key={c} className={`pipe-cell stage-${cell.stage} ${cell.stalled ? 'is-stalled' : ''}`}>{cell.stalled ? '◦' : cell.stage}</td>;
                if (r.flushedAt === c) return <td key={c} className="pipe-cell is-flushed">✕</td>;
                return <td key={c} />;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function buildRows(traces: readonly CycleTrace[], labels?: ReadonlyMap<string, number>): { rows: Row[]; cycles: number[] } {
  const byAddr = new Map<number, string>();
  if (labels) for (const [name, addr] of labels) byAddr.set(addr, name);
  const rows = new Map<number, { seq: number; text: string; pc: number; cells: Map<number, { stage: StageName; stalled: boolean }>; last: { cycle: number; stage: StageName } | null; flushedAt: number | null }>();
  const cycles: number[] = [];
  for (const tr of traces) {
    cycles.push(tr.cycle);
    for (const s of STAGES) {
      const t = tr.stages[s].trace;
      if (!t) continue;
      let row = rows.get(t.seq);
      if (!row) {
        row = { seq: t.seq, text: disassemble(t.instr, t.pc, (a) => byAddr.get(a)), pc: t.pc, cells: new Map(), last: null, flushedAt: null };
        rows.set(t.seq, row);
      }
      const stalled = row.last?.stage === s;
      row.cells.set(tr.cycle, { stage: s, stalled });
      row.last = { cycle: tr.cycle, stage: s };
    }
    if (tr.hazard.flush) {
      // Instructions that were in IF and ID this cycle never progress: mark them.
      for (const s of ['IF', 'ID'] as StageName[]) {
        const t = tr.stages[s].trace;
        if (t) { const row = rows.get(t.seq); if (row) row.flushedAt = tr.cycle + 1; }
      }
    }
  }
  const list = [...rows.values()].sort((a, b) => a.seq - b.seq).map(({ last: _l, ...r }) => r);
  return { rows: list, cycles };
}
