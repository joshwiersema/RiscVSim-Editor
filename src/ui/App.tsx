import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { NumberBase } from '@/core/util/format';
import { Toolbar } from './components/Toolbar';
import { ActivityRail, RAIL_ITEMS } from './components/ActivityRail';
import { StatusBar } from './components/StatusBar';
import { Splitter } from './components/Splitter';
import { HelpDialog } from './components/HelpDialog';
import { SettingsDialog } from './components/SettingsDialog';
import { Icon } from './components/Icons';
import { Tabs } from './components/Tabs';
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
import { StatsPanel } from './panels/StatsPanel';
import { ReferencePanel } from './panels/ReferencePanel';
import { usePlayback } from './hooks/usePlayback';
import { useKeyboard } from './hooks/useKeyboard';
import { useDesktopMenu } from './hooks/useDesktopMenu';
import { useStore, type SidebarView } from './state/store';

const DEFAULT_LAYOUT = { left: 400, right: 340, dock: 290 };
const LAYOUT_KEY = 'riscsim.layout.v2';
const MIN_PANE = 240;
const DOCK_COLLAPSED = 34;
const RAIL_WIDTH = 48;

interface PaneLayout { left: number; right: number; dock: number }

const SIDEBAR_VIEWS: Record<SidebarView, () => ReactNode> = {
  editor: () => <Editor />,
  program: () => <ProgramPanel />,
  memory: () => <MemoryPanel />,
  cache: () => <CachePanel />,
  io: () => <IoPanel />,
  console: () => <ConsolePanel />,
  stats: () => <StatsPanel />,
  reference: () => <ReferencePanel />,
};

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
  const sidebarView = useStore((s) => s.sidebarView);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const base = useStore((s) => s.base);
  const setBase = useStore((s) => s.setBase);
  useEffect(() => { build(); }, [build]);

  const [pane, setPane] = useState<PaneLayout>(loadLayout);
  const dragBase = useRef<PaneLayout>(pane);
  const beginDrag = () => { dragBase.current = pane; };
  const commit = useCallback((next: PaneLayout) => {
    setPane(next);
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }, []);
  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
  const maxSide = () => Math.max(MIN_PANE, window.innerWidth * 0.55);

  const dragLeft = useCallback((d: number) => commit({ ...dragBase.current, left: clamp(dragBase.current.left + d, MIN_PANE, maxSide()) }), [commit]);
  const dragRight = useCallback((d: number) => commit({ ...dragBase.current, right: clamp(dragBase.current.right - d, MIN_PANE, maxSide()) }), [commit]);
  const dragDock = useCallback((d: number) => commit({ ...dragBase.current, dock: clamp(dragBase.current.dock - d, DOCK_COLLAPSED, window.innerHeight * 0.75) }), [commit]);
  const dockCollapsed = pane.dock <= DOCK_COLLAPSED + 4;
  const toggleDock = () => commit({ ...pane, dock: dockCollapsed ? DEFAULT_LAYOUT.dock : DOCK_COLLAPSED });

  const columns = `${RAIL_WIDTH}px ${sidebarOpen ? `${pane.left}px 6px ` : ''}minmax(0, 1fr) 6px ${pane.right}px`;
  const viewMeta = RAIL_ITEMS.find((r) => r.id === sidebarView);

  return (
    <div className="app">
      <Toolbar />
      <div className="workspace" style={{ gridTemplateColumns: columns }}>
        <ActivityRail />
        {sidebarOpen && (
          <>
            <aside className="column column-left sidebar" onPointerDown={beginDrag}>
              <div className="sidebar-head">
                <span className="sidebar-title">{viewMeta?.label ?? sidebarView}</span>
                <button className="btn btn-ghost btn-icon btn-xs" onClick={toggleSidebar} title="Hide side panel (Ctrl+B)"><Icon name="sidebar" size={14} /></button>
              </div>
              <div className="sidebar-body" key={sidebarView}>{SIDEBAR_VIEWS[sidebarView]()}</div>
            </aside>
            <div onPointerDown={beginDrag}><Splitter direction="vertical" onDrag={dragLeft} onDoubleClick={() => commit({ ...pane, left: DEFAULT_LAYOUT.left })} /></div>
          </>
        )}
        <main className="column column-center">
          <Datapath />
          <div onPointerDown={beginDrag}><Splitter direction="horizontal" onDrag={dragDock} onDoubleClick={toggleDock} /></div>
          <div className="bottom-dock" style={{ height: pane.dock }}>
            <Tabs
              tabs={[
                { id: 'narration', label: 'This cycle', content: <NarrationPanel /> },
                { id: 'pipeline', label: 'Pipeline diagram', content: <PipelineDiagram /> },
                { id: 'console', label: 'Console', content: <ConsolePanel />, badge: blocked ? 'input' : undefined },
              ]}
              trailing={<button className="btn btn-ghost btn-icon btn-xs" onClick={toggleDock} title="Collapse / expand"><Icon name={dockCollapsed ? 'chevron-up' : 'chevron-down'} size={14} /></button>}
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
            trailing={
              <select className="select select-xs" value={base} onChange={(e) => setBase(e.target.value as NumberBase)} title="Number display">
                <option value="hex">hex</option>
                <option value="dec">signed</option>
                <option value="udec">unsigned</option>
                <option value="bin">binary</option>
              </select>
            }
          />
        </aside>
      </div>
      <StatusBar />
      {dialog === 'help' && <HelpDialog onClose={() => setDialog('none')} />}
      {dialog === 'settings' && <SettingsDialog onClose={() => setDialog('none')} />}
    </div>
  );
}
