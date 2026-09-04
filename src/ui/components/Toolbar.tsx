import { BrandMark } from './BrandMark';
import { useStore } from '../state/store';
import { EXAMPLES } from '../examples';

export function Toolbar() {
  const s = useStore();
  const m = s.machine;
  const stats = m?.core.stats;
  const cpi = stats && stats.instructions ? (stats.cycles / stats.instructions).toFixed(2) : '–';
  const finished = !!m?.finished;
  const blocked = !!m?.blocked;
  const isC = s.language === 'c';
  const fileName = s.filePath ? s.filePath.replace(/^.*[\\/]/, '') : isC ? 'untitled.c' : 'untitled.s';

  return (
    <header className="toolbar">
      <div className="brand" title={s.filePath ?? 'unsaved file'}>
        <BrandMark />
        <span className="brand-name">RiscSim</span>
        <span className="file-name">{fileName}{s.fileDirty ? ' ●' : ''}</span>
      </div>

      <div className="toolbar-group">
        <button className="btn btn-ghost btn-xs" onClick={() => void s.openFile()} title="Open (Ctrl+O)">Open</button>
        <button className="btn btn-ghost btn-xs" onClick={() => void s.saveFile()} title="Save (Ctrl+S)">Save</button>
        <select className="select select-sm" value={s.activeExample} onChange={(e) => s.loadExample(e.target.value)} title="Load an example program">
          <option value="" disabled>Examples…</option>
          {EXAMPLES.map((ex) => <option key={ex.id} value={ex.id}>{ex.title}</option>)}
        </select>
        <div className="segmented" title="Source language">
          <button className={!isC ? 'is-on' : ''} onClick={() => s.setLanguage('asm')}>Asm</button>
          <button className={isC ? 'is-on' : ''} onClick={() => s.setLanguage('c')}>C</button>
        </div>
      </div>

      <div className="toolbar-group">
        <button className={`btn ${s.dirty ? 'is-dirty' : ''}`} onClick={s.build} disabled={s.compiling} title={isC ? 'Compile with RISC-V GCC and load (Ctrl+Enter)' : 'Assemble (Ctrl+Enter)'}>
          {s.compiling ? 'Compiling…' : isC ? 'Compile' : s.dirty ? 'Assemble ●' : 'Assemble'}
        </button>
        {!isC && <label className="check" title="Emit 16-bit RV32C encodings wherever possible"><input type="checkbox" checked={s.autoCompress} onChange={(e) => s.setAutoCompress(e.target.checked)} /> auto-compress</label>}
        <button className="btn" onClick={s.reset} title="Reset (R)">Reset</button>
      </div>

      <div className="toolbar-group toolbar-run">
        <button className="btn btn-icon" onClick={s.stepBack} disabled={!m?.canUndo} title="Step back one cycle (B / F9)">⏮</button>
        <button className={`btn btn-primary ${s.playing ? 'is-on' : ''}`} onClick={() => s.setPlaying(!s.playing)} disabled={finished || blocked} title="Play / pause (Space / F5)">
          {s.playing ? '❚❚ Pause' : '▶ Play'}
        </button>
        <button className="btn" onClick={s.step} disabled={finished || blocked} title="Execute one clock cycle (N / F10)">Step ⏭</button>
        <button className="btn" onClick={s.subStep} disabled={finished || blocked} title="Walk through the current cycle one stage at a time (M / F11)">Walk ▸</button>
        <button className="btn" onClick={s.run} disabled={finished || blocked} title="Run to the end or next breakpoint">Run ⏩</button>
      </div>

      <div className="toolbar-group">
        <label className="field" title="Auto-play speed">
          <input type="range" min={0.5} max={30} step={0.5} value={s.speed} onChange={(e) => s.setSpeed(Number(e.target.value))} />
          <span className="field-value">{s.speed}/s</span>
        </label>
        <div className="segmented" title="What one auto-play tick advances">
          <button className={s.playMode === 'cycle' ? 'is-on' : ''} onClick={() => s.setPlayMode('cycle')}>cycles</button>
          <button className={s.playMode === 'phase' ? 'is-on' : ''} onClick={() => s.setPlayMode('phase')}>stages</button>
        </div>
      </div>

      <div className="toolbar-group">
        <div className="segmented" title="Processor model">
          <button className={s.model === 'single' ? 'is-on' : ''} onClick={() => s.setModel('single')}>Single-cycle</button>
          <button className={s.model === 'pipeline' ? 'is-on' : ''} onClick={() => s.setModel('pipeline')}>Pipeline</button>
        </div>
        {s.model === 'pipeline' && (
          <>
            <label className="check" title="Bypass results from EX/MEM and MEM/WB straight into EX"><input type="checkbox" checked={s.options.forwarding} onChange={(e) => s.setOptions({ forwarding: e.target.checked })} /> forwarding</label>
            <label className="check" title="Stall on load-use (and on every RAW hazard when forwarding is off)"><input type="checkbox" checked={s.options.hazardDetection} onChange={(e) => s.setOptions({ hazardDetection: e.target.checked })} /> hazard unit</label>
          </>
        )}
      </div>

      <div className="toolbar-stats">
        <span className="stat"><b>{m?.core.cycle ?? 0}</b> cycles</span>
        <span className="stat"><b>{stats?.instructions ?? 0}</b> instr</span>
        <span className="stat">CPI <b>{cpi}</b></span>
        {s.model === 'pipeline' && <span className="stat"><b>{stats?.stalls ?? 0}</b> stalls · <b>{stats?.flushes ?? 0}</b> flushes</span>}
        <button className="btn btn-ghost btn-xs" onClick={() => s.setDialog('settings')} title="Settings (compiler path)">⚙</button>
        <button className="btn btn-ghost btn-xs" onClick={() => s.setDialog('help')} title="Help & shortcuts (F1)">?</button>
      </div>
    </header>
  );
}
