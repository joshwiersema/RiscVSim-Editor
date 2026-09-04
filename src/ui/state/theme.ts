/** Light / dark / follow-system theme, persisted per machine. */
export type ThemeMode = 'system' | 'light' | 'dark';

const THEME_KEY = 'riscsim.theme';
const MODES: readonly ThemeMode[] = ['system', 'light', 'dark'];

export function loadTheme(): ThemeMode {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    if (raw && (MODES as readonly string[]).includes(raw)) return raw as ThemeMode;
  } catch { /* storage unavailable */ }
  return 'system';
}

/** Stamp the choice on <html> so the stylesheet can pick the palette. */
export function applyTheme(mode: ThemeMode): void {
  const root = document.documentElement;
  if (mode === 'system') delete root.dataset.theme; else root.dataset.theme = mode;
  try { localStorage.setItem(THEME_KEY, mode); } catch { /* ignore */ }
}

/** The palette actually in effect, resolving 'system' against the OS. */
export function effectiveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode !== 'system') return mode;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function nextTheme(mode: ThemeMode): ThemeMode {
  return effectiveTheme(mode) === 'dark' ? 'light' : 'dark';
}
