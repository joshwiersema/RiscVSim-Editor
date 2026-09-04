import { useEffect } from 'react';
import { useStore, type SidebarView } from '../state/store';

/** Ctrl+1 … Ctrl+8 pick a side-panel view, in rail order. */
const VIEW_KEYS: readonly SidebarView[] = ['editor', 'program', 'memory', 'cache', 'io', 'console', 'stats', 'reference'];

/** Global shortcuts. Ignored while typing in the editor or inputs. */
export function useKeyboard(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = !!target && (target.closest('.cm-editor') !== null || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
      const s = useStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === 'Enter') { e.preventDefault(); s.build(); return; }
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'b') { e.preventDefault(); s.toggleSidebar(); return; }
      if (mod && !e.shiftKey && /^[1-8]$/.test(e.key)) { e.preventDefault(); s.setSidebarView(VIEW_KEYS[Number(e.key) - 1]); return; }
      if (e.key === 'F1') { e.preventDefault(); s.setDialog(s.dialog === 'help' ? 'none' : 'help'); return; }
      if (typing) return;
      switch (e.key) {
        case 'F10': case 'n': e.preventDefault(); s.step(); break;
        case 'F11': case 'm': e.preventDefault(); s.subStep(); break;
        case 'F9': case 'b': e.preventDefault(); s.stepBack(); break;
        case 'F5': case ' ': e.preventDefault(); s.setPlaying(!s.playing); break;
        case 'r': e.preventDefault(); s.reset(); break;
        case 'Escape': s.setPinned(null); s.setPlaying(false); break;
        default: break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
