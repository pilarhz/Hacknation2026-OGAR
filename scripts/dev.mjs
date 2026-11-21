// Uruchamia piaskownicę (4100), API (8080) i frontend Vite (5173) w jednym oknie.
import { spawn } from 'node:child_process';

const procs = [
  ['sandbox', process.execPath, ['apps/sandbox/server.ts']],
  ['api', process.execPath, ['--disable-warning=ExperimentalWarning', '--watch-path=apps/api/src', 'apps/api/src/server.ts']],
  ['web', process.execPath, ['node_modules/vite/bin/vite.js', 'apps/web']],
];

const children = procs.map(([name, cmd, args]) => {
  const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  const tag = (s) => s.toString().split(/\r?\n/).filter(Boolean).forEach((l) => console.log(`[${name}] ${l}`));
  p.stdout.on('data', tag);
  p.stderr.on('data', tag);
  p.on('exit', (c) => console.log(`[${name}] zakończono (${c})`));
  return p;
});

console.log('\nOGAR: UI http://127.0.0.1:5173 · API http://127.0.0.1:8080 · piaskownica http://127.0.0.1:4100\n');
const stop = () => {
  children.forEach((c) => c.kill());
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
