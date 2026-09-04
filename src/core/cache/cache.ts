/**
 * Configurable set-associative cache model used for the L1 instruction and
 * data caches. Timing is not modelled; the cache tracks hits, misses,
 * evictions and write-backs so students can compare organisations.
 */
export type Replacement = 'LRU' | 'FIFO' | 'RANDOM';
export type WritePolicy = 'WRITE_BACK' | 'WRITE_THROUGH';

export interface CacheConfig {
  /** Number of sets (power of two). */
  readonly sets: number;
  /** Lines per set (associativity). */
  readonly ways: number;
  /** Words (4 bytes) per block (power of two). */
  readonly blockWords: number;
  readonly replacement: Replacement;
  readonly writePolicy: WritePolicy;
  readonly writeAllocate: boolean;
}

export const DEFAULT_ICACHE: CacheConfig = { sets: 8, ways: 2, blockWords: 4, replacement: 'LRU', writePolicy: 'WRITE_BACK', writeAllocate: true };
export const DEFAULT_DCACHE: CacheConfig = { sets: 8, ways: 2, blockWords: 4, replacement: 'LRU', writePolicy: 'WRITE_BACK', writeAllocate: true };

export interface CacheLine {
  readonly valid: boolean;
  readonly dirty: boolean;
  readonly tag: number;
  /** Monotonic counters used by the replacement policies. */
  readonly lastUsed: number;
  readonly insertedAt: number;
}

export interface CacheStats {
  readonly reads: number;
  readonly writes: number;
  readonly hits: number;
  readonly misses: number;
  readonly evictions: number;
  readonly writebacks: number;
}

export interface CacheAccess {
  readonly addr: number;
  readonly write: boolean;
  readonly hit: boolean;
  readonly set: number;
  readonly way: number;
  readonly tag: number;
  readonly offset: number;
  /** Line that was evicted to make room, if any. */
  readonly evicted: { readonly tag: number; readonly dirty: boolean } | null;
  /** Whether a block was brought in from memory. */
  readonly allocated: boolean;
}

export interface CacheState {
  readonly lines: readonly (readonly CacheLine[])[];
  readonly stats: CacheStats;
  readonly clock: number;
  readonly last: CacheAccess | null;
}

const EMPTY_LINE: CacheLine = { valid: false, dirty: false, tag: 0, lastUsed: 0, insertedAt: 0 };
const ZERO_STATS: CacheStats = { reads: 0, writes: 0, hits: 0, misses: 0, evictions: 0, writebacks: 0 };

export function log2(v: number): number {
  return Math.round(Math.log2(v));
}

export function emptyCache(cfg: CacheConfig): CacheState {
  const lines = Array.from({ length: cfg.sets }, () => Array.from({ length: cfg.ways }, () => EMPTY_LINE));
  return { lines, stats: ZERO_STATS, clock: 0, last: null };
}

/** Address bit split for a configuration. */
export function addressFields(cfg: CacheConfig, addr: number): { tag: number; set: number; offset: number; offsetBits: number; setBits: number } {
  const offsetBits = log2(cfg.blockWords) + 2;
  const setBits = log2(cfg.sets);
  const offset = addr & ((1 << offsetBits) - 1);
  const set = (addr >>> offsetBits) & ((1 << setBits) - 1);
  const tag = addr >>> (offsetBits + setBits);
  return { tag, set, offset, offsetBits, setBits };
}

/** Deterministic pseudo-random for RANDOM replacement so runs are reproducible. */
function pseudoRandom(seed: number): number {
  let x = (seed ^ 0x9e3779b9) >>> 0;
  x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
  return x;
}

function chooseVictim(cfg: CacheConfig, set: readonly CacheLine[], clock: number): number {
  const empty = set.findIndex((l) => !l.valid);
  if (empty >= 0) return empty;
  switch (cfg.replacement) {
    case 'LRU': return set.reduce((best, l, i) => (l.lastUsed < set[best].lastUsed ? i : best), 0);
    case 'FIFO': return set.reduce((best, l, i) => (l.insertedAt < set[best].insertedAt ? i : best), 0);
    case 'RANDOM': return pseudoRandom(clock) % set.length;
  }
}

/** Perform one access and return the new state plus what happened. */
export function cacheAccess(cfg: CacheConfig, state: CacheState, addr: number, write: boolean): { state: CacheState; access: CacheAccess } {
  const { tag, set, offset } = addressFields(cfg, addr);
  const clock = state.clock + 1;
  const lines = state.lines[set];
  let way = lines.findIndex((l) => l.valid && l.tag === tag);
  const hit = way >= 0;
  let evicted: CacheAccess['evicted'] = null;
  let allocated = false;
  let writebacks = state.stats.writebacks;
  let evictions = state.stats.evictions;
  const newSet = [...lines];

  if (hit) {
    const l = newSet[way];
    newSet[way] = { ...l, lastUsed: clock, dirty: l.dirty || (write && cfg.writePolicy === 'WRITE_BACK') };
    if (write && cfg.writePolicy === 'WRITE_THROUGH') writebacks++;
  } else if (!write || cfg.writeAllocate) {
    way = chooseVictim(cfg, lines, clock);
    const victim = lines[way];
    if (victim.valid) {
      evicted = { tag: victim.tag, dirty: victim.dirty };
      evictions++;
      if (victim.dirty) writebacks++;
    }
    allocated = true;
    newSet[way] = { valid: true, dirty: write && cfg.writePolicy === 'WRITE_BACK', tag, lastUsed: clock, insertedAt: clock };
    if (write && cfg.writePolicy === 'WRITE_THROUGH') writebacks++;
  } else {
    // Write miss, no-allocate: goes straight to memory.
    writebacks++;
    way = -1;
  }

  const newLines = state.lines.map((s, i) => (i === set ? newSet : s));
  const stats: CacheStats = {
    reads: state.stats.reads + (write ? 0 : 1),
    writes: state.stats.writes + (write ? 1 : 0),
    hits: state.stats.hits + (hit ? 1 : 0),
    misses: state.stats.misses + (hit ? 0 : 1),
    evictions,
    writebacks,
  };
  const access: CacheAccess = { addr: addr >>> 0, write, hit, set, way, tag, offset, evicted, allocated };
  return { state: { lines: newLines, stats, clock, last: access }, access };
}

export function hitRate(s: CacheStats): number {
  const n = s.hits + s.misses;
  return n === 0 ? 0 : s.hits / n;
}

export function cacheSizeBytes(cfg: CacheConfig): number {
  return cfg.sets * cfg.ways * cfg.blockWords * 4;
}
