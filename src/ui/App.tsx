import { useCallback, useEffect, useRef, useState } from 'react';
import { Toolbar } from './components/Toolbar';
import { Splitter } from './components/Splitter';
import { HelpDialog } from './components/HelpDialog';
import { SettingsDialog } from './components/SettingsDialog';
import { Editor } from './editor/Editor';
import { Datapath } from './datapath/Datapath';
import { RegistersPanel } from './panels/RegistersPanel';
import { MemoryPanel } from './panels/MemoryPanel';
import { ConsolePanel } from './panels/ConsolePanel';
import { NarrationPanel } from './panels/NarrationPanel';
import { PipelineDiagram } from './panels/PipelineDiagram';
import { InspectorPanel } from './panels/InspectorPanel';
import { ProgramPanel } from './panels/ProgramPanel';
import { CachePanel } from './panels/CachePanel';
import { IoPanel } from './panels/IoPanel';
import { Tabs } from './components/Tabs';
import { usePlayback } from './hooks/usePlayback';
import { useKeyboard } from './hooks/useKeyboard';
import { useDesktopMenu } from './hooks/useDesktopMenu';
import { useStore } from './state/store';

const DEFAULT_LAYOUT = { left: 360, right: 340, dock: 300 };
const LAYOUT_KEY = 'riscsim.layout';
const MIN_PANE = 200;
const DOCK_COLLAPSED = 34;

interface PaneLayout { left: number; right: number; dock: number }

function loadLayout(): PaneLayout {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (raw) return { ...DEFAULT_LAYOUT, ...(JSON.parse(raw) as Partial<PaneLayout>) };
  } catch { /* ignore */ }
  return DEFAULT_LAYOUT;
}

export function App() {
  usePlayback();
  useKeyboard();
  useDesktopMenu();
  const build = useStore((s) => s.build);
  const dialog = useStore((s) => s.dialog);
  const setDialog = useStore((s) => s.setDialog);
  const blocked = useStore((s) => !!s.machine?.blocked);
  useEffect(() => { build(); }, [build]);

  const [pane, setPane] = useState<PaneLayout>(loadLayout);
  const dragBase = useRef<PaneLayout>(pane);
  const beginDrag = () => { dragBase.current = pane; };
  const commit = useCallback((next: PaneLayout) => {
    setPane(next);
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }, []);
  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
  const maxSide = () => Math.max(MIN_PANE, window.innerWidth * 0.45);

  const dragLeft = useCallback((d: number) => commit({ ...dragBase.current, left: clamp(dragBase.current.left + d, MIN_PANE, maxSide()) }), [commit]);
  const dragRight = useCallback((d: number) => commit({ ...dragBase.current, right: clamp(dragBase.current.right - d, MIN_PANE, maxSide()) }), [commit]);
  const dragDock = useCallback((d: number) => commit({ ...dragBase.current, dock: clamp(dragBase.current.dock - d, DOCK_COLLAPSED, window.innerHeight * 0.75) }), [commit]);
  const toggleDock = () => commit({ ...pane, dock: pane.dock <= DOCK_COLLAPSED + 4 ? DEFAULT_LAYOUT.dock : DOCK_COLLAPSED });

  return (
    <div className="app">
      <Toolbar />
      <div className="workspace" style={{ gridTemplateColumns: `${pane.left}px 6px 1fr 6px ${pane.right}px` }}>
        <aside className="column column-left" onPointerDown={beginDrag}>
          <Tabs
            tabs={[
              { id: 'editor', label: 'Editor', content: <Editor /> },
              { id: 'program', label: 'Program', content: <ProgramPanel /> },
            ]}
          />
        </aside>
        <div onPointerDown={beginDrag}><Splitter direction="vertical" onDrag={dragLeft} onDoubleClick={() => commit({ ...pane, left: DEFAULT_LAYOUT.left })} /></div>
        <main className="column column-center">
          <Datapath />
          <div onPointerDown={beginDrag}><Splitter direction="horizontal" onDrag={dragDock} onDoubleClick={toggleDock} /></div>
          <div className="bottom-dock" style={{ height: pane.dock }}>
            <Tabs
              tabs={[
                { id: 'narration', label: 'This cycle', content: <NarrationPanel /> },
                { id: 'pipeline', label: 'Pipeline diagram', content: <PipelineDiagram /> },
                { id: 'cache', label: 'Cache', content: <CachePanel /> },
                { id: 'io', label: 'I/O', content: <IoPanel /> },
                { id: 'console', label: 'Console', content: <ConsolePanel />, badge: blocked ? 'input' : undefined },
              ]}
              trailing={<button className="btn btn-ghost btn-xs" onClick={toggleDock} title="Collapse / expand">{pane.dock <= DOCK_COLLAPSED + 4 ? '▴' : '▾'}</button>}
            />
          </div>
        </main>
        <div onPointerDown={beginDrag}><Splitter direction="vertical" onDrag={dragRight} onDoubleClick={() => commit({ ...pane, right: DEFAULT_LAYOUT.right })} /></div>
        <aside className="column column-right">
          <InspectorPanel />
          <Tabs
            tabs={[
              { id: 'registers', label: 'Registers', content: <RegistersPanel /> },
              { id: 'memory', label: 'Memory', content: <MemoryPanel /> },
            ]}
          />
        </aside>
      </div>
      {dialog === 'help' && <HelpDialog onClose={() => setDialog('none')} />}
      {dialog === 'settings' && <SettingsDialog onClose={() => setDialog('none')} />}
    </div>
  );
}
