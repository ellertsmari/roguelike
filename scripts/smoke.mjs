#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';

const PORT = process.env.PORT ? Number(process.env.PORT) : 5174;
const HOST = '127.0.0.1';
const PREVIEW_CMD = ['node', ['node_modules/vite/bin/vite.js', 'preview', '--host', HOST, '--port', String(PORT), '--strictPort']];

function log(...args) { console.log('[smoke]', ...args); }

function httpHead(url) {
  return new Promise((resolve) => {
    const req = http.request(url, { method: 'HEAD' }, (res) => {
      resolve({ ok: res.statusCode && res.statusCode >= 200 && res.statusCode < 400, status: res.statusCode });
      res.resume();
    });
    req.on('error', () => resolve({ ok: false, status: 0 }));
    req.end();
  });
}

async function main() {
  // Build first so preview has dist/
  log('building...');
  const b = spawnSync('node', ['node_modules/vite/bin/vite.js', 'build'], { stdio: 'inherit' });
  if (b.status !== 0) {
    log('build failed');
    process.exit(b.status ?? 1);
  }

  log('starting preview...');
  const child = spawn(...PREVIEW_CMD, { stdio: ['ignore', 'pipe', 'pipe'] });

  const killChild = () => {
    if (!child.killed) {
      try { child.kill(); } catch {}
    }
  };
  process.on('exit', killChild);
  process.on('SIGINT', () => { killChild(); process.exit(130); });
  process.on('SIGTERM', () => { killChild(); process.exit(143); });

  // Wait until server responds
  const url = `http://${HOST}:${PORT}/`;
  const start = Date.now();
  const timeoutMs = 10000;
  let ok = false; let status = 0;
  while (Date.now() - start < timeoutMs) {
    // eslint-disable-next-line no-await-in-loop
    const res = await httpHead(url);
    if (res.ok) { ok = true; status = res.status ?? 200; break; }
    // brief delay
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 100));
  }

  if (!ok) {
    log('server did not respond within timeout');
    killChild();
    process.exit(1);
  }

  log('OK', status, url);
  killChild();
}

main().catch((e) => {
  console.error('[smoke] error', e);
  process.exit(1);
});

