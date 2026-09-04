// Starts the Vite dev server, waits for it, then launches Electron against it.
import { spawn } from 'node:child_process';
import http from 'node:http';

const PORT = 5173;
const url = `http://localhost:${PORT}`;
const vite = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', '--port', String(PORT), '--strictPort'], { stdio: 'inherit', shell: process.platform === 'win32' });

function waitFor(retries = 100) {
  return new Promise((resolve, reject) => {
    const tick = (n) => {
      http.get(url, () => resolve()).on('error', () => (n > 0 ? setTimeout(() => tick(n - 1), 300) : reject(new Error('vite did not start'))));
    };
    tick(retries);
  });
}

await waitFor();
spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['node', 'scripts/build-electron.mjs'], { stdio: 'inherit', shell: process.platform === 'win32' }).on('close', () => {
  const electron = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['electron', '.'], { stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, RISCSIM_DEV_URL: url } });
  electron.on('close', () => { vite.kill(); process.exit(0); });
});
