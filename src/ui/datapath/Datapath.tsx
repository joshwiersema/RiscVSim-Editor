import { useCallback, useMemo, useRef, useState, type MouseEvent, type WheelEvent } from 'react';
import { disassemble } from '@/core/isa/decode';
import type { StageName } from '@/core/sim/narrate';
import { STAGES } from '@/core/sim/narrate';
import type { InstrTrace } from '@/core/sim/types';
import { formatValue, type NumberBase } from '@/core/util/format';
import { PHASE_COMPLETE, useStore, type HoverTarget } from '../state/store';
import { pathFrom, STAGE_INDEX, type Layout, type Wire } from './layout';
import { PIPELINE_LAYOUT } from './pipeline.layout';
import { SINGLE_CYCLE_LAYOUT } from './singleCycle.layout';
import { ComponentShape } from './shapes';
import { useExplainer } from './useExplain';
import { Tooltip } from './Tooltip';

/** Raw numeric value carried by a wire, for the value badges. */
const WIRE_VALUES: Record<string, (t: InstrTrace) => number> = {
  'w.pc': (t) => t.pc, 'w.pc4': (t) => t.pc4, 'w.instr': (t) => t.instr.word, 'w.rs1val': (t) => t.rs1Val, 'w.rs2val': (t) => t.rs2Val,
  'w.imm': (t) => t.imm, 'w.aluResult': (t) => t.aluResult, 'w.memReadData': (t) => t.memReadData, 'w.wbData': (t) => t.wbValue,
  'w.branchTarget': (t) => t.branchTarget, 'w.fwdA': (t) => t.opA, 'w.fwdB': (t) => t.opB, 'w.nextPc': (t) => t.nextPc,
};

interface ViewTransform { readonly scale: number; readonly x: number; readonly y: number }

export function Datapath() {
  const model = useStore((s) => s.model);
  const trace = useStore((s) => s.trace);
  const phase = useStore((s) => s.phase);
  const hover = useStore((s) => s.hover);
  const pinned = useStore((s) => s.pinned);
  const setHover = useStore((s) => s.setHover);
  const setPinned = useStore((s) => s.setPinned);
  const base = useStore((s) => s.base);
  const showValues = useStore((s) => s.showValues);
  const setBase = useStore((s) => s.setBase);
  const setShowValues = useStore((s) => s.setShowValues);
  const explain = useExplainer();
  const layout: Layout = model === 'single' ? SINGLE_CYCLE_LAYOUT : PIPELINE_LAYOUT;
  const containerRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<ViewTransform>({ scale: 1, x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);

  const highlighted = hover ?? pinned;

  const onEnter = useCallback((e: MouseEvent, explainId: string, stage: StageName) => {
    const rect = containerRef.current?.getBoundingClientRect();
    setHover({ explain: explainId, stage, x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) });
  }, [setHover]);
  const onMove = useCallback((e: MouseEvent, explainId: string, stage: StageName) => {
    const rect = containerRef.current?.getBoundingClientRect();
    setHover({ explain: explainId, stage, x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) });
  }, [setHover]);
  const onLeave = useCallback(() => setHover(null), [setHover]);
  const onClick = useCallback((e: MouseEvent, explainId: string, stage: StageName) => {
    e.stopPropagation();
    const same = pinned && pinned.explain === explainId && pinned.stage === stage;
    setPinned(same ? null : { explain: explainId, stage, x: 0, y: 0 });
  }, [pinned, setPinned]);

  const onWheel = (e: WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    setView((v) => ({ ...v, scale: Math.min(4, Math.max(0.4, v.scale * factor)) }));
  };
  const onMouseDown = (e: MouseEvent) => {
    if (e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
  };
  const onMouseMove = (e: MouseEvent) => {
    if (!drag.current) return;
    const d = drag.current;
    setView((v) => ({ ...v, x: d.vx + (e.clientX - d.x), y: d.vy + (e.clientY - d.y) }));
  };
  const onMouseUp = () => { drag.current = null; };

  const stageText = useMemo(() => {
    const out: Partial<Record<StageName, string>> = {};
    if (!trace) return out;
    for (const s of STAGES) {
      const t = trace.stages[s].trace;
      out[s] = t ? disassemble(t.instr, t.pc) : trace.stages[s].note ? '— ' + shortNote(trace.stages[s].note!) : '—';
    }
    return out;
  }, [trace]);

  const walkthrough = phase < PHASE_COMPLETE;

  return (
    <div className="datapath" ref={containerRef} onClick={() => setPinned(null)}>
      <div className="datapath-toolbar">
        <span className="datapath-title">{model === 'single' ? 'Single-cycle datapath' : '5-stage pipelined datapath'}</span>
        <div className="legend">
          <span className="legend-item"><i className="swatch swatch-data" /> data</span>
          <span className="legend-item"><i className="swatch swatch-control" /> control</span>
          <span className="legend-item"><i className="swatch swatch-inactive" /> unused this cycle</span>
        </div>
        <div className="datapath-options" onClick={(e) => e.stopPropagation()}>
          <select className="select select-sm" value={base} onChange={(e) => setBase(e.target.value as NumberBase)} title="Number display">
            <option value="hex">hex</option>
            <option value="dec">signed</option>
            <option value="udec">unsigned</option>
            <option value="bin">binary</option>
          </select>
          <label className="check"><input type="checkbox" checked={showValues} onChange={(e) => setShowValues(e.target.checked)} /> values</label>
        </div>
        <div className="zoom-controls">
          <button className="btn btn-ghost btn-xs" onClick={(e) => { e.stopPropagation(); setView((v) => ({ ...v, scale: v.scale / 1.2 })); }} title="Zoom out">−</button>
          <button className="btn btn-ghost btn-xs" onClick={(e) => { e.stopPropagation(); setView({ scale: 1, x: 0, y: 0 }); }} title="Reset view">{Math.round(view.scale * 100)}%</button>
          <button className="btn btn-ghost btn-xs" onClick={(e) => { e.stopPropagation(); setView((v) => ({ ...v, scale: v.scale * 1.2 })); }} title="Zoom in">+</button>
        </div>
      </div>
      <div
        className={`datapath-canvas ${drag.current ? 'is-dragging' : ''}`}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      >
        <svg
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          className={`datapath-svg ${trace ? '' : 'is-idle'}`}
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
          key={model}
        >
          <defs>
            <marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0 0 L8 4 L0 8 Z" className="arrow-head" />
            </marker>
          </defs>
          {layout.bands.map((b, i) => {
            const idx = STAGE_INDEX[b.stage];
            const state = !walkthrough ? '' : idx < phase ? 'is-done' : idx === phase ? 'is-current' : 'is-pending';
            return (
              <g key={b.stage} className={`band ${state}`}>
                <rect x={b.x} y={0} width={b.w} height={layout.height} className={`band-bg ${i % 2 ? 'alt' : ''}`} />
                <text x={b.x + 10} y={layout.height - 12} className="band-label">{b.stage}</text>
                {model === 'pipeline' && <text x={b.x + 52} y={layout.height - 12} className="band-instr">{truncate(stageText[b.stage] ?? '', Math.floor(b.w / 7.2) - 6)}</text>}
              </g>
            );
          })}
          {layout.wires.map((w) => (
            <WireView
              key={w.id}
              wire={w}
              phase={phase}
              cycle={trace?.cycle ?? 0}
              info={explain(w.explain, w.stage)}
              isHighlighted={!!highlighted && highlighted.explain === w.explain && highlighted.stage === w.stage}
              onEnter={onEnter}
              onMove={onMove}
              onLeave={onLeave}
              onClick={onClick}
            />
          ))}
          {layout.components.map((c) => {
            const info = explain(c.explain ?? c.id, c.stage);
            const idx = STAGE_INDEX[c.stage];
            const dim = walkthrough && idx > phase;
            const isHl = !!highlighted && highlighted.explain === (c.explain ?? c.id) && highlighted.stage === c.stage;
            const content = c.kind === 'reg' ? stageText[c.stage] ?? null : null;
            return (
              <g
                key={c.id}
                onMouseEnter={(e) => onEnter(e, c.explain ?? c.id, c.stage)}
                onMouseMove={(e) => onMove(e, c.explain ?? c.id, c.stage)}
                onMouseLeave={onLeave}
                onClick={(e) => onClick(e, c.explain ?? c.id, c.stage)}
              >
                <ComponentShape c={c} className={`comp ${info.active ? 'is-active' : ''} ${dim ? 'is-dim' : ''} ${isHl ? 'is-highlight' : ''}`} content={content} />
              </g>
            );
          })}
          {showValues && trace && layout.wires.map((w) => {
            if (!w.valueAt) return null;
            const t = trace.stages[w.stage].trace;
            const get = WIRE_VALUES[w.explain];
            if (!t || !get) return null;
            const idx = STAGE_INDEX[w.stage];
            if (walkthrough && idx > phase) return null;
            const info = explain(w.explain, w.stage);
            if (!info.active) return null;
            return (
              <text key={`v-${w.id}`} x={w.valueAt[0]} y={w.valueAt[1]} className="value-badge">{formatValue(get(t), base)}</text>
            );
          })}
        </svg>
      </div>
      {hover && <Tooltip target={hover} info={explain(hover.explain, hover.stage)} container={containerRef.current} />}
      {!trace && (
        <div className="datapath-empty">
          <div>
            <strong>Nothing running yet.</strong>
            <div>Press <kbd>Step</kbd> to execute one cycle, or <kbd>Walk</kbd> to reveal the datapath one stage at a time. Hover any wire or block for an explanation.</div>
          </div>
        </div>
      )}
    </div>
  );
}

interface WireViewProps {
  readonly wire: Wire;
  readonly phase: number;
  readonly cycle: number;
  readonly info: { active: boolean };
  readonly isHighlighted: boolean;
  readonly onEnter: (e: MouseEvent, explain: string, stage: StageName) => void;
  readonly onMove: (e: MouseEvent, explain: string, stage: StageName) => void;
  readonly onLeave: () => void;
  readonly onClick: (e: MouseEvent, explain: string, stage: StageName) => void;
}

function WireView({ wire, phase, cycle, info, isHighlighted, onEnter, onMove, onLeave, onClick }: WireViewProps) {
  const idx = STAGE_INDEX[wire.stage];
  const walkthrough = phase < PHASE_COMPLETE;
  const dim = walkthrough && idx > phase;
  const flowing = info.active && ((walkthrough && idx === phase) || !walkthrough);
  const cls = `wire kind-${wire.kind} ${info.active ? 'is-active' : ''} ${dim ? 'is-dim' : ''} ${flowing ? 'is-flowing' : ''} ${isHighlighted ? 'is-highlight' : ''}`;
  return (
    <g
      className={cls}
      data-explain={wire.explain}
      data-stage={wire.stage}
      onMouseEnter={(e) => onEnter(e, wire.explain, wire.stage)}
      onMouseMove={(e) => onMove(e, wire.explain, wire.stage)}
      onMouseLeave={onLeave}
      onClick={(e) => onClick(e, wire.explain, wire.stage)}
    >
      {wire.segments.map((seg, i) => (
        <g key={i}>
          <path d={pathFrom(seg)} className="wire-hit" />
          <path d={pathFrom(seg)} className="wire-line" markerEnd="url(#arrow)" />
          {flowing && <path key={`flow-${cycle}-${phase}`} d={pathFrom(seg)} className="wire-flow" />}
        </g>
      ))}
      {wire.label && (
        <text x={wire.label.at[0]} y={wire.label.at[1]} className="wire-label" textAnchor={wire.label.anchor ?? 'middle'}>{wire.label.text}</text>
      )}
    </g>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, Math.max(3, n - 1)) + '…' : s;
}

function shortNote(note: string): string {
  if (note.includes('flush')) return 'flushed';
  if (note.includes('bubble')) return 'bubble (stall)';
  if (note.includes('end of program') || note.includes('past the end')) return 'done';
  return 'empty';
}

export type { HoverTarget };
