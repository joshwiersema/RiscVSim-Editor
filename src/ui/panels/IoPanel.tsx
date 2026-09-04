import { CHAR_OUT_BASE, CYCLES_BASE, DPAD_BASE, LED_BASE, SWITCH_BASE } from '@/core/io/devices';
import { hex32 } from '@/core/util/format';
import { useStore } from '../state/store';

/** Memory-mapped devices: LED matrix, switches, d-pad, character output, cycle counter. */
export function IoPanel() {
  const machine = useStore((s) => s.machine);
  const tick = useStore((s) => s.tick);
  const touch = useStore((s) => s.touchDevices);
  void tick;
  const dev = machine?.core.devices;

  if (!dev) return <div className="panel-empty">Assemble a program to interact with the memory-mapped devices. See Help for the address map.</div>;

  const { leds, switches, dpad } = dev;
  const toggleBit = (d: typeof switches, bit: number) => { d.value ^= 1 << bit; touch(); };

  return (
    <div className="io">
      <div className="io-row">
        <section className="io-card">
          <div className="io-title">LED matrix <span className="mono muted">{hex32(LED_BASE)}</span></div>
          <div className="led-grid" style={{ gridTemplateColumns: `repeat(${leds.width}, 1fr)` }}>
            {Array.from(leds.pixels, (px, i) => (
              <div key={i} className="led" style={{ background: px ? `#${(px & 0xffffff).toString(16).padStart(6, '0')}` : undefined }} title={`LED ${i} (${i % leds.width}, ${Math.floor(i / leds.width)}) @ ${hex32(LED_BASE + i * 4)} = ${hex32(px)}`} />
            ))}
          </div>
          <div className="muted io-hint">One word per LED, 0x00RRGGBB, row-major. <code>sw</code> a colour to light one.</div>
        </section>

        <div className="io-col">
          <section className="io-card">
            <div className="io-title">Switches <span className="mono muted">{hex32(SWITCH_BASE)}</span></div>
            <div className="switches">
              {switches.bitNames.map((n, i) => (
                <button key={n} className={`switch ${switches.value & (1 << i) ? 'is-on' : ''}`} onClick={() => toggleBit(switches, i)} title={`bit ${i}`}>
                  <i /><span>{n}</span>
                </button>
              ))}
            </div>
            <div className="muted io-hint">value = <span className="mono">{hex32(switches.value)}</span></div>
          </section>

          <section className="io-card">
            <div className="io-title">D-pad <span className="mono muted">{hex32(DPAD_BASE)}</span></div>
            <div className="dpad">
              {[['UP', 0, 'up'], ['LEFT', 2, 'left'], ['CENTER', 4, 'center'], ['RIGHT', 3, 'right'], ['DOWN', 1, 'down']].map(([label, bit, pos]) => (
                <button key={label as string} className={`dpad-btn dpad-${pos} ${dpad.value & (1 << (bit as number)) ? 'is-on' : ''}`} onClick={() => toggleBit(dpad, bit as number)} title={`${label} = bit ${bit}`}>
                  {label === 'CENTER' ? '●' : label === 'UP' ? '▲' : label === 'DOWN' ? '▼' : label === 'LEFT' ? '◀' : '▶'}
                </button>
              ))}
            </div>
            <div className="muted io-hint">Click to latch a button on/off. value = <span className="mono">{hex32(dpad.value)}</span></div>
          </section>

          <section className="io-card">
            <div className="io-title">Other devices</div>
            <table className="table">
              <tbody>
                <tr><td className="mono">{hex32(CHAR_OUT_BASE)}</td><td>character out</td><td className="muted">write a byte → Console</td></tr>
                <tr><td className="mono">{hex32(CYCLES_BASE)}</td><td>cycle counter</td><td className="mono">{dev.cycles.cycles}</td></tr>
              </tbody>
            </table>
          </section>
        </div>
      </div>
    </div>
  );
}
