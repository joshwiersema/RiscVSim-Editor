import { useEffect } from 'react';
import { desktop } from '../desktop';
import { useStore } from '../state/store';

/** Routes native menu actions (File, Simulate, Help) to store actions and keeps the window title in sync. */
export function useDesktopMenu(): void {
  useEffect(() => {
    return desktop.onMenu((action, payload) => {
      const s = useStore.getState();
      switch (action) {
        case 'new': s.newFile(); break;
        case 'open': void s.openFile(); break;
        case 'opened': {
          const p = payload as { path: string; text: string };
          void s.openPath(p.path);
          break;
        }
        case 'save': void s.saveFile(); break;
        case 'saveAs': void s.saveFileAs(); break;
        case 'openElf': void s.openElf(); break;
        case 'compile': void s.compileC(); break;
        case 'settings': s.setDialog('settings'); break;
        case 'help': s.setDialog('help'); break;
        case 'build': s.build(); break;
        case 'reset': s.reset(); break;
        case 'step': s.step(); break;
        case 'subStep': s.subStep(); break;
        case 'stepBack': s.stepBack(); break;
        case 'togglePlay': s.setPlaying(!s.playing); break;
        case 'run': s.run(); break;
        default: break;
      }
    });
  }, []);

  const filePath = useStore((s) => s.filePath);
  const fileDirty = useStore((s) => s.fileDirty);
  const language = useStore((s) => s.language);
  useEffect(() => {
    const name = filePath ? filePath.replace(/^.*[\\/]/, '') : language === 'c' ? 'untitled.c' : 'untitled.s';
    document.title = `${fileDirty ? '● ' : ''}${name} — RiscSim`;
  }, [filePath, fileDirty, language]);
}
