// BorrowFirst full-stack sandbox server.
//   node --experimental-sqlite server/index.mjs
// Serves the built SPA from dist/ plus a same-origin JSON API on port 5313.
// All data is example sandbox data persisted in local node:sqlite.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BorrowFirstStore } from '../server-dist/store.js';
import { allocate } from '../server-dist/allocate.js';
import { seedWorld, defaultRequest, DEMO_NOW } from '../server-dist/fixtures.js';
import { parseAssetCsv } from '../server-dist/csv.js';
import { buildExport } from '../server-dist/export.js';

const PORT = Number(process.env.PORT || 5313);
const ROOT = fileURLToPath(new URL('.', import.meta.url));
const DIST = join(ROOT, '..', 'dist');
const DB_PATH = process.env.BORROWFIRST_DB || ':memory:';

const seed = seedWorld();
const store = new BorrowFirstStore(DB_PATH);
store.reset(seed);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

function world() {
  return store.loadWorld(seed.locations, DEMO_NOW);
}

function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'content-type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json',
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return null;
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const path = url.pathname;

  try {
    if (path === '/api/health') {
      return sendJson(res, 200, { ok: true, backend: 'sqlite', port: PORT });
    }

    if (path === '/api/state' && req.method === 'GET') {
      return sendJson(res, 200, { world: world(), demoNow: DEMO_NOW });
    }

    if (path === '/api/reset' && req.method === 'POST') {
      store.reset(seedWorld());
      return sendJson(res, 200, { world: world(), demoNow: DEMO_NOW });
    }

    if (path === '/api/owner-confirm' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body || typeof body.assetId !== 'string') return sendJson(res, 400, { error: 'assetId required' });
      const ok = store.ownerConfirm(body.assetId, DEMO_NOW);
      if (!ok) return sendJson(res, 404, { error: `unknown asset ${body.assetId}` });
      return sendJson(res, 200, { world: world(), simulated: 'Owner confirmation is simulated for the demo' });
    }

    if (path === '/api/reserve' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body || !body.request || !body.plan) {
        return sendJson(res, 400, { error: 'request and plan required' });
      }
      const result = store.reserve(body.request, body.plan, seed.locations, DEMO_NOW, DEMO_NOW);
      if (!result.ok) return sendJson(res, 409, { failures: result.failures, world: world() });
      return sendJson(res, 200, { reservations: result.reservations, world: world() });
    }

    if (path === '/api/hold' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body || typeof body.assetId !== 'string' || typeof body.expiresAt !== 'string') {
        return sendJson(res, 400, { error: 'assetId and expiresAt required' });
      }
      const r = store.insertHold(body.assetId, body.requestId || 'req-x', body.expiresAt, DEMO_NOW);
      return sendJson(res, 200, { hold: r });
    }

    if (path === '/api/import' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body || typeof body.csv !== 'string') return sendJson(res, 400, { error: 'csv text required' });
      const parsed = parseAssetCsv(body.csv, world());
      if (parsed.assets.length > 0) store.importRows(parsed.assets, parsed.transfers);
      return sendJson(res, 200, { added: parsed.assets.length, errors: parsed.errors, world: world() });
    }

    if (path === '/api/export' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body || !body.plan) return sendJson(res, 400, { error: 'plan required' });
      const doc = buildExport(body.plan, world(), body.reservations ?? [], 'sqlite', DEMO_NOW);
      return sendJson(res, 200, doc);
    }

    if (path === '/api/allocate' && req.method === 'POST') {
      const body = await readBody(req);
      const request = body?.request ?? { ...defaultRequest(), id: `req-${Date.now()}` };
      const plan = allocate(request, world(), DEMO_NOW, body?.opts ?? {});
      return sendJson(res, 200, { plan });
    }

    if (path.startsWith('/api/')) {
      return sendJson(res, 404, { error: 'unknown endpoint' });
    }

    // Static SPA
    if (!existsSync(DIST)) {
      return send(res, 503, 'dist/ not built yet — run npm run build first');
    }
    let rel = decodeURIComponent(path);
    // Strip the GitHub Pages base if the app is served under it.
    rel = rel.replace(/^\/ramp-prototypes\/borrowfirst/, '') || '/';
    let file = normalize(join(DIST, rel));
    if (!file.startsWith(normalize(DIST))) return send(res, 403, 'forbidden');
    if ((await stat(file).catch(() => null))?.isDirectory()) file = join(file, 'index.html');
    try {
      const data = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
      return res.end(data);
    } catch {
      // SPA fallback
      const data = await readFile(join(DIST, 'index.html'));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(data);
    }
  } catch (err) {
    return sendJson(res, 500, { error: String(err) });
  }
});

server.listen(PORT, () => {
  console.log(`BorrowFirst sandbox server on http://localhost:${PORT} (db: ${DB_PATH === ':memory:' ? 'in-memory' : DB_PATH})`);
});
