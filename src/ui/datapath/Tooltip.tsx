import type { Explanation } from '@/core/sim/explain';
import type { HoverTarget } from '../state/store';

interface TooltipProps {
  readonly target: HoverTarget;
  readonly info: Explanation;
  readonly container: HTMLDivElement | null;
}

const WIDTH = 320;

/** Floating explanation card that follows the cursor over the datapath. */
export function Tooltip({ target, info, container }: TooltipProps) {
  const cw = container?.clientWidth ?? 800;
  const ch = container?.clientHeight ?? 600;
  const left = target.x + 18 + WIDTH > cw ? Math.max(8, target.x - WIDTH - 18) : target.x + 18;
  const flipUp = target.y + 180 > ch;
  const style = flipUp ? { left, bottom: ch - target.y + 12 } : { left, top: target.y + 12 };
  return (
    <div className={`tooltip kind-${info.kind} ${info.active ? 'is-active' : 'is-inactive'}`} style={{ ...style, width: WIDTH }}>
      <div className="tooltip-head">
        <span className="tooltip-title">{info.title}</span>
        <span className="stage-chip">{target.stage}</span>
      </div>
      {info.value && <div className="tooltip-value">{info.value}</div>}
      <div className="tooltip-why">{renderInline(info.why)}</div>
      <div className="tooltip-hint">click to pin</div>
    </div>
  );
}

/** Render `code` spans from backticks. */
export function renderInline(text: string) {
  const parts = text.split(/(`[^`]+`)/g);
  return parts.map((p, i) => (p.startsWith('`') ? <code key={i}>{p.slice(1, -1)}</code> : <span key={i}>{p}</span>));
}
