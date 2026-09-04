import { useCallback } from 'react';
import { explainElement, type Explanation } from '@/core/sim/explain';
import type { StageName } from '@/core/sim/narrate';
import type { CycleTrace } from '@/core/sim/types';
import { useStore } from '../state/store';

const IDLE: Explanation = { title: '', value: '', why: 'Assemble and step to see the datapath in action.', active: false, kind: 'component' };

/** Returns a function that explains any element for the current trace. */
export function useExplainer(): (explain: string, stage: StageName) => Explanation {
  const trace = useStore((s) => s.trace);
  const model = useStore((s) => s.model);
  const forwarding = useStore((s) => s.options.forwarding);
  return useCallback((explain: string, stage: StageName) => explainFor(trace, model, forwarding, explain, stage), [trace, model, forwarding]);
}

export function explainFor(trace: CycleTrace | null, model: 'single' | 'pipeline', forwarding: boolean, explain: string, stage: StageName): Explanation {
  if (!trace) return IDLE;
  return explainElement(explain, { model, slot: trace.stages[stage], hazard: trace.hazard, forwardingEnabled: forwarding });
}
