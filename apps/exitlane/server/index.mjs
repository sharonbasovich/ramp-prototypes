// server/index.mjs — ExitLane fullstack server.
// Serves the built SPA (dist/) and a same-origin JSON API backed by
// node:sqlite. No external services — sandbox providers are scripted and
// labeled simulated; nothing ever contacts a real vendor.

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSqlStore } from './sqlstore.mjs';
import * as engine from '../shared/engine.mjs';
import { buildSeed, DEFAULT_SEED } from '../shared/seed.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');
const PORT = Number(process.env.PORT || 5315);
const DB_PATH = process.env.EXITLANE_DB || join(ROOT, '.data', 'exitlane.sqlite');
const BASE_PREFIX = '/ramp-prototypes/exitlane';

const store = createSqlStore(DB_PATH);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(payload);
}

function sendOp(res, op) {
  if (!op.ok) {
    sendJson(res, op.status ?? 400, { ok: false, error: { code: op.code, detail: op.detail } });
    return;
  }
  sendJson(res, 200, { ok: true, result: op.result });
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error('body too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('invalid JSON body');
  }
}

async function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel.startsWith(BASE_PREFIX)) rel = rel.slice(BASE_PREFIX.length) || '/';
  if (rel === '/' || rel === '') rel = '/index.html';
  const filePath = normalize(join(DIST, rel));
  if (!filePath.startsWith(DIST)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  let file = filePath;
  try {
    const s = await stat(file);
    if (s.isDirectory()) file = join(file, 'index.html');
  } catch {
    file = join(DIST, 'index.html'); // SPA fallback
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found — run `npm run build` first (the /api still works)');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;
  try {
    if (path === '/api/health' && req.method === 'GET') {
      sendJson(res, 200, { ok: true, engine: 'sqlite', mode: 'SQLite backend sandbox', epoch: store.epoch() });
      return;
    }
    if (path === '/api/state' && req.method === 'GET') {
      sendJson(res, 200, { ok: true, result: engine.snapshot(store) });
      return;
    }
    if (path === '/api/reset' && req.method === 'POST') {
      const body = await readBody(req);
      const built = buildSeed(body.config);
      if (!built.ok) {
        sendJson(res, 400, { ok: false, error: { code: 'invalid_config', detail: built.error } });
        return;
      }
      const snap = engine.reset(store, built.seed);
      sendJson(res, 200, { ok: true, result: snap });
      return;
    }
    if (path === '/api/clock' && req.method === 'POST') {
      const body = await readBody(req);
      sendOp(res, engine.setClock(store, body.instant));
      return;
    }
    if (path === '/api/event/cancel' && req.method === 'POST') {
      sendOp(res, engine.cancelEvent(store));
      return;
    }
    if (path === '/api/packet/prepare' && req.method === 'POST') {
      sendOp(res, engine.preparePacket(store));
      return;
    }
    if (path === '/api/packet/approve' && req.method === 'POST') {
      sendOp(res, engine.approvePacket(store));
      return;
    }
    if (path === '/api/packet/execute' && req.method === 'POST') {
      sendOp(res, engine.executePacket(store));
      return;
    }
    if (path === '/api/packet/export' && req.method === 'GET') {
      sendJson(res, 200, { ok: true, result: engine.exportPacket(store, 'SQLite backend sandbox') });
      return;
    }
    const execMatch = path.match(/^\/api\/requests\/([^/]+)\/(execute|refund-received)$/);
    if (execMatch && req.method === 'POST') {
      const [, requestId, action] = execMatch;
      sendOp(
        res,
        action === 'execute'
          ? engine.executeRequest(store, decodeURIComponent(requestId))
          : engine.markRefundReceived(store, decodeURIComponent(requestId)),
      );
      return;
    }
    if (path === '/api/bookings/amounts' && req.method === 'POST') {
      const body = await readBody(req);
      sendOp(
        res,
        engine.editBookingAmounts(store, String(body?.bookingId ?? ''), {
          committedMinor: body?.committedMinor,
          paidMinor: body?.paidMinor,
          unpaidMinor: body?.unpaidMinor,
        }),
      );
      return;
    }
    if (path.startsWith('/api/')) {
      sendJson(res, 404, { ok: false, error: { code: 'not_found', detail: `no such API route: ${path}` } });
      return;
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      await serveStatic(req, res, path);
      return;
    }
    sendJson(res, 405, { ok: false, error: { code: 'method_not_allowed', detail: req.method } });
  } catch (err) {
    sendJson(res, 500, { ok: false, error: { code: 'internal', detail: String(err?.message ?? err) } });
  }
});

const DEFAULT_SEED_REF = DEFAULT_SEED;
void DEFAULT_SEED_REF;

server.listen(PORT, () => {
  console.log(`ExitLane sandbox (SQLite backend) on http://localhost:${PORT}`);
  console.log(`Static SPA served from ${DIST} (also under ${BASE_PREFIX}/)`);
});

export { server, store };
