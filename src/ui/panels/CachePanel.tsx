import { useState } from 'react';
import { addressFields, cacheSizeBytes, hitRate, type CacheConfig, type CacheState } from '@/core/cache/cache';
import { hex32 } from '@/core/util/format';
import { useStore } from '../state/store';

type Which = 'icache' | 'dcache';

/** L1 cache configuration, statistics, and a live view of the cache lines. */
export function CachePanel() {
  const machine = useStore((s) => s.machine);
  const tick = useStore((s) => s.tick);
  const caches = useStore((s) => s.caches);
  const setCaches = useStore((s) => s.setCaches);
  const [which, setWhich] = useState<Which>('dcache');
  void tick;

  const cfg = caches[which];
  const state: CacheState | null = machine ? machine[which] : null;
  const update = (patch: Partial<CacheConfig>) => setCaches({ ...caches, [which]: { ...cfg, ...patch } });
  const pow2 = [1, 2, 4, 8, 16, 32, 64, 128, 256];

  return (
    <div className="cache">
      <div className="cache-bar">
        <div className="segmented">
          <button className={which === 'icache' ? 'is-on' : ''} onClick={() => setWhich('icache')}>L1 instruction</button>
          <button className={which === 'dcache' ? 'is-on' : ''} onClick={() => setWhich('dcache')}>L1 data</button>
        </div>
        <label className="field">sets<select className="select select-sm" value={cfg.sets} onChange={(e) => update({ sets: Number(e.target.value) })}>{pow2.map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
        <label className="field">ways<select className="select select-sm" value={cfg.ways} onChange={(e) => update({ ways: Number(e.target.value) })}>{[1, 2, 4, 8].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
        <label className="field">block<select className="select select-sm" value={cfg.blockWords} onChange={(e) => update({ blockWords: Number(e.target.value) })}>{[1, 2, 4, 8, 16].map((n) => <option key={n} value={n}>{n} word{n > 1 ? 's' : ''}</option>)}</select></label>
        <label className="field">replace<select className="select select-sm" value={cfg.replacement} onChange={(e) => update({ replacement: e.target.value as CacheConfig['replacement'] })}><option value="LRU">LRU</option><option value="FIFO">FIFO</option><option value="RANDOM">random</option></select></label>
        <label className="field">write<select className="select select-sm" value={cfg.writePolicy} onChange={(e) => update({ writePolicy: e.target.value as CacheConfig['writePolicy'] })}><option value="WRITE_BACK">write-back</option><option value="WRITE_THROUGH">write-through</option></select></label>
        <label className="check"><input type="checkbox" checked={cfg.writeAllocate} onChange={(e) => update({ writeAllocate: e.target.checked })} /> allocate on write</label>
        <span className="muted">{cacheSizeBytes(cfg)} B</span>
      </div>

      {!state ? (
        <div className="panel-empty">Assemble and step to watch the {which === 'icache' ? 'instruction' : 'data'} cache fill.</div>
      ) : (
        <div className="cache-body">
          <Stats state={state} />
          {state.last && <LastAccess cfg={cfg} state={state} />}
          <div className="panel-scroll">
            <table className="table cache-table mono">
              <thead>
                <tr><th>set</th>{Array.from({ length: cfg.ways }, (_, w) => <th key={w} colSpan={3}>way {w}</th>)}</tr>
                <tr><th />{Array.from({ length: cfg.ways }, (_, w) => [<th key={`v${w}`}>V</th>, <th key={`d${w}`}>D</th>, <th key={`t${w}`}>tag</th>])}</tr>
              </thead>
              <tbody>
                {state.lines.map((set, si) => (
                  <tr key={si} className={state.last?.set === si ? 'is-last-set' : ''}>
                    <td className="muted">{si}</td>
                    {set.map((l, wi) => {
                      const isLast = state.last?.set === si && state.last?.way === wi;
                      const cls = `cache-line ${l.valid ? 'is-valid' : ''} ${isLast ? (state.last?.hit ? 'is-hit' : 'is-miss') : ''}`;
                      return [
                        <td key={`v${wi}`} className={cls}>{l.valid ? 1 : 0}</td>,
                        <td key={`d${wi}`} className={cls}>{l.dirty ? 1 : 0}</td>,
                        <td key={`t${wi}`} className={cls} title={l.valid ? `block base ${hex32(l.tag << (Math.log2(cfg.sets) + Math.log2(cfg.blockWords) + 2))}` : ''}>{l.valid ? '0x' + l.tag.toString(16) : '–'}</td>,
                      ];
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Stats({ state }: { state: CacheState }) {
  const s = state.stats;
  const rate = hitRate(s);
  return (
    <div className="cache-stats">
      <div className="stat-tile"><span>accesses</span><b>{s.hits + s.misses}</b></div>
      <div className="stat-tile"><span>hits</span><b className="ok">{s.hits}</b></div>
      <div className="stat-tile"><span>misses</span><b className="bad">{s.misses}</b></div>
      <div className="stat-tile"><span>hit rate</span><b>{(rate * 100).toFixed(1)}%</b><i className="bar"><i style={{ width: `${rate * 100}%` }} /></i></div>
      <div className="stat-tile"><span>evictions</span><b>{s.evictions}</b></div>
      <div className="stat-tile"><span>writebacks</span><b>{s.writebacks}</b></div>
    </div>
  );
}

function LastAccess({ cfg, state }: { cfg: CacheConfig; state: CacheState }) {
  const a = state.last!;
  const f = addressFields(cfg, a.addr);
  const tagBits = 32 - f.setBits - f.offsetBits;
  const bin = (v: number, w: number) => (w === 0 ? '' : (v >>> 0).toString(2).padStart(w, '0'));
  return (
    <div className={`cache-last ${a.hit ? 'is-hit' : 'is-miss'}`}>
      <div>
        <b>{a.write ? 'write' : 'read'} {hex32(a.addr)}</b> → <b>{a.hit ? 'HIT' : 'MISS'}</b> in set {a.set}{a.way >= 0 ? `, way ${a.way}` : ' (not allocated)'}
        {a.evicted && <span className="muted"> · evicted tag 0x{a.evicted.tag.toString(16)}{a.evicted.dirty ? ' (dirty → written back)' : ''}</span>}
      </div>
      <div className="addr-split mono">
        <span className="addr-part f-imm" style={{ flexGrow: tagBits }} title={`tag: ${tagBits} bits`}><small>tag</small>{bin(f.tag, tagBits)}</span>
        <span className="addr-part f-rs1" style={{ flexGrow: Math.max(1, f.setBits) }} title={`set index: ${f.setBits} bits`}><small>index</small>{f.setBits ? bin(f.set, f.setBits) : '·'}</span>
        <span className="addr-part f-rd" style={{ flexGrow: f.offsetBits }} title={`block offset: ${f.offsetBits} bits`}><small>offset</small>{bin(f.offset, f.offsetBits)}</span>
      </div>
    </div>
  );
}
