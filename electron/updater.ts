// Auto-update via GitHub Releases (electron-updater).
//
// Windows (NSIS) and Linux (AppImage) download the new installer in the background and
// apply it on restart. macOS and Linux .deb builds cannot self-install without code
// signing / root, so they only check and point the user at the download page.
import { app, dialog, shell, type BrowserWindow } from 'electron';
import electronUpdater from 'electron-updater';

// electron-updater is CommonJS with getter exports; a namespace import keeps ESM bundling happy.
const { autoUpdater } = electronUpdater;

export const RELEASES_URL = 'https://github.com/joshwiersema/RiscVSim-Editor/releases/latest';
const FIRST_CHECK_DELAY_MS = 8_000;
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

function canSelfInstall(): boolean {
  if (process.platform === 'win32') return true;
  if (process.platform === 'linux') return !!process.env.APPIMAGE;
  return false;
}

let getWindow: () => BrowserWindow | null = () => null;
let manualCheck = false;
let initialised = false;

function parent(): BrowserWindow | undefined {
  return getWindow() ?? undefined;
}

function log(...args: unknown[]): void {
  if (process.env.RISCSIM_LOG_UPDATER) console.log('[updater]', ...args);
}

async function promptRestart(version: string): Promise<void> {
  const { response } = await dialog.showMessageBox(parent()!, {
    type: 'info',
    title: 'Update ready',
    message: `RiscSim ${version} has been downloaded.`,
    detail: 'Restart now to finish installing, or keep working and it will install when you quit.',
    buttons: ['Restart now', 'Later'],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 0) autoUpdater.quitAndInstall();
}

async function promptDownloadPage(version: string): Promise<void> {
  const { response } = await dialog.showMessageBox(parent()!, {
    type: 'info',
    title: 'Update available',
    message: `RiscSim ${version} is available.`,
    detail: `You are running ${app.getVersion()}. Download the new version from the releases page.`,
    buttons: ['Open download page', 'Later'],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 0) void shell.openExternal(RELEASES_URL);
}

function wireEvents(): void {
  autoUpdater.on('checking-for-update', () => log('checking'));
  autoUpdater.on('update-available', (info) => {
    log('available', info.version);
    if (!canSelfInstall()) void promptDownloadPage(info.version);
  });
  autoUpdater.on('update-not-available', () => {
    log('up to date');
    if (!manualCheck) return;
    manualCheck = false;
    void dialog.showMessageBox(parent()!, { type: 'info', title: 'No updates', message: `RiscSim ${app.getVersion()} is the latest version.` });
  });
  autoUpdater.on('update-downloaded', (info) => {
    log('downloaded', info.version);
    manualCheck = false;
    void promptRestart(info.version);
  });
  autoUpdater.on('error', (err) => {
    log('error', err.message);
    if (!manualCheck) return;
    manualCheck = false;
    void dialog.showMessageBox(parent()!, {
      type: 'warning',
      title: 'Update check failed',
      message: 'RiscSim could not check for updates.',
      detail: 'Check your internet connection, or download the latest version from the releases page.',
      buttons: ['Open releases page', 'Close'],
      defaultId: 1,
      cancelId: 1,
    }).then(({ response }) => { if (response === 0) void shell.openExternal(RELEASES_URL); });
  });
}

/** Start background update checks. Safe to call in development; it becomes a no-op. */
export function initUpdater(windowGetter: () => BrowserWindow | null): void {
  getWindow = windowGetter;
  if (initialised || !app.isPackaged) return;
  initialised = true;
  autoUpdater.autoDownload = canSelfInstall();
  autoUpdater.autoInstallOnAppQuit = canSelfInstall();
  autoUpdater.allowPrerelease = false;
  autoUpdater.logger = null;
  wireEvents();
  setTimeout(() => void checkForUpdates(false), FIRST_CHECK_DELAY_MS);
  setInterval(() => void checkForUpdates(false), CHECK_INTERVAL_MS).unref();
}

/** Check now. When `manual` is true the user asked, so always report the outcome. */
export async function checkForUpdates(manual: boolean): Promise<void> {
  if (!app.isPackaged) {
    if (manual) void dialog.showMessageBox(parent()!, { type: 'info', title: 'Updates', message: 'Update checks are disabled in development builds.' });
    return;
  }
  manualCheck = manual;
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    // The 'error' event handler reports this to the user when appropriate.
    log('check failed', (err as Error).message);
  }
}
