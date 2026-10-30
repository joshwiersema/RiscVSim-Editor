import { useMemo } from 'react';
import { readIndices } from '@/core/isa/operands';
import { ABI_NAMES, FP_REG_BASE, REGISTER_ROLES } from '@/core/isa/registers';
import { formatValue } from '@/core/util/format';
import { useStore } from '../state/store';

export function RegistersPanel() {
  const machine = useStore((s) => s.machine);
  const tick = useStore((s) => s.tick);
  const trace = useStore((s) => s.trace);
  const base = useStore((s) => s.base);

  const regs = useMemo(() => (machine ? machine.core.regs.slice(0, FP_REG_BASE) : new Array<number>(FP_REG_BASE).fill(0)), [machine, tick]);
  const changed = useMemo(() => new Set(trace?.regWrites.map((w) => w.reg) ?? []), [trace]);
  const reading = useMemo(() => {
    const t = trace?.model === 'single' ? trace.stages.EX.trace : trace?.stages.ID.trace;
    return new Set(t ? readIndices(t.instr).filter((r) => r < FP_REG_BASE) : []);
  }, [trace]);

  return (
    <div className="panel-scroll">
      <table className="table regs">
        <thead>
          <tr><th>reg</th><th>abi</th><th className="num">value</th></tr>
        </thead>
        <tbody>
          <tr className="pc-row">
            <td>pc</td><td /><td className="num mono">{machine ? formatValue(machine.core.pc, base === 'dec' || base === 'udec' ? base : 'hex') : '–'}</td>
          </tr>
          {regs.map((v, i) => (
            <tr key={i} className={`${changed.has(i) ? 'is-changed' : ''} ${reading.has(i) ? 'is-read' : ''}`} title={REGISTER_ROLES[i]}>
              <td>x{i}</td>
              <td>{ABI_NAMES[i]}</td>
              <td className="num mono">{formatValue(v, base)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
