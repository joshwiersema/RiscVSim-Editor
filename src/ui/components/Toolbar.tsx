import { BrandMark } from './BrandMark';
import { Icon } from './Icons';
import { useStore } from '../state/store';
import { EXAMPLES } from '../examples';

export function Toolbar() {
  const s = useStore();
  const m = s.machine;
  const finished = !!m?.finished;
  const blocked = !!m?.blocked;
  const isC = s.language === 'c';
  const fileName = s.filePath ? s.filePath.replace(/^.*[\\/]/, '') : isC ? 'untitled.c' : 'untitled.s';

  return (
    <header className="toolbar">
      <div className="brand" title={s.filePath ?? 'unsaved file'}>
        <BrandMark size={22} />
        <span className="brand-name">RiscSim</span>
        <span className="file-name">{fileName}{s.fileDirty ? ' ●' : ''}</span>
      </div>

      <div className="toolbar-group">
        <button className="btn btn-ghost btn-sm" onClick={() => void s.openFile()} title="Open (Ctrl+O)"><Icon name="folder" size={14} /> Open</button>
        <button className="btn btn-ghost btn-sm" onClick={() => void s.saveFile()} title="Save (Ctrl+S)"><Icon name="save" size={14} /> Save</button>
        <select className="select select-sm" value={s.activeExample} onChange={(e) => s.loadExample(e.target.value)} title="Load an example program">
          <option value="" disabled>Examples…</option>
          {EXAMPLES.map((ex) => <option key={ex.id} value={ex.id}>{ex.title}</option>)}
        </select>
        <div className="segmented" title="Source language">
          <button className={!isC ? 'is-on' : ''} onClick={() => s.setLanguage('asm')}>Asm</button>
          <button className={isC ? 'is-on' : ''} onClick={() => s.setLanguage('c')}>C</button>
        </div>
      </div>

      <span className="toolbar-sep" />

      <div className="toolbar-group">
        <button className={`btn btn-sm ${s.dirty ? 'is-dirty' : ''}`} onClick={s.build} disabled={s.compiling} title={isC ? 'Compile with RISC-V GCC and load (Ctrl+Enter)' : 'Assemble (Ctrl+Enter)'}>
          {s.compiling ? 'Compiling…' : isC ? 'Compile' : s.dirty ? 'Assemble ●' : 'Assemble'}
        </button>
        {!isC && <label className="check" title="Emit 16-bit RV32C encodings wherever possible"><input type="checkbox" checked={s.autoCompress} onChange={(e) => s.setAutoCompress(e.target.checked)} /> auto-compress</label>}
        <button className="btn btn-sm" onClick={s.reset} title="Reset (R)">Reset</button>
      </div>

      <span className="toolbar-sep" />

      <div className="toolbar-group toolbar-run">
        <button className="btn btn-icon" onClick={s.stepBack} disabled={!m?.canUndo} title="Step back one cycle (B / F9)"><Icon name="skip-back" /></button>
        <button className={`btn btn-primary ${s.playing ? 'is-on' : ''}`} onClick={() => s.setPlaying(!s.playing)} disabled={finished || blocked} title="Play / pause (Space / F5)">
          <Icon name={s.playing ? 'pause' : 'play'} /> {s.playing ? 'Pause' : 'Play'}
        </button>
        <button className="btn" onClick={s.step} disabled={finished || blocked} title="Execute one clock cycle (N / F10)"><Icon name="step" /> Step</button>
        <button className="btn" onClick={s.subStep} disabled={finished || blocked} title="Walk through the current cycle one stage at a time (M / F11)"><Icon name="walk" /> Walk</button>
        <button className="btn" onClick={s.run} disabled={finished || blocked} title="Run to the end or next breakpoint (Shift+F5)"><Icon name="run" /> Run</button>
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

      <span className="toolbar-sep" />

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
    </header>
  );
}
