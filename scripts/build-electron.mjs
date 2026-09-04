// Bundles the Electron main and preload scripts with esbuild.
import { build } from 'esbuild';

const watch = process.argv.includes('--watch');
const common = { bundle: true, platform: 'node', target: 'node20', external: ['electron'], sourcemap: true, logLevel: 'info' };

await build({ ...common, entryPoints: ['electron/main.ts'], outfile: 'dist-electron/main.mjs', format: 'esm' });
await build({ ...common, entryPoints: ['electron/preload.ts'], outfile: 'dist-electron/preload.cjs', format: 'cjs' });
if (watch) console.log('built (watch mode not implemented; rerun to rebuild)');
