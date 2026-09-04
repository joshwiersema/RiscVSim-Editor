import { useMemo } from 'react';
import { cacheSizeBytes, hitRate, type CacheState, type CacheConfig } from '@/core/cache/cache';
import { INSTR_CLASSES, summarize, type RunSummary } from '@/core/sim/stats';
import { MAX_HISTORY } from '@/core/sim/machine';
import { useStore } from '../state/store';

/** Whole-run numbers: throughput, instruction mix, memory traffic, and cache behaviour. */
export function StatsPanel() {
  const machine = useStore((s) => s.machine);
  const tick = useStore((s) => s.tick);
  const model = useStore((s) => s.model);
  const caches = useStore((s) => s.caches);
  void tick;

  const summary = useMemo(() => (machine ? summarize(machine.traces, machine.core.stats) : null), [machine, tick]);

  if (!machine || !summary) return <div className="panel-empty">Assemble and run a program to see cycle counts, CPI, the instruction mix, and cache behaviour here.</div>;
  const truncated = summary.sampledCycles < summary.cycles;

  return (
    <div className="stats panel-scroll">
      <section className="stats-section">
        <div className="section-title"><span>Throughput</span></div>
        <div className="stat-grid">
          <Tile label="cycles" value={summary.cycles} />
          <Tile label="instructions" value={summary.instructions} />
          <Tile label="CPI" value={summary.cpi === null ? '–' : summary.cpi.toFixed(2)} hint={model === 'single' ? 'Single-cycle: always 1.00' : 'Ideal pipeline: 1.00'} />
          <Tile label="IPC" value={summary.cpi === null ? '–' : (1 / summary.cpi).toFixed(2)} />
          {model === 'pipeline' && <Tile label="stalls" value={summary.stalls} tone={summary.stalls ? 'warn' : undefined} />}
          {model === 'pipeline' && <Tile label="flushes" value={summary.flushes} tone={summary.flushes ? 'bad' : undefined} />}
        </div>
        {model === 'pipeline' && <Utilisation s={summary} />}
      </section>

      <section className="stats-section">
        <div className="section-title"><span>Instruction mix</span><span className="muted">{summary.instructions} retired</span></div>
        <Mix s={summary} />
        <div className="stats-row muted">
          <span>branches <b>{summary.branches.total}</b>{summary.branches.total ? <> · taken <b>{summary.branches.taken}</b> ({Math.round((summary.branches.taken / summary.branches.total) * 100)}%)</> : null}</span>
          <span>loads <b>{summary.loads}</b> · stores <b>{summary.stores}</b></span>
          <span>register writes <b>{summary.regWrites}</b></span>
          {summary.compressed > 0 && <span>16-bit encodings <b>{summary.compressed}</b></span>}
        </div>
      </section>

      <section className="stats-section">
        <div className="section-title"><span>L1 caches</span></div>
        <CacheRow name="Instruction" cfg={caches.icache} state={machine.icache} />
        <CacheRow name="Data" cfg={caches.dcache} state={machine.dcache} />
      </section>

      {truncated && <p className="muted stats-note">Instruction mix covers the last {MAX_HISTORY.toLocaleString()} cycles of history; totals above are exact.</p>}
    </div>
  );
}

function Tile({ label, value, hint, tone }: { label: string; value: number | string; hint?: string; tone?: 'warn' | 'bad' }) {
  return (
    <div className="stat-tile" title={hint}>
      <span>{label}</span>
      <b className={tone === 'warn' ? 'warn' : tone === 'bad' ? 'bad' : ''}>{value}</b>
    </div>
  );
}

function Utilisation({ s }: { s: RunSummary }) {
  if (!s.cycles) return null;
  const busy = s.cycles - s.idleCycles;
  const pct = (n: number) => `${(n / s.cycles) * 100}%`;
  return (
    <div className="util">
      <div className="util-bar" title={`${busy} cycles retired an instruction; ${s.idleCycles} did not (stalls, flushes, pipeline fill/drain)`}>
        <i className="util-busy" style={{ width: pct(busy) }} />
        <i className="util-idle" style={{ width: pct(s.idleCycles) }} />
      </div>
      <div className="util-legend muted">
        <span><i className="swatch swatch-busy" /> retired {Math.round((busy / s.cycles) * 100)}%</span>
        <span><i className="swatch swatch-idle" /> no retire {Math.round((s.idleCycles / s.cycles) * 100)}%</span>
      </div>
    </div>
  );
}

function Mix({ s }: { s: RunSummary }) {
  const total = Object.values(s.mix).reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...Object.values(s.mix));
  return (
    <div className="mix">
      {INSTR_CLASSES.filter((c) => s.mix[c.id] > 0 || c.id !== 'other').map((c) => {
        const n = s.mix[c.id];
        return (
          <div key={c.id} className={`mix-row ${n ? '' : 'is-zero'}`}>
            <span className="mix-label">{c.label}</span>
            <span className="mix-bar"><i className={`mix-fill mix-${c.id}`} style={{ width: `${(n / max) * 100}%` }} /></span>
            <span className="mix-num mono">{n}</span>
            <span className="mix-pct muted">{total ? `${Math.round((n / total) * 100)}%` : ''}</span>
          </div>
        );
      })}
    </div>
  );
}

function CacheRow({ name, cfg, state }: { name: string; cfg: CacheConfig; state: CacheState }) {
  const st = state.stats;
  const n = st.hits + st.misses;
  const rate = hitRate(st);
  return (
    <div className="cache-row">
      <div className="cache-row-head">
        <b>{name}</b>
        <span className="muted">{cfg.sets}×{cfg.ways}-way · {cfg.blockWords}-word blocks · {cacheSizeBytes(cfg)} B · {cfg.replacement} · {cfg.writePolicy === 'WRITE_BACK' ? 'write-back' : 'write-through'}</span>
      </div>
      <div className="cache-row-bar" title={`${st.hits} hits, ${st.misses} misses`}>
        <i style={{ width: `${n ? rate * 100 : 0}%` }} />
      </div>
      <div className="stats-row muted">
        <span>hit rate <b>{n ? `${(rate * 100).toFixed(1)}%` : '–'}</b></span>
        <span>hits <b className="ok">{st.hits}</b> · misses <b className="bad">{st.misses}</b></span>
        <span>evictions <b>{st.evictions}</b> · write-backs <b>{st.writebacks}</b></span>
      </div>
    </div>
  );
}
