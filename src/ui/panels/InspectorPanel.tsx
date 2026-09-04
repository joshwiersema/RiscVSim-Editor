import { useMemo } from 'react';
import { bits, disassemble } from '@/core/isa/decode';
import type { Format } from '@/core/isa/instructions';
import { regName } from '@/core/isa/registers';
import type { InstrTrace } from '@/core/sim/types';
import { hex32 } from '@/core/util/format';
import { explainFor } from '../datapath/useExplain';
import { renderInline } from '../datapath/Tooltip';
import { useStore } from '../state/store';

interface Field { readonly name: string; readonly hi: number; readonly lo: number; readonly cls: string }

const FIELDS: Record<Format, readonly Field[]> = {
  R: [{ name: 'funct7', hi: 31, lo: 25, cls: 'f-funct' }, { name: 'rs2', hi: 24, lo: 20, cls: 'f-rs2' }, { name: 'rs1', hi: 19, lo: 15, cls: 'f-rs1' }, { name: 'funct3', hi: 14, lo: 12, cls: 'f-funct' }, { name: 'rd', hi: 11, lo: 7, cls: 'f-rd' }, { name: 'opcode', hi: 6, lo: 0, cls: 'f-op' }],
  I: [{ name: 'imm[11:0]', hi: 31, lo: 20, cls: 'f-imm' }, { name: 'rs1', hi: 19, lo: 15, cls: 'f-rs1' }, { name: 'funct3', hi: 14, lo: 12, cls: 'f-funct' }, { name: 'rd', hi: 11, lo: 7, cls: 'f-rd' }, { name: 'opcode', hi: 6, lo: 0, cls: 'f-op' }],
  S: [{ name: 'imm[11:5]', hi: 31, lo: 25, cls: 'f-imm' }, { name: 'rs2', hi: 24, lo: 20, cls: 'f-rs2' }, { name: 'rs1', hi: 19, lo: 15, cls: 'f-rs1' }, { name: 'funct3', hi: 14, lo: 12, cls: 'f-funct' }, { name: 'imm[4:0]', hi: 11, lo: 7, cls: 'f-imm' }, { name: 'opcode', hi: 6, lo: 0, cls: 'f-op' }],
  B: [{ name: 'imm[12|10:5]', hi: 31, lo: 25, cls: 'f-imm' }, { name: 'rs2', hi: 24, lo: 20, cls: 'f-rs2' }, { name: 'rs1', hi: 19, lo: 15, cls: 'f-rs1' }, { name: 'funct3', hi: 14, lo: 12, cls: 'f-funct' }, { name: 'imm[4:1|11]', hi: 11, lo: 7, cls: 'f-imm' }, { name: 'opcode', hi: 6, lo: 0, cls: 'f-op' }],
  U: [{ name: 'imm[31:12]', hi: 31, lo: 12, cls: 'f-imm' }, { name: 'rd', hi: 11, lo: 7, cls: 'f-rd' }, { name: 'opcode', hi: 6, lo: 0, cls: 'f-op' }],
  J: [{ name: 'imm[20|10:1|11|19:12]', hi: 31, lo: 12, cls: 'f-imm' }, { name: 'rd', hi: 11, lo: 7, cls: 'f-rd' }, { name: 'opcode', hi: 6, lo: 0, cls: 'f-op' }],
};

/** Right-hand inspector: pinned/hovered explanation and the current instruction's encoding. */
export function InspectorPanel() {
  const trace = useStore((s) => s.trace);
  const model = useStore((s) => s.model);
  const forwarding = useStore((s) => s.options.forwarding);
  const hover = useStore((s) => s.hover);
  const pinned = useStore((s) => s.pinned);
  const setPinned = useStore((s) => s.setPinned);

  const target = hover ?? pinned;
  const info = useMemo(() => (target ? explainFor(trace, model, forwarding, target.explain, target.stage) : null), [target, trace, model, forwarding]);

  const focusStage = target?.stage ?? (model === 'single' ? 'EX' : 'EX');
  const t: InstrTrace | null = trace?.stages[focusStage].trace ?? (model === 'pipeline' ? firstInstr(trace) : null);

  return (
    <div className="inspector">
      <div className="inspector-section">
        <div className="section-title">
          <span>Explanation</span>
          {pinned && <button className="btn btn-ghost btn-xs" onClick={() => setPinned(null)}>unpin</button>}
        </div>
        {info && target ? (
          <div className={`explain kind-${info.kind} ${info.active ? 'is-active' : 'is-inactive'}`}>
            <div className="explain-head"><strong>{info.title}</strong><span className="stage-chip">{target.stage}</span>{pinned && !hover && <span className="pin-chip">pinned</span>}</div>
            {info.value && <div className="explain-value mono">{info.value}</div>}
            <p>{renderInline(info.why)}</p>
          </div>
        ) : (
          <p className="muted">Hover a wire, mux, or block in the datapath to learn what it does for the current instruction and why. Click to pin it here.</p>
        )}
      </div>

      <div className="inspector-section">
        <div className="section-title"><span>Instruction{model === 'pipeline' && t ? ` in ${focusStage}` : ''}</span></div>
        {t ? <InstructionCard t={t} /> : <p className="muted">No instruction yet.</p>}
      </div>
    </div>
  );
}

function firstInstr(trace: ReturnType<typeof useStore.getState>['trace']): InstrTrace | null {
  if (!trace) return null;
  for (const s of ['EX', 'ID', 'IF', 'MEM', 'WB'] as const) { const t = trace.stages[s].trace; if (t) return t; }
  return null;
}

function InstructionCard({ t }: { t: InstrTrace }) {
  const def = t.instr.def;
  const fmt = t.instr.format;
  const fields = fmt ? FIELDS[fmt] : [];
  return (
    <div className="instr-card">
      <code className="instr-asm">{disassemble(t.instr, t.pc)}</code>
      <div className="instr-meta mono">{hex32(t.pc)} · {hex32(t.instr.word)}</div>
      {def && <p className="instr-summary"><b>{def.syntax}</b> — {def.summary}</p>}
      {fmt && (
        <div className="bitfields">
          {fields.map((f) => {
            const v = bits(t.instr.word, f.hi, f.lo);
            const width = f.hi - f.lo + 1;
            return (
              <div key={f.name} className={`bitfield ${f.cls}`} style={{ flexGrow: width }} title={`${f.name}: bits ${f.hi}:${f.lo} = ${v}`}>
                <span className="bitfield-name">{f.name}</span>
                <span className="bitfield-bits">{v.toString(2).padStart(width, '0')}</span>
                <span className="bitfield-val">{fieldValue(f, v, t)}</span>
              </div>
            );
          })}
        </div>
      )}
      {fmt && (
        <div className="instr-fields mono muted">
          {fmt !== 'U' && fmt !== 'J' && <span>rs1={regName(t.instr.rs1)} </span>}
          {(fmt === 'R' || fmt === 'S' || fmt === 'B') && <span>rs2={regName(t.instr.rs2)} </span>}
          {fmt !== 'S' && fmt !== 'B' && <span>rd={regName(t.instr.rd)} </span>}
          {fmt !== 'R' && <span>imm={t.imm} </span>}
        </div>
      )}
    </div>
  );
}

function fieldValue(f: Field, v: number, t: InstrTrace): string {
  if (f.name === 'rd' || f.name === 'rs1' || f.name === 'rs2') return regName(v);
  if (f.name === 'opcode') return t.instr.def?.name ?? '?';
  if (f.name.startsWith('imm')) return String(t.imm);
  return String(v);
}
