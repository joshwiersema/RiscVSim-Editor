import { app, BrowserWindow, dialog, ipcMain, Menu, shell, type MenuItemConstructorOptions } from 'electron';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkForUpdates, initUpdater, RELEASES_URL } from './updater';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;
// RISCSIM_LOAD_DIST=1 makes a dev run load the built renderer from dist/ (packaged-app code path).
const useDevServer = isDev && !process.env.RISCSIM_LOAD_DIST;
const logRenderer = !!process.env.RISCSIM_LOG_RENDERER;
const DEV_URL = process.env.RISCSIM_DEV_URL ?? 'http://localhost:5173';
const SOURCE_EXTENSIONS = new Set(['.s', '.S', '.asm', '.c', '.h', '.txt']);
const MAX_RECENT_FILES = 8;

interface Settings {
  compilerPath: string;
  compilerFlags: string;
  recentFiles: string[];
}
const DEFAULT_SETTINGS: Settings = { compilerPath: '', compilerFlags: '-O1', recentFiles: [] };
let settings: Settings = { ...DEFAULT_SETTINGS };

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}
async function loadSettings(): Promise<void> {
  try {
    settings = { ...DEFAULT_SETTINGS, ...(JSON.parse(await fs.readFile(settingsPath(), 'utf8')) as Partial<Settings>) };
  } catch { settings = { ...DEFAULT_SETTINGS }; }
}
async function saveSettings(): Promise<void> {
  await fs.mkdir(path.dirname(settingsPath()), { recursive: true });
  await fs.writeFile(settingsPath(), JSON.stringify(settings, null, 2), 'utf8');
}

function resourcesDir(): string {
  return isDev ? path.join(__dirname, '..', 'resources') : path.join(process.resourcesPath, 'resources');
}

let win: BrowserWindow | null = null;

/** The chip logo, used for the window/taskbar in dev and on Linux (Windows and macOS take it from the app bundle). */
function windowIcon(): string {
  return isDev ? path.join(__dirname, '..', 'build', 'icon.png') : path.join(resourcesDir(), 'icon.png');
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1600,
    height: 980,
    minWidth: 1100,
    minHeight: 700,
    title: 'RiscSim',
    icon: windowIcon(),
    backgroundColor: '#eef0f3',
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (logRenderer) {
    win.webContents.on('console-message', (event) => { console.log(`[renderer:${event.level}] ${event.message}`); });
    win.webContents.on('did-fail-load', (_e, code, desc) => { console.log(`[renderer] failed to load: ${code} ${desc}`); });
    win.webContents.on('did-finish-load', () => { console.log('[renderer] loaded'); });
  }
  if (useDevServer) {
    void win.loadURL(DEV_URL);
  } else {
    void win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
  win.webContents.setWindowOpenHandler(({ url }) => { void openExternalSafely(url); return { action: 'deny' }; });
  // The renderer is a local bundle; never let it navigate anywhere else.
  win.webContents.on('will-navigate', (event, url) => {
    const allowed = useDevServer ? url.startsWith(DEV_URL) : url.startsWith('file:');
    if (!allowed) { event.preventDefault(); void openExternalSafely(url); }
  });
  win.webContents.once('did-finish-load', () => { if (pendingOpen) { void openPath(pendingOpen); pendingOpen = null; } });
  win.on('closed', () => { win = null; });
}

async function openExternalSafely(url: string): Promise<void> {
  if (url.startsWith('https://') || url.startsWith('http://')) await shell.openExternal(url);
}

/** A file handed to us by the OS (double-click, "Open with", second instance). */
let pendingOpen: string | null = null;

function sourceFileFromArgv(argv: string[]): string | null {
  return argv.slice(1).find((a) => !a.startsWith('-') && SOURCE_EXTENSIONS.has(path.extname(a))) ?? null;
}

function openFromOs(file: string): void {
  if (win && !win.webContents.isLoading()) {
    void openPath(file);
    if (win.isMinimized()) win.restore();
    win.focus();
  } else {
    pendingOpen = file;
  }
}

function send(action: string, payload?: unknown): void {
  win?.webContents.send('menu', { action, payload });
}

function buildMenu(): void {
  const isMac = process.platform === 'darwin';
  const recent: MenuItemConstructorOptions[] = settings.recentFiles.length
    ? settings.recentFiles.map((f) => ({ label: f, click: () => void openPath(f) }))
    : [{ label: 'No recent files', enabled: false }];
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: '&File',
      submenu: [
        { label: 'New', accelerator: 'CmdOrCtrl+N', click: () => send('new') },
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => send('open') },
        { label: 'Open Recent', submenu: recent },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => send('save') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: () => send('saveAs') },
        { type: 'separator' },
        { label: 'Load ELF executable…', click: () => send('openElf') },
        { label: 'Compile C && Load', accelerator: 'CmdOrCtrl+Shift+B', click: () => send('compile') },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => send('settings') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: '&Simulate',
      submenu: [
        { label: 'Assemble', accelerator: 'CmdOrCtrl+Enter', click: () => send('build') },
        { label: 'Reset', accelerator: 'CmdOrCtrl+R', click: () => send('reset') },
        { type: 'separator' },
        { label: 'Step cycle', accelerator: 'F10', click: () => send('step') },
        { label: 'Walk stage', accelerator: 'F11', click: () => send('subStep') },
        { label: 'Step back', accelerator: 'F9', click: () => send('stepBack') },
        { label: 'Play / Pause', accelerator: 'F5', click: () => send('togglePlay') },
        { label: 'Run to end / breakpoint', accelerator: 'Shift+F5', click: () => send('run') },
      ],
    },
    {
      label: '&View',
      submenu: [
        { role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' },
      ],
    },
    {
      role: 'help',
      submenu: [
        { label: 'Shortcuts && syscalls', accelerator: 'F1', click: () => send('help') },
        { label: 'Project on GitHub', click: () => void shell.openExternal('https://github.com/joshwiersema/RiscVSim-Editor') },
        { label: 'Report an issue', click: () => void shell.openExternal('https://github.com/joshwiersema/RiscVSim-Editor/issues') },
        { type: 'separator' },
        { label: 'Check for updates…', click: () => void checkForUpdates(true) },
        { label: 'About RiscSim', click: () => void showAbout() },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function showAbout(): Promise<void> {
  const opts = {
    type: 'info' as const,
    title: 'About RiscSim',
    message: `RiscSim ${app.getVersion()}`,
    detail: `A visual RISC-V assembly editor and processor simulator.

Electron ${process.versions.electron} · Chromium ${process.versions.chrome} · Node ${process.versions.node}`,
    buttons: ['Releases page', 'Close'],
    defaultId: 1,
    cancelId: 1,
  };
  const { response } = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
  if (response === 0) void shell.openExternal(RELEASES_URL);
}

async function openPath(file: string): Promise<void> {
  try {
    const text = await fs.readFile(file, 'utf8');
    rememberRecent(file);
    send('opened', { path: file, text });
  } catch (e) {
    dialog.showErrorBox('Could not open file', String((e as Error).message));
  }
}

function rememberRecent(file: string): void {
  settings.recentFiles = [file, ...settings.recentFiles.filter((f) => f !== file)].slice(0, MAX_RECENT_FILES);
  void saveSettings();
  buildMenu();
}

/* ------------------------------------------------------------------ IPC */

ipcMain.handle('file:open', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Assembly / C', extensions: ['s', 'S', 'asm', 'c', 'h', 'txt'] }, { name: 'All files', extensions: ['*'] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  const file = r.filePaths[0];
  const text = await fs.readFile(file, 'utf8');
  rememberRecent(file);
  return { path: file, text };
});

ipcMain.handle('file:openBinary', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'ELF executable', extensions: ['elf', 'out', 'o', '*'] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  const file = r.filePaths[0];
  const data = await fs.readFile(file);
  return { path: file, data: Array.from(data) };
});

ipcMain.handle('file:save', async (_e, file: string | null, text: string, defaultName: string) => {
  let target = file;
  if (!target) {
    const r = await dialog.showSaveDialog({ defaultPath: defaultName, filters: [{ name: 'Assembly', extensions: ['s'] }, { name: 'C source', extensions: ['c'] }, { name: 'All files', extensions: ['*'] }] });
    if (r.canceled || !r.filePath) return null;
    target = r.filePath;
  }
  await fs.writeFile(target, text, 'utf8');
  rememberRecent(target);
  return target;
});

ipcMain.handle('file:readPath', async (_e, file: string) => {
  const text = await fs.readFile(file, 'utf8');
  rememberRecent(file);
  return { path: file, text };
});

ipcMain.handle('settings:get', () => settings);
ipcMain.handle('settings:set', async (_e, patch: Partial<Settings>) => {
  settings = { ...settings, ...patch };
  await saveSettings();
  buildMenu();
  return settings;
});

ipcMain.handle('dialog:pickFile', async (_e, title: string) => {
  const r = await dialog.showOpenDialog({ title, properties: ['openFile'] });
  return r.canceled ? null : r.filePaths[0] ?? null;
});

const COMPILER_CANDIDATES = ['riscv32-unknown-elf-gcc', 'riscv64-unknown-elf-gcc', 'riscv-none-elf-gcc', 'riscv32-elf-gcc', 'riscv64-elf-gcc'];

function runCommand(cmd: string, args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string; error?: string }> {
  return new Promise((resolve) => {
    let stdout = '', stderr = '';
    let child;
    try {
      child = spawn(cmd, args, { cwd, shell: process.platform === 'win32', windowsHide: true });
    } catch (e) {
      resolve({ code: -1, stdout, stderr, error: (e as Error).message });
      return;
    }
    child.stdout.on('data', (d) => { stdout += String(d); });
    child.stderr.on('data', (d) => { stderr += String(d); });
    child.on('error', (e) => resolve({ code: -1, stdout, stderr, error: e.message }));
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

async function detectCompiler(): Promise<string | null> {
  if (settings.compilerPath) return settings.compilerPath;
  for (const c of COMPILER_CANDIDATES) {
    const r = await runCommand(c, ['--version'], os.tmpdir());
    if (r.code === 0) return c;
  }
  return null;
}

ipcMain.handle('compiler:detect', () => detectCompiler());

ipcMain.handle('compiler:compile', async (_e, source: string, extraFlags: string) => {
  const gcc = await detectCompiler();
  if (!gcc) {
    return { ok: false, log: 'No RISC-V GCC found. Install a riscv32/riscv64-unknown-elf toolchain (for example xPack "riscv-none-elf-gcc") and set its path in File › Settings.', command: '' };
  }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'riscsim-'));
  const src = path.join(dir, 'program.c');
  const out = path.join(dir, 'program.elf');
  await fs.writeFile(src, source, 'utf8');
  const res = resourcesDir();
  const args = [
    '-march=rv32imc', '-mabi=ilp32', '-nostdlib', '-nostartfiles', '-static', '-ffreestanding', '-fno-builtin',
    '-Wl,--no-relax', `-Wl,-T,${path.join(res, 'riscsim.ld')}`, `-I${res}`,
    ...splitFlags(settings.compilerFlags), ...splitFlags(extraFlags),
    path.join(res, 'crt0.S'), src, '-o', out,
  ];
  try {
    const r = await runCommand(gcc, args, dir);
    const command = `${gcc} ${args.join(' ')}`;
    const log = [r.error ?? '', r.stdout, r.stderr].filter(Boolean).join('\n');
    if (r.code !== 0) return { ok: false, log: log || `compiler exited with code ${r.code}`, command };
    const elf = await fs.readFile(out);
    return { ok: true, elf: Array.from(elf), log, command };
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

function splitFlags(s: string): string[] {
  return s.split(/\s+/).map((f) => f.trim()).filter(Boolean);
}

/* ----------------------------------------------------------------- app */

// Match the identity electron-builder stamps on the Start-menu/desktop shortcuts so the
// Windows taskbar groups the window with them and shows the shortcut's (current) icon.
app.setAppUserModelId('dev.riscsim.app');

// One running copy: a second launch (e.g. double-clicking another .s file) hands its file to us.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const file = sourceFileFromArgv(argv);
    if (file) openFromOs(file);
    else if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.on('open-file', (event, file) => { event.preventDefault(); openFromOs(file); });
  if (app.isPackaged) pendingOpen = sourceFileFromArgv(process.argv);

  app.whenReady().then(async () => {
    await loadSettings();
    buildMenu();
    createWindow();
    initUpdater(() => win);
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });

  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
