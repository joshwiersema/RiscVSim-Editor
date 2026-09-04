/** Small inline stroke icons (24-unit grid) so the UI needs no icon font. */
export type IconName =
  | 'code' | 'list' | 'memory' | 'cache' | 'io' | 'terminal' | 'chart' | 'book'
  | 'sun' | 'moon' | 'gear' | 'help' | 'sidebar'
  | 'skip-back' | 'play' | 'pause' | 'step' | 'walk' | 'run'
  | 'chevron-up' | 'chevron-down' | 'close' | 'search' | 'folder' | 'save';

const PATHS: Record<IconName, string> = {
  code: 'M8 6 2 12l6 6M16 6l6 6-6 6',
  list: 'M4 6h2M4 12h2M4 18h2M9 6h11M9 12h11M9 18h11',
  memory: 'M4 4h16v16H4zM4 9h16M4 15h16M9 4v16M15 4v16',
  cache: 'M12 3 3 8l9 5 9-5-9-5zM3 13l9 5 9-5M3 18l9 5 9-5',
  io: 'M3 7h10a4 4 0 0 1 0 8H3M7 7v8M17 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  terminal: 'M4 5h16v14H4zM7 9l3 3-3 3M12 15h5',
  chart: 'M4 20V10M10 20V4M16 20v-8M22 20H2',
  book: 'M4 4h6a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4zM20 4h-6a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h7z',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10z',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  help: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01',
  sidebar: 'M3 4h18v16H3zM9 4v16',
  'skip-back': 'M19 20 9 12l10-8zM5 19V5',
  play: 'M6 4l14 8-14 8z',
  pause: 'M6 5h4v14H6zM14 5h4v14h-4z',
  step: 'M5 4l10 8-10 8zM19 5v14',
  walk: 'M6 4l6 8-6 8M13 4l6 8-6 8',
  run: 'M3 5l8 7-8 7zM13 5l8 7-8 7z',
  'chevron-up': 'M6 15l6-6 6 6',
  'chevron-down': 'M6 9l6 6 6-6',
  close: 'M6 6l12 12M18 6 6 18',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  save: 'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2zM17 21v-8H7v8M7 3v5h8',
};

interface IconProps { readonly name: IconName; readonly size?: number; readonly className?: string }

export function Icon({ name, size = 16, className }: IconProps) {
  const filled = name === 'play' || name === 'pause' || name === 'step' || name === 'run' || name === 'skip-back';
  return (
    <svg
      className={`icon ${className ?? ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={filled ? 1 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
