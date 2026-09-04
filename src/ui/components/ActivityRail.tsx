import { Icon, type IconName } from './Icons';
import { useStore, type SidebarView } from '../state/store';
import { effectiveTheme, nextTheme } from '../state/theme';

interface RailItem { readonly id: SidebarView; readonly icon: IconName; readonly label: string; readonly hint: string }

export const RAIL_ITEMS: readonly RailItem[] = [
  { id: 'editor', icon: 'code', label: 'Editor', hint: 'Source editor (Ctrl+1)' },
  { id: 'program', icon: 'list', label: 'Program', hint: 'Assembled listing with breakpoints (Ctrl+2)' },
  { id: 'memory', icon: 'memory', label: 'Memory', hint: 'Memory dump (Ctrl+3)' },
  { id: 'cache', icon: 'cache', label: 'Cache', hint: 'L1 instruction and data caches (Ctrl+4)' },
  { id: 'io', icon: 'io', label: 'I/O', hint: 'Memory-mapped devices (Ctrl+5)' },
  { id: 'console', icon: 'terminal', label: 'Console', hint: 'Program output and input (Ctrl+6)' },
  { id: 'stats', icon: 'chart', label: 'Statistics', hint: 'Run statistics and instruction mix (Ctrl+7)' },
  { id: 'reference', icon: 'book', label: 'Reference', hint: 'ISA, registers, syscalls, memory map (Ctrl+8)' },
];

/** Vertical icon bar on the left edge; picks which view the side panel shows. */
export function ActivityRail() {
  const view = useStore((s) => s.sidebarView);
  const open = useStore((s) => s.sidebarOpen);
  const setView = useStore((s) => s.setSidebarView);
  const setDialog = useStore((s) => s.setDialog);
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const blocked = useStore((s) => !!s.machine?.blocked);
  const errors = useStore((s) => s.program?.errors.length ?? 0);
  const dark = effectiveTheme(theme) === 'dark';

  const badgeFor = (id: SidebarView): string | null => {
    if (id === 'console' && blocked) return '!';
    if (id === 'editor' && errors) return String(errors);
    return null;
  };

  return (
    <nav className="rail" aria-label="Views">
      <div className="rail-group">
        {RAIL_ITEMS.map((it) => {
          const badge = badgeFor(it.id);
          return (
            <button
              key={it.id}
              className={`rail-btn ${open && view === it.id ? 'is-active' : ''}`}
              onClick={() => setView(it.id)}
              title={it.hint}
              aria-label={it.label}
              aria-pressed={open && view === it.id}
            >
              <Icon name={it.icon} size={20} />
              <span className="rail-label">{it.label}</span>
              {badge && <span className={`rail-badge ${it.id === 'console' ? 'is-warn' : 'is-danger'}`}>{badge}</span>}
            </button>
          );
        })}
      </div>
      <div className="rail-group rail-bottom">
        <button className="rail-btn" onClick={() => setTheme(nextTheme(theme))} title={dark ? 'Switch to light theme' : 'Switch to dark theme'} aria-label="Toggle theme">
          <Icon name={dark ? 'sun' : 'moon'} size={20} />
        </button>
        <button className="rail-btn" onClick={() => setDialog('settings')} title="Settings (compiler path)" aria-label="Settings">
          <Icon name="gear" size={20} />
        </button>
        <button className="rail-btn" onClick={() => setDialog('help')} title="Help and shortcuts (F1)" aria-label="Help">
          <Icon name="help" size={20} />
        </button>
      </div>
    </nav>
  );
}
