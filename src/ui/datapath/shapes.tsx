import type { Component } from './layout';

interface ShapeProps {
  readonly c: Component;
  readonly className: string;
  readonly content?: string | null;
}

/** Renders one datapath component in its stage-appropriate shape. */
export function ComponentShape({ c, className, content }: ShapeProps) {
  const cx = c.x + c.w / 2;
  const cy = c.y + c.h / 2;
  switch (c.kind) {
    case 'mux':
      return (
        <g className={className}>
          <path d={`M${c.x} ${c.y} L${c.x + c.w} ${c.y + 8} L${c.x + c.w} ${c.y + c.h - 8} L${c.x} ${c.y + c.h} Z`} className="comp-body" />
          <text x={cx} y={cy + 3} className="comp-label comp-label-small" textAnchor="middle">M</text>
          {c.inputs?.map((label, i) => {
            const n = c.inputs!.length;
            const y = c.y + (c.h * (i + 1)) / (n + 1) + 3;
            return <text key={label} x={c.x + 3} y={y} className="mux-input" textAnchor="start">{c.id === 'muxPcInc' ? label : i}</text>;
          })}
        </g>
      );
    case 'alu': {
      const { x, y, w, h } = c;
      const d = `M${x} ${y} L${x + w} ${y + h * 0.23} L${x + w} ${y + h * 0.77} L${x} ${y + h} L${x} ${y + h * 0.62} L${x + w * 0.22} ${y + h * 0.5} L${x} ${y + h * 0.38} Z`;
      return (
        <g className={className}>
          <path d={d} className="comp-body" />
          <text x={x + w * 0.58} y={cy + 4} className="comp-label" textAnchor="middle">{c.label}</text>
        </g>
      );
    }
    case 'adder': {
      const { x, y, w, h } = c;
      const d = `M${x} ${y} L${x + w} ${y + h * 0.25} L${x + w} ${y + h * 0.75} L${x} ${y + h} L${x} ${y + h * 0.62} L${x + w * 0.25} ${y + h * 0.5} L${x} ${y + h * 0.38} Z`;
      return (
        <g className={className}>
          <path d={d} className="comp-body" />
          <text x={x + w * 0.58} y={cy + 4} className="comp-label comp-label-small" textAnchor="middle">{c.label}</text>
        </g>
      );
    }
    case 'reg':
      return (
        <g className={className}>
          <rect x={c.x} y={c.y} width={c.w} height={c.h} rx={3} className="comp-body" />
          <text transform={`translate(${cx + 4} ${c.y + 14}) rotate(90)`} className="reg-label" textAnchor="start">{c.label}</text>
          {content && (
            <text transform={`translate(${cx + 4} ${c.y + c.h - 12}) rotate(-90)`} className="reg-content" textAnchor="start">{content}</text>
          )}
        </g>
      );
    case 'const':
      return (
        <g className={className}>
          <text x={cx} y={cy + 4} className="comp-label comp-label-small" textAnchor="middle">{c.label}</text>
        </g>
      );
    case 'logic':
    case 'box':
    default:
      return (
        <g className={className}>
          <rect x={c.x} y={c.y} width={c.w} height={c.h} rx={6} className="comp-body" />
          <text x={cx} y={c.sub ? cy - 2 : cy + 4} className={`comp-label ${c.kind === 'logic' ? 'comp-label-small' : ''}`} textAnchor="middle">{c.label}</text>
          {c.sub && <text x={cx} y={cy + 12} className="comp-sub" textAnchor="middle">{c.sub}</text>}
        </g>
      );
  }
}
