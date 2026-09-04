import { describe, expect, it } from 'vitest';
import { addressFields, cacheAccess, emptyCache, hitRate, type CacheConfig } from '../src/core/cache/cache';
import { assemble } from '../src/core/asm/assembler';
import { Machine } from '../src/core/sim/machine';

const dm: CacheConfig = { sets: 4, ways: 1, blockWords: 4, replacement: 'LRU', writePolicy: 'WRITE_BACK', writeAllocate: true };

function run(cfg: CacheConfig, addrs: [number, boolean][]) {
  let s = emptyCache(cfg);
  const hits: boolean[] = [];
  for (const [a, w] of addrs) { const r = cacheAccess(cfg, s, a, w); s = r.state; hits.push(r.access.hit); }
  return { s, hits };
}

describe('cache model', () => {
  it('splits addresses into tag/set/offset', () => {
    const f = addressFields(dm, 0x1234);
    expect(f.offsetBits).toBe(4);
    expect(f.setBits).toBe(2);
    expect(f.offset).toBe(0x4);
    expect(f.set).toBe(3);
    expect(f.tag).toBe(0x1234 >>> 6);
  });

  it('direct-mapped: miss, then hit within the block, then conflict eviction', () => {
    const { s, hits } = run(dm, [[0x100, false], [0x104, false], [0x10c, false], [0x140, false], [0x100, false]]);
    expect(hits).toEqual([false, true, true, false, false]);
    expect(s.stats.evictions).toBe(2);
    expect(s.stats.writebacks).toBe(0);
    expect(hitRate(s.stats)).toBeCloseTo(0.4);
  });

  it('2-way LRU keeps the most recently used line', () => {
    const cfg: CacheConfig = { ...dm, ways: 2 };
    // Three blocks mapping to the same set: A, B, A, C -> C evicts B (LRU), A still hits.
    const { hits } = run(cfg, [[0x100, false], [0x140, false], [0x100, false], [0x180, false], [0x100, false], [0x140, false]]);
    expect(hits).toEqual([false, false, true, false, true, false]);
  });

  it('FIFO evicts the oldest line regardless of use', () => {
    const cfg: CacheConfig = { ...dm, ways: 2, replacement: 'FIFO' };
    const { hits } = run(cfg, [[0x100, false], [0x140, false], [0x100, false], [0x180, false], [0x100, false]]);
    expect(hits).toEqual([false, false, true, false, false]);
  });

  it('write-back marks dirty and writes back on eviction; write-through writes immediately', () => {
    const wb = run(dm, [[0x100, true], [0x140, false]]);
    expect(wb.s.stats.writebacks).toBe(1);
    const wt = run({ ...dm, writePolicy: 'WRITE_THROUGH' }, [[0x100, true], [0x140, false]]);
    expect(wt.s.stats.writebacks).toBe(1);
    expect(wt.s.lines.flat().some((l) => l.dirty)).toBe(false);
  });

  it('no-write-allocate sends write misses straight to memory', () => {
    const cfg: CacheConfig = { ...dm, writePolicy: 'WRITE_THROUGH', writeAllocate: false };
    const { s, hits } = run(cfg, [[0x100, true], [0x100, false]]);
    expect(hits).toEqual([false, false]);
    expect(s.lines[0][0].valid).toBe(true); // allocated by the read
  });

  it('is driven by the machine and restored on undo', () => {
    const p = assemble('.data\nv: .word 1,2,3,4,5,6,7,8\n.text\nla t0, v\nlw t1, 0(t0)\nlw t2, 4(t0)\nlw t3, 32(t0)');
    const m = new Machine(p, 'single');
    while (!m.finished) m.step();
    expect(m.icache.stats.misses).toBeGreaterThan(0);
    expect(m.dcache.stats.reads).toBe(3);
    expect(m.dcache.stats.hits).toBe(1); // second lw hits the same block
    const snapshot = m.dcache;
    m.undo();
    expect(m.dcache.stats.reads).toBe(2);
    m.step();
    expect(m.dcache).toEqual(snapshot);
  });
});
