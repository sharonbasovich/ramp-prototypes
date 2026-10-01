// server/serve.mjs — static file server for the built SPA (dist/).
// Browser-only sandbox: there is no API, database or shared state here by
// design. All scenario state lives in the tab that created it.

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');
const PORT = Number(process.env.PORT || 5316);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://localhost:${PORT}`);
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    if (path === '/' || path === '\\') path = '/index.html';
    let file = join(DIST, path);
    let st = await stat(file).catch(() => null);
    if (!st || !st.isFile()) {
      // SPA-style fallback for safety; app navigation is hash-based (#guard…)
      file = join(DIST, 'index.html');
      st = await stat(file).catch(() => null);
    }
    if (!st) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found — run `npm run build` first');
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': MIME[extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end(String(err));
  }
});

server.listen(PORT, () => {
  console.log(`Borderless static sandbox → http://localhost:${PORT} (serving dist/, no API)`);
});
