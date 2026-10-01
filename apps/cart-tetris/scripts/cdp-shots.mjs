// Headless-Chrome screenshot driver using raw CDP over Node's built-in
// WebSocket — no npm dependencies. Used to capture docs/screenshots and to
// verify that changed inputs change the rendered output.
// Usage: node scripts/cdp-shots.mjs [port] [outdir]
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const PORT = Number(process.env.APP_PORT || process.argv[2] || 5311);
const OUT = resolve(process.argv[3] || 'docs/screenshots');
const CDP_PORT = 9333;
const BASE = `http://localhost:${PORT}/`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn('google-chrome', [
  '--headless=new',
  `--remote-debugging-port=${CDP_PORT}`,
  '--no-first-run',
  '--disable-gpu',
  '--hide-scrollbars',
  '--window-size=1536,1024',
  'about:blank',
], { stdio: 'ignore' });

let ws;
let msgId = 0;
const pending = new Map();

async function connect() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://localhost:${CDP_PORT}/json`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => {
          ws.onopen = res;
          ws.onerror = rej;
        });
        ws.onmessage = (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pending.has(m.id)) {
            pending.get(m.id)(m);
            pending.delete(m.id);
          }
        };
        return;
      }
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error('chrome CDP not reachable');
}

function send(method, params = {}) {
  const id = ++msgId;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  }).then((r) => {
    if (r.error) throw new Error(`${method}: ${JSON.stringify(r.error)}`);
    return r.result;
  });
}

async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(`eval failed: ${expr} :: ${JSON.stringify(r.exceptionDetails)}`);
  return r.result.value;
}

async function shot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile(`${OUT}/${name}.png`, Buffer.from(data, 'base64'));
  console.log('saved', `${OUT}/${name}.png`);
}

async function setViewport(w, h) {
  await send('Emulation.setDeviceMetricsOverride', {
    width: w, height: h, deviceScaleFactor: 1, mobile: w < 500,
  });
  await sleep(400);
}

const click = (selector) => `document.querySelector(${JSON.stringify(selector)}).click()`;

await mkdir(OUT, { recursive: true });
await connect();
await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: BASE });
await sleep(2500);

// restore seed state (previous sandbox state may persist across runs)
await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Reset demo')?.click()`);
await sleep(800);

// --- desktop 1536x1024, seed plan rendered ------------------------------
await setViewport(1536, 1024);
const seed = await evaluate(`JSON.stringify({
  total: [...document.querySelectorAll('.stat .value')].map(e=>e.textContent),
  alloc: [...document.querySelectorAll('.alloc .chip:not(.money)')].map(e=>e.textContent.trim()),
  mode: document.querySelector('footer .badge')?.textContent,
})`);
console.log('seed state:', seed);
await shot('desktop-seed');

// geometry: concept targets — content at x≈42, cost card top ≈538, approve
// row inside the 1024 viewport without scrolling
const geom1536 = await evaluate(`JSON.stringify((() => {
  const left = Math.round(document.querySelector('.grid .card').getBoundingClientRect().x);
  const cost = Math.round(document.querySelector('[aria-label="Cost comparison"]').getBoundingClientRect().top);
  const ra = document.querySelector('.result-actions').getBoundingClientRect();
  return { contentLeft: left, costTop: cost, approveBottom: Math.round(ra.bottom), vh: window.innerHeight };
})())`);
console.log('geometry@1536:', geom1536);

// --- regression: import brand-new vendor ids while a stale plan is shown ----
// previously crashed ResultsPanel resolving old orders against new vendors.
await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Import quotes'))?.click()`);
await sleep(400);
await evaluate(`(() => {
  const ta = document.querySelector('.modal textarea');
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  set.call(ta, ${JSON.stringify('{"currency":"USD","quotedAt":"2026-09-01","validUntil":"2027-06-01","vendors":[{"id":"newco","name":"New Co","deliveryDays":2,"shippingCents":300,"freeShipThresholdCents":null,"minOrderCents":null,"quotes":{"coffee":{"skuId":"coffee","unitCents":900,"stock":10},"cups":{"skuId":"cups","unitCents":300,"stock":10},"snack-bars":{"skuId":"snack-bars","unitCents":600,"stock":10}}}]}')});
  ta.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await sleep(200);
await evaluate(`[...document.querySelectorAll('.modal button')].find(b=>b.textContent.includes('Validate'))?.click()`);
await sleep(600);
const afterImport = await evaluate(`JSON.stringify({
  allocRows: document.querySelectorAll('.alloc tbody tr').length,
  stale: document.querySelector('.stale-note')?.textContent ?? null,
  crashed: !document.querySelector('.page'),
})`);
console.log('after new-vendor import (stale plan kept):', afterImport);
await shot('desktop-import-new-vendors');
await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Reset demo')?.click()`);
await sleep(800);

// --- changed input: deadline 3 -> 1 day, recompute ----------------------
await evaluate(`(() => {
  const sel = document.querySelector('#deadline');
  sel.value = '1';
  sel.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await sleep(300);
const stale = await evaluate(`document.querySelector('.stale-note')?.textContent ?? null`);
console.log('stale note after input change:', stale);
await evaluate(click('.list-actions .btn.primary'));
await sleep(600);
const oneDay = await evaluate(`JSON.stringify({
  total: [...document.querySelectorAll('.stat .value')].map(e=>e.textContent),
})`);
console.log('after 1-day deadline:', oneDay);
await shot('desktop-1day-deadline');

// --- approve + export state ---------------------------------------------
await evaluate(`(() => {
  const sel = document.querySelector('#deadline');
  sel.value = '3';
  sel.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await evaluate(click('.list-actions .btn.primary'));
await sleep(500);
await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Approve purchase plan'))?.click()`);
await sleep(400);
const approved = await evaluate(`JSON.stringify({
  badge: document.querySelector('.badge.ok')?.textContent ?? null,
  exportDisabled: [...document.querySelectorAll('button')].find(b=>b.textContent.includes('Export plan'))?.disabled,
})`);
console.log('approval state:', approved);
await evaluate(`document.querySelector('.result-actions')?.scrollIntoView({block:'center'})`);
await sleep(300);
await shot('desktop-approved');

// --- approval invalidation on input change --------------------------------
await evaluate(`[...document.querySelectorAll('.stepper button')].find(b=>b.getAttribute('aria-label')==='Increase Coffee')?.click()`);
await sleep(400);
const voided = await evaluate(`document.querySelector('.badge.warn')?.textContent ?? null`);
console.log('after qty change:', voided);
await shot('desktop-approval-voided');

// --- regression: restore original inputs + recompute must NOT resurrect the
// revoked approval ----------------------------------------------------------
await evaluate(`[...document.querySelectorAll('.stepper button')].find(b=>b.getAttribute('aria-label')==='Decrease Coffee')?.click()`);
await sleep(200);
await evaluate(click('.list-actions .btn.primary'));
await sleep(600);
const resurrect = await evaluate(`JSON.stringify({
  badge: document.querySelector('.result-actions .badge')?.textContent ?? null,
  exportDisabled: [...document.querySelectorAll('button')].find(b=>b.textContent.includes('Export plan'))?.disabled,
})`);
console.log('after restoring inputs (approval must stay void):', resurrect);
await shot('desktop-approval-still-void');
await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Reset demo')?.click()`);
await sleep(800);

// --- quotes editor (editable inputs) --------------------------------------
await evaluate(`document.querySelector('details.quotes')?.scrollIntoView({block:'start'})`);
await sleep(400);
await shot('desktop-quotes-editor');

// --- 1366x768: savings + approve row must fit in the first viewport ---------
await evaluate(`window.scrollTo(0,0)`);
await setViewport(1366, 768);
const geom1366 = await evaluate(`JSON.stringify((() => {
  const ra = document.querySelector('.result-actions').getBoundingClientRect();
  const cost = Math.round(document.querySelector('[aria-label="Cost comparison"]').getBoundingClientRect().top);
  return { costTop: cost, approveBottom: Math.round(ra.bottom), approveVisible: ra.bottom <= window.innerHeight, vh: window.innerHeight };
})())`);
console.log('geometry@1366:', geom1366);
await shot('desktop-1366');

// --- mobile 390 (reset demo first so seed quantities are restored) ----------
await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Reset demo')?.click()`);
await sleep(400);
await evaluate(`location.reload()`);
await sleep(2200);
await setViewport(390, 844);
await sleep(600);
await evaluate(`window.scrollTo(0,0)`);
await shot('mobile-top');
await evaluate(`window.scrollTo(0,900)`);
await sleep(400);
await shot('mobile-results');

console.log('DONE');
ws.close();
chrome.kill();
process.exit(0);
