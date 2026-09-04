import { useMemo } from 'react';
import { decode, disassemble } from '@/core/isa/decode';
import { hitRate } from '@/core/cache/cache';
import { hex32 } from '@/core/util/format';
import { useStore } from '../state/store';
import { APP_VERSION } from '../version';

type RunState = 'idle' | 'ready' | 'running' | 'paused' | 'blocked' | 'finished' | 'error';

const STATE_LABEL: Record<RunState, string> = {
  idle: 'No program', ready: 'Ready', running: 'Running', paused: 'Paused', blocked: 'Waiting for input', finished: 'Finished', error: 'Error',
};

/** Bottom strip: run state, where the processor is, headline numbers, and the last status message. */
export function StatusBar() {
  const machine = useStore((s) => s.machine);
  const program = useStore((s) => s.program);
  const tick = useStore((s) => s.tick);
  const playing = useStore((s) => s.playing);
  const status = useStore((s) => s.status);
  const model = useStore((s) => s.model);
  const options = useStore((s) => s.options);
  const filePath = useStore((s) => s.filePath);
  const fileDirty = useStore((s) => s.fileDirty);
  void tick;

  const state: RunState = !machine ? 'idle'
    : machine.core.error ? 'error'
    : machine.finished ? 'finished'
    : machine.blocked ? 'blocked'
    : playing ? 'running'
    : machine.core.cycle > 0 ? 'paused' : 'ready';

  const stats = machine?.core.stats;
  const cpi = stats && stats.instructions ? (stats.cycles / stats.instructions).toFixed(2) : '–';
  const next = useMemo(() => {
    if (!machine || !program || machine.finished) return null;
    const w = program.text.find((t) => t.addr === machine.core.pc);
    return w ? disassemble(decode(w.word), w.addr) : null;
  }, [machine, program, tick]);

  const iRate = machine ? hitRate(machine.icache.stats) : null;
  const dRate = machine ? hitRate(machine.dcache.stats) : null;
  const pct = (r: number | null, s?: { hits: number; misses: number }) => (r === null || !s || s.hits + s.misses === 0 ? '–' : `${Math.round(r * 100)}%`);
  const fileName = filePath ? filePath.replace(/^.*[\\/]/, '') : null;

  return (
    <footer className="statusbar">
      <span className={`status-state is-${state}`}><i className="status-dot" />{STATE_LABEL[state]}{state === 'finished' && machine ? ` · exit ${machine.core.exitCode}` : ''}</span>
      <span className="status-item" title="Clock cycles elapsed">cycle <b>{machine?.core.cycle ?? 0}</b></span>
      <span className="status-item mono" title="Program counter">PC <b>{machine ? hex32(machine.core.pc) : '–'}</b></span>
      {next && <span className="status-item mono status-next" title="Next instruction to fetch">{next}</span>}
      <span className="status-item" title="Instructions retired">instr <b>{stats?.instructions ?? 0}</b></span>
      <span className="status-item" title="Cycles per instruction">CPI <b>{cpi}</b></span>
      {model === 'pipeline' && <span className="status-item" title="Stall and flush cycles"><b>{stats?.stalls ?? 0}</b> stalls · <b>{stats?.flushes ?? 0}</b> flushes</span>}
      <span className="status-item" title="L1 cache hit rates">I$ <b>{pct(iRate, machine?.icache.stats)}</b> · D$ <b>{pct(dRate, machine?.dcache.stats)}</b></span>
      <span className="status-message" title={status}>{status}</span>
      <span className="status-item status-right" title="Processor model">{model === 'single' ? 'Single-cycle' : `Pipeline · ${options.forwarding ? 'forwarding' : 'no forwarding'} · ${options.hazardDetection ? 'hazard unit' : 'no hazard unit'}`}</span>
      {fileName && <span className="status-item" title={filePath ?? undefined}>{fileName}{fileDirty ? ' ●' : ''}</span>}
      <span className="status-item muted">v{APP_VERSION}</span>
    </footer>
  );
}
