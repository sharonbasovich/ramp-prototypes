// Cart Tetris sandbox server — Node 22 built-ins only.
// Serves the Vite build from dist/ and a same-origin JSON API backed by
// node:sqlite. All state is demo data persisted inside a transaction; there
// are no real purchases, payments, or external calls.
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT || 5311);
const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const DB_PATH = join(ROOT, 'cart-tetris.sqlite');

const db = new DatabaseSync(DB_PATH);
db.exec('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
const getStmt = db.prepare('SELECT v FROM kv WHERE k = ?');
const putStmt = db.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v');
const delStmt = db.prepare('DELETE FROM kv WHERE k = ?');

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
  '.map': 'application/json',
};

function send(res, code, body, headers = {}) {
  res.writeHead(code, headers);
  res.end(body);
}

function sendJson(res, code, obj) {
  send(res, code, JSON.stringify(obj), { 'content-type': 'application/json' });
}

async function readBody(req, limit = 2_000_000) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new Error('body too large');
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname.replace(/^\.\//, '/').replace(/^\.\//, '/');
  // support both /api/... and ./api/... style paths after relative-base hosting
  const apiPath = url.pathname.replace(/^\//, '').replace(/^api\//, 'api/');
  const isApi = url.pathname.startsWith('/api/') || apiPath.startsWith('api/');

  try {
    if (isApi) {
      const route = url.pathname.includes('/api/') ? url.pathname.slice(url.pathname.indexOf('/api/')) : '/' + apiPath;
      if (route === '/api/health') {
        sendJson(res, 200, { ok: true, store: 'sqlite', mode: 'sandbox', now: new Date().toISOString() });
        return;
      }
      if (route === '/api/state' && req.method === 'GET') {
        const row = getStmt.get('state');
        send(res, 200, row ? row.v : 'null', { 'content-type': 'application/json' });
        return;
      }
      if (route === '/api/state' && req.method === 'PUT') {
        const body = await readBody(req);
        JSON.parse(body); // must be valid JSON
        const tx = db.prepare('BEGIN');
        try {
          tx.run();
          putStmt.run('state', body);
          db.prepare('COMMIT').run();
        } catch (e) {
          db.prepare('ROLLBACK').run();
          throw e;
        }
        sendJson(res, 200, { ok: true });
        return;
      }
      if (route === '/api/state' && req.method === 'DELETE') {
        delStmt.run('state');
        sendJson(res, 200, { ok: true });
        return;
      }
      sendJson(res, 404, { error: 'unknown api route' });
      return;
    }

    // static files
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const filePath = normalize(join(DIST, rel));
    if (!filePath.startsWith(DIST)) {
      send(res, 403, 'forbidden');
      return;
    }
    let st = await stat(filePath).catch(() => null);
    let target = filePath;
    if (!st || !st.isFile()) {
      target = join(DIST, 'index.html');
      st = await stat(target).catch(() => null);
    }
    if (!st) {
      send(res, 503, 'dist/ not built — run `npm run build` first', { 'content-type': 'text/plain' });
      return;
    }
    res.writeHead(200, { 'content-type': MIME[extname(target)] || 'application/octet-stream' });
    createReadStream(target).pipe(res);
  } catch (e) {
    sendJson(res, 500, { error: String(e?.message || e) });
  }
});

server.listen(PORT, () => {
  console.log(`cart-tetris sandbox server on http://localhost:${PORT} (dist: ${DIST})`);
});
