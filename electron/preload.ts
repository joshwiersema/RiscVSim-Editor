import { contextBridge, ipcRenderer } from 'electron';

export interface DesktopSettings {
  compilerPath: string;
  compilerFlags: string;
  recentFiles: string[];
}

export interface DesktopApi {
  readonly platform: string;
  openFile(): Promise<{ path: string; text: string } | null>;
  openBinary(): Promise<{ path: string; data: number[] } | null>;
  readPath(path: string): Promise<{ path: string; text: string }>;
  saveFile(path: string | null, text: string, defaultName: string): Promise<string | null>;
  getSettings(): Promise<DesktopSettings>;
  setSettings(patch: Partial<DesktopSettings>): Promise<DesktopSettings>;
  pickFile(title: string): Promise<string | null>;
  detectCompiler(): Promise<string | null>;
  compileC(source: string, extraFlags: string): Promise<{ ok: boolean; elf?: number[]; log: string; command: string }>;
  onMenu(cb: (action: string, payload: unknown) => void): () => void;
}

const api: DesktopApi = {
  platform: process.platform,
  openFile: () => ipcRenderer.invoke('file:open'),
  openBinary: () => ipcRenderer.invoke('file:openBinary'),
  readPath: (p) => ipcRenderer.invoke('file:readPath', p),
  saveFile: (p, text, defaultName) => ipcRenderer.invoke('file:save', p, text, defaultName),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  pickFile: (title) => ipcRenderer.invoke('dialog:pickFile', title),
  detectCompiler: () => ipcRenderer.invoke('compiler:detect'),
  compileC: (source, extraFlags) => ipcRenderer.invoke('compiler:compile', source, extraFlags),
  onMenu: (cb) => {
    const handler = (_e: unknown, msg: { action: string; payload: unknown }) => cb(msg.action, msg.payload);
    ipcRenderer.on('menu', handler);
    return () => ipcRenderer.removeListener('menu', handler);
  },
};

contextBridge.exposeInMainWorld('riscsim', api);
