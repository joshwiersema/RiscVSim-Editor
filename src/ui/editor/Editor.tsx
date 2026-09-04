import { useEffect, useRef } from 'react';
import { EditorState, StateEffect, StateField, RangeSet } from '@codemirror/state';
import { EditorView, Decoration, gutter, GutterMarker, keymap, lineNumbers, highlightActiveLine, drawSelection, type DecorationSet } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { riscvLanguage } from './riscvLanguage';
import { cpp } from '@codemirror/lang-cpp';
import { Compartment } from '@codemirror/state';

const languageCompartment = new Compartment();
import { useStore } from '../state/store';
import { STAGES, type StageName } from '@/core/sim/narrate';

/** Which source lines are in which stage this cycle, plus error lines. */
interface LineMarks {
  readonly stages: ReadonlyMap<number, StageName>;
  readonly errors: ReadonlyMap<number, string>;
  readonly breakpoints: ReadonlySet<number>;
}

const setMarks = StateEffect.define<LineMarks>();

const marksField = StateField.define<LineMarks>({
  create: () => ({ stages: new Map(), errors: new Map(), breakpoints: new Set() }),
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setMarks)) return e.value;
    return value;
  },
});

const lineDecorations = EditorView.decorations.compute([marksField], (state) => {
  const marks = state.field(marksField);
  const builder: { from: number; deco: Decoration }[] = [];
  const doc = state.doc;
  const add = (line: number, cls: string) => {
    if (line < 1 || line > doc.lines) return;
    builder.push({ from: doc.line(line).from, deco: Decoration.line({ class: cls }) });
  };
  for (const [line, stage] of marks.stages) add(line, `cm-stage cm-stage-${stage}`);
  for (const [line] of marks.errors) add(line, 'cm-error-line');
  builder.sort((a, b) => a.from - b.from);
  return Decoration.set(builder.map((b) => b.deco.range(b.from)));
});

class BreakpointMarker extends GutterMarker {
  toDOM() { const el = document.createElement('span'); el.className = 'bp-dot'; return el; }
}
class ErrorMarker extends GutterMarker {
  constructor(private message: string) { super(); }
  toDOM() { const el = document.createElement('span'); el.className = 'err-dot'; el.title = this.message; return el; }
}
class StageMarker extends GutterMarker {
  constructor(private stage: StageName) { super(); }
  toDOM() { const el = document.createElement('span'); el.className = `stage-tag stage-tag-${this.stage}`; el.textContent = this.stage; return el; }
}

const markerGutter = gutter({
  class: 'cm-marks-gutter',
  markers: (view) => {
    const marks = view.state.field(marksField);
    const doc = view.state.doc;
    const out: { from: number; marker: GutterMarker }[] = [];
    for (let line = 1; line <= doc.lines; line++) {
      const err = marks.errors.get(line);
      if (err) out.push({ from: doc.line(line).from, marker: new ErrorMarker(err) });
      else if (marks.breakpoints.has(line)) out.push({ from: doc.line(line).from, marker: new BreakpointMarker() });
      else { const s = marks.stages.get(line); if (s) out.push({ from: doc.line(line).from, marker: new StageMarker(s) }); }
    }
    return RangeSet.of(out.map((o) => o.marker.range(o.from)), true);
  },
  domEventHandlers: {
    mousedown(view, line) {
      const lineNo = view.state.doc.lineAt(line.from).number;
      const st = useStore.getState();
      const addr = st.program?.lineToAddr.get(lineNo);
      if (addr !== undefined) st.toggleBreakpoint(addr);
      return true;
    },
  },
});

const editorTheme = EditorView.theme({
  '&': { backgroundColor: 'var(--bg-panel)', color: 'var(--text)' },
  '.cm-gutters': { backgroundColor: 'var(--bg-panel)', color: 'var(--text-faint)', borderRight: '1px solid var(--border)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--accent) 7%, transparent)' },
  '.cm-cursor': { borderLeftColor: 'var(--text)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: 'var(--accent-soft)' },
});

const highlight = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--syn-keyword)', fontWeight: '600' },
  { tag: tags.variableName, color: 'var(--syn-register)' },
  { tag: tags.number, color: 'var(--syn-number)' },
  { tag: tags.string, color: 'var(--syn-string)' },
  { tag: tags.comment, color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: tags.labelName, color: 'var(--syn-label)', fontWeight: '600' },
  { tag: tags.meta, color: 'var(--syn-meta)' },
  { tag: tags.atom, color: 'var(--syn-label)' },
]);

export function Editor() {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const source = useStore((s) => s.source);
  const setSource = useStore((s) => s.setSource);
  const program = useStore((s) => s.program);
  const trace = useStore((s) => s.trace);
  const machine = useStore((s) => s.machine);
  const tick = useStore((s) => s.tick);
  const breakpoints = useStore((s) => s.breakpoints);
  const model = useStore((s) => s.model);
  const language = useStore((s) => s.language);

  useEffect(() => {
    const view = viewRef.current;
    if (view) view.dispatch({ effects: languageCompartment.reconfigure(language === 'c' ? cpp() : riscvLanguage) });
  }, [language]);

  useEffect(() => {
    if (!host.current || viewRef.current) return;
    const view = new EditorView({
      state: EditorState.create({
        doc: useStore.getState().source,
        extensions: [
          lineNumbers(), markerGutter, history(), drawSelection(), highlightActiveLine(),
          keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
          languageCompartment.of(useStore.getState().language === 'c' ? cpp() : riscvLanguage), syntaxHighlighting(highlight), marksField, lineDecorations,
          EditorView.updateListener.of((u) => {
            if (!u.docChanged) return;
            const text = u.state.doc.toString();
            if (text !== useStore.getState().source) setSource(text);
          }),
          editorTheme,
          EditorView.lineWrapping,
        ],
      }),
      parent: host.current,
    });
    viewRef.current = view;
    return () => { view.destroy(); viewRef.current = null; };
  }, [setSource]);

  // External source changes (example loaded) -> replace the document.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (view.state.doc.toString() !== source) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: source } });
    }
  }, [source]);

  // Stage / error / breakpoint markers.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const stages = new Map<number, StageName>();
    if (program && machine) {
      if (trace) {
        for (const s of [...STAGES].reverse()) {
          const t = trace.stages[s].trace;
          if (!t) continue;
          const line = program.addrToLine.get(t.pc);
          if (line !== undefined) stages.set(line, s);
        }
      }
      if (!machine.finished) {
        const nextLine = program.addrToLine.get(machine.core.pc);
        if (nextLine !== undefined && !stages.has(nextLine) && (model === 'single' || !trace)) stages.set(nextLine, 'IF');
      }
    }
    const errors = new Map<number, string>();
    for (const e of program?.errors ?? []) errors.set(e.line, e.message);
    const bpLines = new Set<number>();
    if (program) for (const addr of breakpoints) { const l = program.addrToLine.get(addr); if (l !== undefined) bpLines.add(l); }
    view.dispatch({ effects: setMarks.of({ stages, errors, breakpoints: bpLines }) });
  }, [program, trace, machine, tick, breakpoints, model]);

  const errors = program?.errors ?? [];
  return (
    <div className="editor">
      <div className="editor-host" ref={host} />
      {errors.length > 0 && (
        <div className="editor-errors">
          {errors.map((e, i) => (
            <button key={i} className="editor-error" onClick={() => jumpToLine(viewRef.current, e.line)}>
              <span className="editor-error-line">line {e.line}</span> {e.message}
            </button>
          ))}
        </div>
      )}
      <div className="editor-hint">{language === 'c' ? 'C mode: Ctrl+Enter compiles with your RISC-V GCC (File › Settings)' : 'Click a line number\x27s gutter to set a breakpoint · Ctrl+Enter assembles'}</div>
    </div>
  );
}

function jumpToLine(view: EditorView | null, line: number): void {
  if (!view) return;
  const l = view.state.doc.line(Math.min(line, view.state.doc.lines));
  view.dispatch({ selection: { anchor: l.from }, scrollIntoView: true });
  view.focus();
}

export type { DecorationSet };
