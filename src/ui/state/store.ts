import { create } from 'zustand';
import { assemble } from '@/core/asm/assembler';
import type { Program } from '@/core/program';
import { programFromElf } from '@/core/elf/loadElf';
import { Machine, DEFAULT_CACHES, type CacheConfigs } from '@/core/sim/machine';
import { DEFAULT_OPTIONS, type ModelKind, type ProcessorOptions } from '@/core/sim/processor';
import type { CycleTrace } from '@/core/sim/types';
import type { StageName } from '@/core/sim/narrate';
import type { NumberBase } from '@/core/util/format';
import { EXAMPLES, C_EXAMPLE } from '../examples';
import { desktop, isDesktop } from '../desktop';
import { applyTheme, loadTheme, type ThemeMode } from './theme';

export const PHASE_COMPLETE = 4;

/** Views reachable from the activity rail; each fills the side panel. */
export type SidebarView = 'editor' | 'program' | 'memory' | 'cache' | 'io' | 'console' | 'stats' | 'reference';
const SIDEBAR_KEY = 'riscsim.sidebar';

function loadSidebar(): { view: SidebarView; open: boolean } {
  try {
    const raw = localStorage.getItem(SIDEBAR_KEY);
    if (raw) return { view: 'editor', open: true, ...(JSON.parse(raw) as Partial<{ view: SidebarView; open: boolean }>) };
  } catch { /* ignore */ }
  return { view: 'editor', open: true };
}

export interface HoverTarget {
  readonly explain: string;
  readonly stage: StageName;
  readonly x: number;
  readonly y: number;
}

export type PlayMode = 'cycle' | 'phase';
export type Language = 'asm' | 'c';
export type DialogKind = 'none' | 'help' | 'settings';

export interface AppState {
  source: string;
  language: Language;
  /** The inactive language's buffer, restored when switching back. */
  otherBuffer: string;
  filePath: string | null;
  /** Unsaved edits relative to disk. */
  fileDirty: boolean;
  program: Program | null;
  machine: Machine | null;
  /** Bumped whenever the (mutable) machine changes, so React re-renders. */
  tick: number;
  trace: CycleTrace | null;
  model: ModelKind;
  options: ProcessorOptions;
  caches: CacheConfigs;
  autoCompress: boolean;
  /** 0..4 = stages revealed so far for the current cycle; 4 = whole cycle. */
  phase: number;
  playing: boolean;
  speed: number;
  playMode: PlayMode;
  hover: HoverTarget | null;
  pinned: HoverTarget | null;
  base: NumberBase;
  showValues: boolean;
  breakpoints: ReadonlySet<number>;
  status: string;
  activeExample: string;
  /** Source edited since the last successful assemble. */
  dirty: boolean;
  compileLog: string | null;
  compiling: boolean;
  dialog: DialogKind;
  sidebarView: SidebarView;
  sidebarOpen: boolean;
  theme: ThemeMode;

  /** Show a view in the side panel; choosing the visible one collapses the panel. */
  setSidebarView(v: SidebarView): void;
  toggleSidebar(): void;
  setTheme(t: ThemeMode): void;
  setSource(src: string): void;
  setLanguage(l: Language): void;
  loadExample(id: string): void;
  newFile(): void;
  openFile(): Promise<void>;
  openPath(path: string): Promise<void>;
  saveFile(): Promise<void>;
  saveFileAs(): Promise<void>;
  openElf(): Promise<void>;
  compileC(): Promise<void>;
  loadProgram(program: Program, status: string): void;
  build(): boolean;
  reset(): void;
  step(): void;
  stepBack(): void;
  subStep(): void;
  run(): void;
  setPlaying(on: boolean): void;
  setSpeed(v: number): void;
  setPlayMode(m: PlayMode): void;
  setModel(m: ModelKind): void;
  setOptions(o: Partial<ProcessorOptions>): void;
  setCaches(c: CacheConfigs): void;
  setAutoCompress(v: boolean): void;
  setHover(h: HoverTarget | null): void;
  setPinned(h: HoverTarget | null): void;
  setBase(b: NumberBase): void;
  setShowValues(v: boolean): void;
  toggleBreakpoint(addr: number): void;
  setPhase(p: number): void;
  provideInput(text: string): void;
  setDialog(d: DialogKind): void;
  /** Notify the store that a device input (switch, d-pad) changed. */
  touchDevices(): void;
}

const STORAGE_KEY = 'riscsim.source';

function loadInitialSource(): { source: string; example: string } {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return { source: saved, example: '' };
  } catch { /* storage unavailable */ }
  return { source: EXAMPLES[0].source, example: EXAMPLES[0].id };
}

function persist(src: string): void {
  try { localStorage.setItem(STORAGE_KEY, src); } catch { /* ignore */ }
}

const initial = loadInitialSource();
const initialSidebar = loadSidebar();
const initialTheme = loadTheme();
applyTheme(initialTheme);

function persistSidebar(view: SidebarView, open: boolean): void {
  try { localStorage.setItem(SIDEBAR_KEY, JSON.stringify({ view, open })); } catch { /* ignore */ }
}

export const useStore = create<AppState>((set, get) => {
  const bump = (extra: Partial<AppState> = {}) => {
    const m = get().machine;
    set({ tick: get().tick + 1, trace: m?.lastTrace ?? null, ...extra });
  };

  const makeMachine = (program: Program): Machine => {
    const { model, options, breakpoints, caches } = get();
    const m = new Machine(program, model, options, caches);
    m.breakpoints = new Set(breakpoints);
    return m;
  };

  const fileName = () => {
    const p = get().filePath;
    return p ? p.replace(/^.*[\\/]/, '') : get().language === 'c' ? 'untitled.c' : 'untitled.s';
  };

  const afterStep = (m: Machine) => {
    if (m.blocked) return 'Program is waiting for console input (see the Console tab).';
    return m.finished ? finishedMessage(m) : `Cycle ${m.core.cycle}.`;
  };

  const applyOpened = (path: string, text: string): void => {
    const language: Language = /\.(c|h)$/i.test(path) ? 'c' : 'asm';
    const cur = get();
    const swap = cur.language !== language;
    set({ source: text, language, otherBuffer: swap ? cur.source : cur.otherBuffer, filePath: path, fileDirty: false, activeExample: '', program: null, machine: null, trace: null, dirty: false, playing: false, breakpoints: new Set(), status: `Opened ${path}.` });
    if (language === 'asm') { persist(text); get().build(); } else { bump(); }
  };

  return {
    source: initial.source,
    language: 'asm',
    otherBuffer: C_EXAMPLE,
    filePath: null,
    fileDirty: false,
    program: null,
    machine: null,
    tick: 0,
    trace: null,
    model: 'single',
    options: DEFAULT_OPTIONS,
    caches: DEFAULT_CACHES,
    autoCompress: false,
    phase: PHASE_COMPLETE,
    playing: false,
    speed: 2,
    playMode: 'cycle',
    hover: null,
    pinned: null,
    base: 'hex',
    showValues: true,
    breakpoints: new Set(),
    status: 'Ready. Assemble to start.',
    activeExample: initial.example,
    dirty: false,
    compileLog: null,
    compiling: false,
    dialog: 'none',
    sidebarView: initialSidebar.view,
    sidebarOpen: initialSidebar.open,
    theme: initialTheme,

    setSidebarView(v) {
      const { sidebarView, sidebarOpen } = get();
      const open = v === sidebarView ? !sidebarOpen : true;
      persistSidebar(v, open);
      set({ sidebarView: v, sidebarOpen: open });
    },
    toggleSidebar() {
      const { sidebarView, sidebarOpen } = get();
      persistSidebar(sidebarView, !sidebarOpen);
      set({ sidebarOpen: !sidebarOpen });
    },
    setTheme(t) { applyTheme(t); set({ theme: t }); },
    setSource(src) {
      if (get().language === 'asm') persist(src);
      set({ source: src, activeExample: '', dirty: get().program !== null, fileDirty: true });
    },
    setLanguage(l) {
      if (l === get().language) return;
      const { source, otherBuffer } = get();
      set({ language: l, source: otherBuffer, otherBuffer: source, filePath: null, fileDirty: false, activeExample: '', program: null, machine: null, trace: null, dirty: false, compileLog: null, playing: false, status: l === 'c' ? 'C mode: press Compile to build with your RISC-V GCC and load the result.' : 'Assembly mode.' });
      bump();
    },
    loadExample(id) {
      const ex = EXAMPLES.find((e) => e.id === id);
      if (!ex) return;
      if (get().language !== 'asm') { const cur = get().source; set({ language: 'asm', otherBuffer: cur }); }
      persist(ex.source);
      set({ source: ex.source, activeExample: id, playing: false, breakpoints: new Set(), filePath: null, fileDirty: false });
      get().build();
    },
    newFile() {
      set({ source: get().language === 'c' ? C_EXAMPLE : '# New program\n\nmain:\n    li a7, 10\n    ecall\n', filePath: null, fileDirty: false, activeExample: '', program: null, machine: null, trace: null, dirty: false, playing: false, breakpoints: new Set(), status: 'New file.' });
      bump();
    },
    async openFile() {
      const r = await desktop.openFile();
      if (!r) return;
      applyOpened(r.path, r.text);
    },
    async openPath(path) {
      if (!isDesktop) return;
      const r = await desktop.readPath(path);
      applyOpened(r.path, r.text);
    },
    async saveFile() {
      const p = await desktop.saveFile(get().filePath, get().source, fileName());
      if (p) set({ filePath: p, fileDirty: false, status: `Saved ${p}.` });
    },
    async saveFileAs() {
      const p = await desktop.saveFile(null, get().source, fileName());
      if (p) set({ filePath: p, fileDirty: false, status: `Saved ${p}.` });
    },
    async openElf() {
      const r = await desktop.openBinary();
      if (!r) return;
      try {
        const program = programFromElf(Uint8Array.from(r.data));
        get().loadProgram(program, `Loaded ELF ${r.path}: ${program.text.length} instructions, entry 0x${program.entry.toString(16)}.`);
      } catch (e) {
        set({ status: `Could not load ELF: ${(e as Error).message}` });
      }
    },
    async compileC() {
      set({ compiling: true, status: 'Compiling…', playing: false });
      const r = await desktop.compileC(get().source, '');
      set({ compiling: false, compileLog: [r.command, r.log].filter(Boolean).join('\n') || 'compiled without warnings' });
      if (!r.ok || !r.elf) { set({ status: 'Compilation failed — see the Console tab for the compiler output.', program: null, machine: null, trace: null }); bump(); return; }
      try {
        const program = programFromElf(Uint8Array.from(r.elf));
        get().loadProgram(program, `Compiled and loaded ${program.text.length} instructions (entry 0x${program.entry.toString(16)}). Press Step or Play.`);
      } catch (e) {
        set({ status: `Compiled, but the ELF could not be loaded: ${(e as Error).message}` });
      }
    },
    loadProgram(program, status) {
      const machine = makeMachine(program);
      set({ program, machine, trace: null, phase: PHASE_COMPLETE, playing: false, pinned: null, dirty: false, status });
      bump();
    },
    build() {
      if (get().language === 'c') { void get().compileC(); return false; }
      const program = assemble(get().source, { autoCompress: get().autoCompress });
      if (program.errors.length > 0) {
        set({ program, machine: null, trace: null, playing: false, dirty: false, status: `${program.errors.length} error${program.errors.length === 1 ? '' : 's'} — fix them to run.` });
        return false;
      }
      get().loadProgram(program, `Assembled ${program.text.length} instructions (${program.textEnd - program.textStart} bytes). Press Step or Play.`);
      return true;
    },
    reset() {
      const p = get().program;
      if (!p || p.errors.length) { get().build(); return; }
      set({ machine: makeMachine(p), trace: null, phase: PHASE_COMPLETE, playing: false, pinned: null, status: 'Reset to the first instruction.' });
      bump();
    },
    step() {
      const m = get().machine;
      if (!m) { if (!get().build()) return; return get().step(); }
      if (m.blocked) { set({ playing: false, status: 'Waiting for console input.' }); return; }
      if (m.finished) { set({ playing: false, status: finishedMessage(m) }); return; }
      m.step();
      bump({ phase: PHASE_COMPLETE, status: afterStep(m) });
    },
    stepBack() {
      const m = get().machine;
      if (!m || !m.canUndo) return;
      m.undo();
      bump({ phase: PHASE_COMPLETE, playing: false, status: `Rewound to cycle ${m.core.cycle}.` });
    },
    subStep() {
      const { phase, machine } = get();
      if (!machine) { if (!get().build()) return; return get().subStep(); }
      if (phase >= PHASE_COMPLETE || !get().trace) {
        if (machine.blocked || machine.finished) { set({ playing: false, status: afterStep(machine) }); return; }
        machine.step();
        bump({ phase: 0, status: `Cycle ${machine.core.cycle} — walking through the datapath stage by stage.` });
        return;
      }
      set({ phase: phase + 1 });
    },
    run() {
      const m = get().machine ?? (get().build() ? get().machine : null);
      if (!m) return;
      const r = m.run();
      const status = r.stoppedAtBreakpoint ? `Stopped at breakpoint (PC ${hex(m.core.pc)}) after ${r.cycles} cycles.` : m.blocked ? 'Program is waiting for console input (see the Console tab).' : m.finished ? finishedMessage(m) : `Stopped after ${r.cycles} cycles (limit).`;
      bump({ phase: PHASE_COMPLETE, playing: false, status });
    },
    setPlaying(on) {
      if (on && !get().machine && !get().build()) return;
      set({ playing: on });
    },
    setSpeed(v) { set({ speed: v }); },
    setPlayMode(m) { set({ playMode: m }); },
    setModel(model) {
      set({ model, playing: false });
      const p = get().program;
      if (p && !p.errors.length) { set({ machine: makeMachine(p), trace: null, phase: PHASE_COMPLETE, pinned: null, status: `Switched to the ${model === 'single' ? 'single-cycle' : '5-stage pipelined'} processor.` }); bump(); }
    },
    setOptions(o) {
      set({ options: { ...get().options, ...o }, playing: false });
      const p = get().program;
      if (p && !p.errors.length) { set({ machine: makeMachine(p), trace: null, phase: PHASE_COMPLETE, status: 'Processor options changed; simulation reset.' }); bump(); }
    },
    setCaches(c) {
      set({ caches: c });
      const m = get().machine;
      if (m) { m.setCaches(c); bump({ status: 'Cache configuration changed; cache contents and statistics cleared.' }); }
    },
    setAutoCompress(v) {
      set({ autoCompress: v, dirty: get().program !== null && get().language === 'asm' });
    },
    setHover(h) { set({ hover: h }); },
    setPinned(h) { set({ pinned: h }); },
    setBase(b) { set({ base: b }); },
    setShowValues(v) { set({ showValues: v }); },
    toggleBreakpoint(addr) {
      const next = new Set(get().breakpoints);
      if (next.has(addr)) next.delete(addr); else next.add(addr);
      const m = get().machine;
      if (m) m.breakpoints = new Set(next);
      set({ breakpoints: next });
    },
    setPhase(p) { set({ phase: Math.max(0, Math.min(PHASE_COMPLETE, p)) }); },
    provideInput(text) {
      const m = get().machine;
      if (!m || !m.blocked) return;
      m.provideInput(text);
      bump({ status: 'Input delivered; the program continues.' });
    },
    setDialog(d) { set({ dialog: d }); },
    touchDevices() { bump(); },
  };
});

function hex(v: number): string {
  return '0x' + (v >>> 0).toString(16);
}

function finishedMessage(m: Machine): string {
  if (m.core.error) return m.core.error;
  const s = m.core.stats;
  const cpi = s.instructions ? (s.cycles / s.instructions).toFixed(2) : '–';
  return `Program finished (exit ${m.core.exitCode}) in ${s.cycles} cycles, ${s.instructions} instructions, CPI ${cpi}.`;
}
