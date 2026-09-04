// Injected by Vite from package.json (see vite.config.ts); falls back for tests.
declare const __APP_VERSION__: string | undefined;

export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
