/**
 * Pay Me Twice fullstack server — Node built-ins only.
 * Serves dist/ statically and exposes /api on the same origin (port 5312).
 *
 *   PORT=5312 node server/server.mjs
 *
 * Everything on /api is a sandbox ledger backed by node:sqlite. No real
 * payments, ever.
 */
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { createStore } from './db.mjs';
import {
  evaluateInvoice, normalizeFacts, outcomeLabel, payInvoice, sha256Hex,
} from '../engine/engine.mjs';
import { extractDocument } from '../engine/documents.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(APP_DIR, 'dist');
const DATA_DIR = path.join(APP_DIR, '.data');
const PORT = Number(process.env.PORT || 5312);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

const inflateAsync = (bytes) =>
  new Promise((resolve, reject) => zlib.inflate(bytes, (e, b) => (e ? reject(e) : resolve(b))));

let store;

async function statePayload() {
  const payments = await store.listPayments();
  const attempts = await store.listAttempts();
  const byCurrency = {};
  for (const p of payments) byCurrency[p.currency] = (byCurrency[p.currency] || 0) + p.amountCents;
  return {
    mode: 'sqlite',
    payments,
    attempts,
    stats: {
      paymentsRecorded: payments.length,
      duplicatesBlocked: attempts.filter((a) => a.result === 'Duplicate blocked').length,
      reviewHolds: attempts.filter((a) => a.result === 'Review required').length,
      paidByCurrency: byCurrency,
    },
  };
}

function json(res, code, body) {
  const data = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 8 * 1024 * 1024) { reject(new Error('payload too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function api(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/health') {
    return json(res, 200, { ok: true, mode: 'sqlite', engine: 'node:sqlite', label: 'SQLite backend sandbox — transactional ledger' });
  }
  if (req.method === 'GET' && url.pathname === '/api/state') {
    return json(res, 200, await statePayload());
  }
  if (req.method === 'POST' && url.pathname === '/api/reset') {
    await store.reset();
    return json(res, 200, await statePayload());
  }
  if (req.method === 'POST' && url.pathname === '/api/documents') {
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    const bytes = body.contentBase64 ? Buffer.from(body.contentBase64, 'base64') : Buffer.alloc(0);
    const filename = String(body.filename || 'upload');
    const extracted = await extractDocument(new Uint8Array(bytes), filename, inflateAsync);
    const docHash = bytes.length ? await sha256Hex(new Uint8Array(bytes)) : '';
    return json(res, 200, {
      filename,
      docHash,
      supported: extracted.supported,
      found: extracted.found,
      fields: extracted.supported ? normalizeFacts({ ...extracted.fields, factsSource: 'extracted' }) : null,
      textPreview: extracted.supported ? extracted.text.slice(0, 4000) : '',
    });
  }
  if (req.method === 'POST' && url.pathname === '/api/validate') {
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    const facts = normalizeFacts(body.facts || {});
    const verdict = await store.transaction(() => evaluateInvoice(facts, store));
    const at = await store.transaction(async () => {
      const t = await store.nextTimestamp();
      await store.addAttempt({
        kind: 'validation', requestId: '', actor: body.actor || 'validator',
        supplier: facts.supplier, invoiceNumber: facts.invoiceNumber, currency: facts.currency,
        amountCents: facts.amountCents, period: facts.period,
        result: outcomeLabel(verdict.status),
        note: 'Validation only — no payment requested', at: t,
      });
      return t;
    });
    return json(res, 200, { verdict, at });
  }
  if (req.method === 'POST' && url.pathname === '/api/pay') {
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    const requestId = String(body.requestId || '');
    if (!requestId) return json(res, 400, { error: 'requestId is required' });
    const result = await payInvoice(store, {
      requestId,
      actor: String(body.actor || 'unknown'),
      facts: body.facts || {},
    });
    return json(res, 200, result);
  }
  return json(res, 404, { error: 'not found' });
}

async function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  // Strip GitHub Pages prefix if the Pages build is served through this server.
  rel = rel.replace(/^\/ramp-prototypes\/pay-me-twice\/?/, '/');
  let file = path.join(DIST_DIR, path.normalize(rel).replace(/^([/\\])+/, ''));
  if (!file.startsWith(DIST_DIR)) { res.writeHead(403); return res.end(); }
  try {
    const s = await stat(file);
    if (s.isDirectory()) file = path.join(file, 'index.html');
  } catch {
    file = path.join(DIST_DIR, 'index.html'); // SPA fallback
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found — run `npm run build` first.');
  }
}

export async function startServer(port = PORT, dbPath) {
  mkdirSync(DATA_DIR, { recursive: true });
  store = await createStore(dbPath || path.join(DATA_DIR, 'paymetwice.sqlite'));
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
      return await serveStatic(req, res, url);
    } catch (e) {
      json(res, 500, { error: String(e.message || e) });
    }
  });
  await new Promise((resolve) => server.listen(port, resolve));
  const bound = server.address()?.port ?? port;
  return { server, store, port: bound };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { port } = await startServer(PORT);
  console.log(`Pay Me Twice sandbox → http://localhost:${port}  (SQLite backend, sample data only)`);
}
