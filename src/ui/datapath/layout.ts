import type { StageName } from '@/core/sim/narrate';

export type Point = readonly [number, number];

export type CompKind = 'box' | 'mux' | 'alu' | 'adder' | 'reg' | 'logic' | 'const';

export interface Component {
  readonly id: string;
  /** Key into the explanation rules. Defaults to id. */
  readonly explain?: string;
  readonly kind: CompKind;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly label: string;
  readonly sub?: string;
  readonly stage: StageName;
  /** Labels for mux inputs, top to bottom. */
  readonly inputs?: readonly string[];
}

export interface Wire {
  readonly id: string;
  readonly explain: string;
  readonly kind: 'data' | 'control';
  readonly stage: StageName;
  readonly segments: readonly (readonly Point[])[];
  /** Where to render the value badge when values are shown. */
  readonly valueAt?: Point;
  readonly label?: { readonly at: Point; readonly text: string; readonly anchor?: 'start' | 'middle' | 'end' };
}

export interface Layout {
  readonly width: number;
  readonly height: number;
  readonly components: readonly Component[];
  readonly wires: readonly Wire[];
  /** Stage column bands for the background, in order. */
  readonly bands: readonly { readonly stage: StageName; readonly x: number; readonly w: number }[];
}

export const STAGE_INDEX: Record<StageName, number> = { IF: 0, ID: 1, EX: 2, MEM: 3, WB: 4 };

export function pathFrom(points: readonly Point[]): string {
  return points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x} ${y}`).join(' ');
}

export function comp(
  id: string, kind: CompKind, x: number, y: number, w: number, h: number, label: string, stage: StageName,
  extra: Partial<Pick<Component, 'sub' | 'inputs' | 'explain'>> = {},
): Component {
  return { id, kind, x, y, w, h, label, stage, ...extra };
}

export function wire(
  id: string, kind: Wire['kind'], stage: StageName, segments: readonly (readonly Point[])[],
  extra: Partial<Pick<Wire, 'valueAt' | 'label' | 'explain'>> = {},
): Wire {
  return { id, explain: extra.explain ?? id, kind, stage, segments, valueAt: extra.valueAt, label: extra.label };
}
