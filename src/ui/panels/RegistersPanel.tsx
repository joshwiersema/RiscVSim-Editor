import { useMemo } from 'react';
import { ABI_NAMES, REGISTER_ROLES } from '@/core/isa/registers';
import { formatValue } from '@/core/util/format';
import { useStore } from '../state/store';

export function RegistersPanel() {
  const machine = useStore((s) => s.machine);
  const tick = useStore((s) => s.tick);
  const trace = useStore((s) => s.trace);
  const base = useStore((s) => s.base);

  const regs = useMemo(() => (machine ? [...machine.core.regs] : new Array<number>(32).fill(0)), [machine, tick]);
  const changed = useMemo(() => new Set(trace?.regWrites.map((w) => w.reg) ?? []), [trace]);
  const reading = useMemo(() => {
    const set = new Set<number>();
    const t = trace?.model === 'single' ? trace.stages.EX.trace : trace?.stages.ID.trace;
    if (t && t.instr.format !== 'U' && t.instr.format !== 'J' && !t.ctrl.system) set.add(t.instr.rs1);
    if (t && (t.instr.format === 'R' || t.instr.format === 'S' || t.instr.format === 'B')) set.add(t.instr.rs2);
    return set;
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
