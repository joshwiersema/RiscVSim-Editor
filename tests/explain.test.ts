import { describe, expect, it } from 'vitest';
import { assemble } from '../src/core/asm/assembler';
import { Machine } from '../src/core/sim/machine';
import { explainElement } from '../src/core/sim/explain';
import { narrate, STAGES } from '../src/core/sim/narrate';
import type { ModelKind } from '../src/core/sim/processor';
import { EXAMPLES } from '../src/ui/examples';
import { SINGLE_CYCLE_LAYOUT } from '../src/ui/datapath/singleCycle.layout';
import { PIPELINE_LAYOUT } from '../src/ui/datapath/pipeline.layout';

/**
 * Every element of every layout must produce a non-empty explanation for
 * every stage slot of every cycle of every example, in both models.
 */
describe('explanations cover every datapath element', () => {
  for (const model of ['single', 'pipeline'] as ModelKind[]) {
    const layout = model === 'single' ? SINGLE_CYCLE_LAYOUT : PIPELINE_LAYOUT;
    const ids = [...new Set([...layout.components.map((c) => c.explain ?? c.id), ...layout.wires.map((w) => w.explain)])];

    it(`${model}: all ${ids.length} element ids explain without throwing`, () => {
      for (const ex of EXAMPLES) {
        const p = assemble(ex.source);
        expect(p.errors).toEqual([]);
        const m = new Machine(p, model);
        let guard = 0;
        while (!m.finished && guard++ < 400) {
          if (m.blocked) m.provideInput('7');
          const trace = m.step()!;
          for (const stage of STAGES) {
            const slot = trace.stages[stage];
            for (const id of ids) {
              const e = explainElement(id, { model, slot, hazard: trace.hazard, forwardingEnabled: true });
              expect(e.title.length, `${id} title`).toBeGreaterThan(0);
              expect(e.why.length, `${id} why`).toBeGreaterThan(0);
              expect(e.why).not.toMatch(/undefined|NaN/);
            }
          }
          const story = narrate(trace);
          expect(story.stages.length).toBe(5);
          for (const s of story.stages) for (const l of s.lines) expect(l).not.toMatch(/undefined|NaN/);
        }
        // The I/O example polls the switches forever by design.
        if (ex.id !== 'io') expect(m.finished, `${ex.id} should finish`).toBe(true);
      }
    });
  }

  it('describes ALUSrc for an I-type instruction', () => {
    const p = assemble('addi t0, t1, -5');
    const m = new Machine(p, 'single');
    const trace = m.step()!;
    const e = explainElement('muxAluB', { model: 'single', slot: trace.stages.EX, hazard: trace.hazard, forwardingEnabled: true });
    expect(e.active).toBe(true);
    expect(e.value).toContain('immediate');
    expect(e.why).toContain('addi');
    expect(e.why).toContain('-5');
  });

  it('marks data memory inactive for an R-type instruction', () => {
    const p = assemble('add t0, t1, t2');
    const m = new Machine(p, 'single');
    const trace = m.step()!;
    const e = explainElement('dmem', { model: 'single', slot: trace.stages.MEM, hazard: trace.hazard, forwardingEnabled: true });
    expect(e.active).toBe(false);
    expect(e.why).toMatch(/not a load or store/);
  });
});
