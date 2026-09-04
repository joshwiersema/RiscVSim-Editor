import { useMemo } from 'react';
import { narrate } from '@/core/sim/narrate';
import { STAGE_INDEX } from '../datapath/layout';
import { renderInline } from '../datapath/Tooltip';
import { PHASE_COMPLETE, useStore } from '../state/store';

/** Plain-English, stage-by-stage account of the current cycle. */
export function NarrationPanel() {
  const trace = useStore((s) => s.trace);
  const program = useStore((s) => s.program);
  const phase = useStore((s) => s.phase);
  const setPhase = useStore((s) => s.setPhase);
  const model = useStore((s) => s.model);

  const story = useMemo(() => {
    if (!trace) return null;
    const byAddr = new Map<number, string>();
    if (program) for (const [name, addr] of program.labels) byAddr.set(addr, name);
    return narrate(trace, (a) => byAddr.get(a));
  }, [trace, program]);

  if (!story) return <div className="panel-empty">Step once and this panel narrates what every stage of the processor did and why.</div>;

  const walkthrough = phase < PHASE_COMPLETE;
  return (
    <div className="narration">
      <div className="narration-head">
        <strong>{story.title}</strong>
        <span className="muted">{renderInline(story.summary)}</span>
        {trace?.hazard.reason && <div className={`hazard-banner ${trace.hazard.stall ? 'is-stall' : 'is-flush'}`}>{trace.hazard.reason}</div>}
      </div>
      <div className={`stage-cards ${model === 'single' ? 'is-single' : ''}`}>
        {story.stages.map((st) => {
          const idx = STAGE_INDEX[st.stage];
          const state = !walkthrough ? '' : idx < phase ? 'is-done' : idx === phase ? 'is-current' : 'is-pending';
          return (
            <button key={st.stage} className={`stage-card kind-${st.kind} ${state}`} onClick={() => setPhase(idx)} title="Show the datapath up to this stage">
              <div className="stage-card-head">
                <span className={`stage-tag stage-tag-${st.stage}`}>{st.stage}</span>
                <span className="stage-card-title">{st.headline}</span>
              </div>
              {st.instr && <code className="stage-card-instr">{st.instr}</code>}
              <ul>
                {st.lines.map((l, i) => <li key={i}>{renderInline(l)}</li>)}
              </ul>
            </button>
          );
        })}
      </div>
    </div>
  );
}
