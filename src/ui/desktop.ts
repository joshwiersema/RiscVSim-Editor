/**
 * Access to the Electron main process through the preload bridge, with
 * browser fallbacks so the renderer also works under plain Vite (used by
 * the screenshot tests).
 */
import type { DesktopApi, DesktopSettings } from '../../electron/preload';

declare global {
  interface Window { riscsim?: DesktopApi }
}

export type { DesktopSettings };

export const isDesktop = typeof window !== 'undefined' && !!window.riscsim;

function fallbackOpenText(accept: string): Promise<{ path: string; text: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) { resolve(null); return; }
      resolve({ path: f.name, text: await f.text() });
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

function fallbackOpenBinary(): Promise<{ path: string; data: number[] } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) { resolve(null); return; }
      resolve({ path: f.name, data: Array.from(new Uint8Array(await f.arrayBuffer())) });
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

function fallbackSave(text: string, name: string): string {
  const blob = new Blob([text], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
  return name;
}

const BROWSER_SETTINGS: DesktopSettings = { compilerPath: '', compilerFlags: '-O1', recentFiles: [] };

export const desktop: DesktopApi = window.riscsim ?? {
  platform: 'browser',
  openFile: () => fallbackOpenText('.s,.asm,.c,.h,.txt'),
  openBinary: fallbackOpenBinary,
  readPath: async (p) => ({ path: p, text: '' }),
  saveFile: async (_p, text, defaultName) => fallbackSave(text, defaultName),
  getSettings: async () => BROWSER_SETTINGS,
  setSettings: async (patch) => ({ ...BROWSER_SETTINGS, ...patch }),
  pickFile: async () => null,
  detectCompiler: async () => null,
  compileC: async () => ({ ok: false, log: 'C compilation needs the desktop app (it runs your local RISC-V GCC).', command: '' }),
  onMenu: () => () => { /* no menu in the browser */ },
};
