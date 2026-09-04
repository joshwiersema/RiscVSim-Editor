import { useEffect } from 'react';
import { useStore } from '../state/store';

/** Global shortcuts. Ignored while typing in the editor or inputs. */
export function useKeyboard(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = !!target && (target.closest('.cm-editor') !== null || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
      const s = useStore.getState();
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); s.build(); return; }
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
