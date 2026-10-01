#!/usr/bin/env node
// Workspace runner: discovers apps/*/ that have a package.json and runs one
// command inside each. Apps that have not landed yet are skipped, so this
// works while sibling builders deliver their directories.
// Usage: node scripts/run-apps.mjs ci|test|build|start|hub
import { readdirSync, existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const APPS_DIR = join(ROOT, 'apps');
const cmd = process.argv[2] || 'ci';
const only = process.env.APP; // optional single-app filter

const PORTS = {
  'cart-tetris': 5311,
  'pay-me-twice': 5312,
  borrowfirst: 5313,
  'budget-brawl': 5314,
  exitlane: 5315,
};

// Cross-platform npm invocation: prefer running the npm CLI script under the
// current Node binary (works everywhere, no .cmd shim needed); fall back to
// the platform npm launcher when npm_execpath is not set (script invoked
// outside an npm context).
function npmLaunch(args) {
  const cli = process.env.npm_execpath;
  if (cli && cli.endsWith('.js') && existsSync(cli)) {
    return { command: process.execPath, args: [cli, ...args], shell: false };
  }
  return {
    command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
    args,
    shell: process.platform === 'win32',
  };
}

function apps() {
  if (!existsSync(APPS_DIR)) return [];
  return readdirSync(APPS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(APPS_DIR, d.name, 'package.json')))
    .map((d) => d.name)
    .filter((n) => !only || n === only)
    .sort();
}

function npmCmd(slug) {
  switch (cmd) {
    case 'ci':
      return existsSync(join(APPS_DIR, slug, 'package-lock.json')) ? ['ci'] : ['install'];
    case 'test':
      return ['test'];
    case 'build':
      return ['run', 'build'];
    case 'start':
      return ['start'];
    default:
      throw new Error(`unknown command ${cmd}`);
  }
}

function runSequential() {
  const list = apps();
  if (list.length === 0) {
    console.log('no apps found under apps/*/ (nothing to do yet)');
    return 0;
  }
  let failed = 0;
  for (const slug of list) {
    const launch = npmLaunch(npmCmd(slug));
    console.log(`\n=== ${slug}: npm ${npmCmd(slug).join(' ')} ===`);
    const r = spawnSync(launch.command, launch.args, {
      cwd: join(APPS_DIR, slug),
      stdio: 'inherit',
      env: process.env,
      shell: launch.shell,
    });
    if (r.error) {
      console.error(`${slug}: could not launch npm: ${r.error.message}`);
      failed++;
    } else if (r.status !== 0) {
      failed++;
    }
  }
  console.log(`\n${cmd}: ${list.length - failed}/${list.length} app(s) ok`);
  return failed === 0 ? 0 : 1;
}

function runStart() {
  const list = apps();
  if (list.length === 0) {
    console.log('no apps found under apps/*/ — run npm run setup after an app lands');
    process.exit(1);
  }
  // Servers serve dist/, so build any app that has not been built yet —
  // `npm run setup && npm start` must work on a fresh clone.
  for (const slug of list) {
    if (existsSync(join(APPS_DIR, slug, 'dist', 'index.html'))) continue;
    console.log(`=== ${slug}: building dist (npm run build) ===`);
    const launch = npmLaunch(['run', 'build']);
    const r = spawnSync(launch.command, launch.args, {
      cwd: join(APPS_DIR, slug),
      stdio: 'inherit',
      env: process.env,
      shell: launch.shell,
    });
    if (r.error || r.status !== 0) {
      console.error(`${slug}: build failed${r.error ? ` (${r.error.message})` : ''} — skipping`);
      list.splice(list.indexOf(slug), 1);
    }
  }
  if (list.length === 0) process.exit(1);
  console.log('starting sandbox servers (Ctrl+C stops all):');
  const kids = [];
  for (const slug of list) {
    const port = PORTS[slug] ?? '????';
    console.log(`  ${slug.padEnd(14)} http://localhost:${port}`);
    const launch = npmLaunch(['start']);
    const k = spawn(launch.command, launch.args, {
      cwd: join(APPS_DIR, slug),
      stdio: ['ignore', 'inherit', 'inherit'],
      env: { ...process.env, PORT: String(port) },
      shell: launch.shell,
    });
    k.on('error', (e) => console.error(`${slug}: cannot start npm: ${e.message}`));
    kids.push(k);
  }
  const stop = () => kids.forEach((k) => k.kill('SIGTERM'));
  process.on('SIGINT', () => {
    stop();
    process.exit(0);
  });
  process.on('SIGTERM', stop);
}

function runHub() {
  const port = 5300;
  createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(await readFile(join(ROOT, 'hub', 'index.html'), 'utf8'));
      return;
    }
    // Keep the hub's relative ./<slug>/ links working locally: on Pages they
    // resolve to the deployed directory; here they redirect to the app's own
    // sandbox server.
    const slug = url.pathname.split('/').filter(Boolean)[0];
    if (slug && PORTS[slug]) {
      res.writeHead(302, { location: `http://localhost:${PORTS[slug]}/` });
      res.end();
      return;
    }
    res.writeHead(404);
    res.end('not found — apps run on their own ports (see npm start)');
  }).listen(port, () => console.log(`demo hub on http://localhost:${port} (apps: npm start)`));
}

if (cmd === 'start') runStart();
else if (cmd === 'hub') runHub();
else process.exit(runSequential());
