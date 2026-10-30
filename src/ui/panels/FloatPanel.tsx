import { useMemo, useRef, useState } from 'react';
import { readIndices } from '@/core/isa/operands';
import { FP_ABI_NAMES, FP_REG_BASE, fpRegisterRole } from '@/core/isa/registers';
import { frmOf } from '@/core/sim/csr';
import { retiredIn } from '@/core/sim/stats';
import { FLAG_INFO, formatFloat, RM_MNEMONICS, roundingModeLabel } from '@/core/fp/format';
import { hex32 } from '@/core/util/format';
import { useStore } from '../state/store';
import { Ieee754Card } from './Ieee754Card';

const FP_COUNT = 32;
const DEFAULT_FOCUS = 10; // fa0, where results usually land

/** f0..f31, the fcsr (rounding mode + sticky flags), and an IEEE-754 breakdown. */
export function FloatPanel() {
  const machine = useStore((s) => s.machine);
  const tick = useStore((s) => s.tick);
  const trace = useStore((s) => s.trace);
  const [pinned, setPinned] = useState<number | null>(null);
  const lastWritten = useRef<number | null>(null);

  const regs = useMemo(
    () => (machine ? machine.core.regs.slice(FP_REG_BASE, FP_REG_BASE + FP_COUNT) : new Array<number>(FP_COUNT).fill(0)),
    [machine, tick],
  );
  const fcsr = machine?.core.fcsr ?? 0;
  const changed = useMemo(() => new Set((trace?.regWrites ?? []).filter((w) => w.reg >= FP_REG_BASE).map((w) => w.reg - FP_REG_BASE)), [trace]);
  const reading = useMemo(() => {
    const t = trace?.model === 'single' ? trace.stages.EX.trace : trace?.stages.ID.trace;
    return new Set(t ? readIndices(t.instr).filter((r) => r >= FP_REG_BASE).map((r) => r - FP_REG_BASE) : []);
  }, [trace]);
  const raised = trace ? retiredIn(trace)?.fpFlags ?? 0 : 0;

  if (changed.size) lastWritten.current = Math.max(...changed);
  if (!machine) lastWritten.current = null;
  const focus = pinned ?? lastWritten.current ?? DEFAULT_FOCUS;

  return (
    <div className="float-panel">
      <FcsrStrip fcsr={fcsr} raised={raised} />
      <div className="panel-scroll">
        <table className="table regs fregs">
          <thead>
            <tr><th>reg</th><th>abi</th><th className="num">value</th><th className="num">bits</th></tr>
          </thead>
          <tbody>
            {regs.map((v, i) => (
              <tr
                key={i}
                className={`${changed.has(i) ? 'is-changed' : ''} ${reading.has(i) ? 'is-read' : ''} ${i === focus ? 'is-selected' : ''}`}
                title={`${fpRegisterRole(i)} Click to inspect its bits.`}
                onClick={() => setPinned(pinned === i ? null : i)}
              >
                <td>f{i}</td>
                <td>{FP_ABI_NAMES[i]}</td>
                <td className="num mono">{formatFloat(v)}</td>
                <td className="num mono muted">{hex32(v)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Ieee754Card bits={regs[focus]} label={`f${focus} (${FP_ABI_NAMES[focus]})`} pinned={pinned !== null} onUnpin={() => setPinned(null)} />
    </div>
  );
}

function FcsrStrip({ fcsr, raised }: { fcsr: number; raised: number }) {
  const frm = frmOf(fcsr);
  return (
    <div className="fcsr">
      <span className="fcsr-item" title="Floating-point control and status register: frm in bits 7:5, fflags in bits 4:0">
        <span className="fcsr-label">fcsr</span><code>0x{fcsr.toString(16).padStart(2, '0')}</code>
      </span>
      <span className="fcsr-item" title={`Dynamic rounding mode used by instructions whose rm is dyn: ${roundingModeLabel(frm)}`}>
        <span className="fcsr-label">frm</span><code>{RM_MNEMONICS[frm] || `?${frm}`}</code>
      </span>
      <span className="fcsr-flags" aria-label="Accrued exception flags">
        {FLAG_INFO.map((f) => {
          const set = (fcsr & f.bit) !== 0;
          const fresh = (raised & f.bit) !== 0;
          return (
            <span
              key={f.short}
              className={`fflag ${set ? 'is-set' : ''} ${fresh ? 'is-new' : ''}`}
              title={`${f.short}: ${f.name}. ${set ? 'Set — flags are sticky until software clears them (e.g. fsflags x0).' : 'Clear.'}${fresh ? ' Raised by the instruction that just retired.' : ''}`}
            >
              {f.short}
            </span>
          );
        })}
      </span>
    </div>
  );
}
