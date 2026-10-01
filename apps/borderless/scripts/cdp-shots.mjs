// Headless-Chrome evidence driver for Borderless — raw CDP, no npm deps.
// Captures docs/screenshots at 1536x1024, 1366x768, and 390px mobile, and
// asserts the key ACCEPTANCE flows (approval invalidation, blocked commit,
// single debit, ambiguity hold, CAD preflight, complete-cost winner).
// Usage: node scripts/cdp-shots.mjs   (requires `npm start` on :5316)
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const PORT = Number(process.env.APP_PORT || process.argv[2] || 5316);
const OUT = resolve(process.argv[3] || 'docs/screenshots');
const CDP_PORT = 9337;
const BASE = `http://localhost:${PORT}/`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures.push(name);
};

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
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
        };
        return;
      }
    } catch { /* not up yet */ }
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
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 500 });
  await sleep(400);
}

async function nav(hash) {
  await send('Page.navigate', { url: BASE + '?shot=' + Date.now() + hash });
  await sleep(1800);
}

const clickByText = (text, contains = true) =>
  `[...document.querySelectorAll('button')].find(b=>${contains ? `b.textContent.includes(${JSON.stringify(text)})` : `b.textContent.trim()===${JSON.stringify(text)}`}&&!b.disabled)?.click()`;

// set a React-controlled <input>/<select> value
const setField = (sel, value) => `(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
})()`;
const pressEnter = (sel) =>
  `document.querySelector(${JSON.stringify(sel)}).dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true}))`;
const setSelect = (sel, value) => `(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('change', { bubbles: true }));
})()`;

const panelText = `document.querySelector('.panel')?.textContent ?? ''`;
const statusText = `document.querySelector('.status-line')?.textContent ?? ''`;

await mkdir(OUT, { recursive: true });
await connect();
await send('Page.enable');
await send('Runtime.enable');

// ================= FX GUARD =================
await setViewport(1536, 1024);
await nav('#guard');
await evaluate(`window.scrollTo(0,0)`);
await shot('desktop-guard-seed');

// approve → commit → repeat commit is a no-op
await evaluate(clickByText('Approve quote'));
await sleep(400);
check('guard: approval current', await evaluate(`${statusText}.includes('Approval current')`));
await shot('desktop-guard-approved');
await evaluate(clickByText('Commit sandbox payment'));
await sleep(400);
check('guard: committed', await evaluate(`${statusText}.includes('Committed')`));
await evaluate(clickByText('Commit sandbox payment'));
await sleep(400);
const ledgerCount = await evaluate(`[...document.querySelectorAll('.trail li')].filter(li=>li.textContent.includes('Committed')).length`);
check('guard: single debit only', ledgerCount === 1, `committed rows=${ledgerCount}, trail=${await evaluate(`[...document.querySelectorAll('.trail li')].map(li=>li.textContent).join(' | ')`)}`);
await evaluate(`document.querySelector('.trail')?.scrollIntoView({block:'end'})`);
await sleep(300);
await shot('desktop-guard-committed');
await evaluate(`window.scrollTo(0,0)`);

// simulate FX move → USD 1,016 over budget, approval stale, commit blocked
await evaluate(clickByText('Reset scenario'));
await sleep(400);
await evaluate(clickByText('Approve quote'));
await sleep(300);
await evaluate(clickByText('Simulate FX move'));
await sleep(400);
check('guard: 1016 over-budget debit', await evaluate(`${panelText}.includes('USD 1,016.00')`));
check('guard: approval invalidated by move', await evaluate(`/(revoked|stale|expired|exceeds)/i.test(${statusText})`), await evaluate(statusText));
check('guard: commit disabled', await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Commit sandbox payment')).disabled`));
await shot('desktop-guard-simulated-overbudget');

// edit rate back to 1.08 → approval stays revoked (sticky)
await evaluate(clickByText('Edit scenario inputs'));
await sleep(300);
await evaluate(setField('#g-rate', '1.08'));
await evaluate(pressEnter('#g-rate'));
await sleep(400);
const revokedAfterRevert = await evaluate(`${statusText}`);
check('guard: edit-back still revoked', /revoked|stale|not approved/i.test(revokedAfterRevert), revokedAfterRevert.slice(0, 80));
await shot('desktop-guard-edit-back-still-revoked');

// expiry blocks commit
await evaluate(clickByText('Reset scenario'));
await sleep(400);
await evaluate(clickByText('Approve quote'));
await sleep(300);
await evaluate(clickByText('Expire quote'));
await sleep(400);
check('guard: expired blocks commit', await evaluate(`${statusText}.toLowerCase().includes('expired')`));
await shot('desktop-guard-expired');

// ================= CURRENCY CHECK =================
await nav('#check');
await evaluate(`window.scrollTo(0,0)`);
await shot('desktop-check-held');

// resolve $ → CAD + en-US, validate → normalized but CA-USD funding blocked
const selects = await evaluate(`[...document.querySelectorAll('select')].map(s=>[s.id||'', s.ariaLabel||s.labels?.[0]?.textContent||''])`);
console.log('check selects:', selects);
await evaluate(`(() => {
  const [cur, fmt, ent, fund] = [...document.querySelectorAll('select')];
  const set = (el,v) => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,v); el.dispatchEvent(new Event('change',{bubbles:true})); };
  set(cur, 'CAD'); set(fmt, 'en-US'); set(fund, 'ca-usd');
})()`);
await sleep(300);
await evaluate(clickByText('Validate invoice'));
await sleep(400);
check('check: parsed CAD 125000', await evaluate(`${panelText}.includes('125000')`));
check('check: USD funding blocked', await evaluate(`${panelText}.includes('blocked')`));
await shot('desktop-check-normalized-blocked');

// switch to Canada·CAD → preflight passed → save enabled → save
await evaluate(`(() => {
  const fund = [...document.querySelectorAll('select')][3];
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(fund,'ca-cad');
  fund.dispatchEvent(new Event('change',{bubbles:true}));
})()`);
await sleep(300);
await evaluate(clickByText('Validate invoice'));
await sleep(400);
check('check: CAD preflight passed', await evaluate(`${panelText}.includes('funding-currency preflight passed')`));
check('check: save enabled', await evaluate(`![...document.querySelectorAll('button')].find(b=>b.textContent.includes('Save normalized invoice')).disabled`));
await evaluate(clickByText('Save normalized invoice'));
await sleep(400);
check('check: record saved', await evaluate(`document.body.textContent.includes('sandbox record')`));
await evaluate(`document.querySelector('.trail')?.scrollIntoView({block:'center'})`);
await sleep(300);
await shot('desktop-check-preflight-saved');
await evaluate(`window.scrollTo(0,0)`);

// ================= TRUE COST =================
await nav('#cost');
await evaluate(`window.scrollTo(0,0)`);
check('cost: USD 30 difference', await evaluate(`${panelText}.includes('USD 30.00')`));
check('cost: Boston complete winner', await evaluate(`${panelText}.includes('Boston Supply')`));
await shot('desktop-cost-comparison');
await evaluate(clickByText('Choose lowest complete cost'));
await sleep(400);
check('cost: selection recorded', await evaluate(`${panelText}.includes('current')`));
await evaluate(`document.querySelector('.trail')?.scrollIntoView({block:'center'})`);
await sleep(300);
await shot('desktop-cost-selected');

// ================= 1366x768 =================
await setViewport(1366, 768);
await nav('#guard');
await evaluate(`window.scrollTo(0,0)`);
await shot('desktop-1366-guard');

// ================= 390px mobile =================
await setViewport(390, 844);
for (const [hash, name] of [['#guard', 'mobile-guard'], ['#check', 'mobile-check'], ['#cost', 'mobile-cost']]) {
  await nav(hash);
  await evaluate(`window.scrollTo(0,0)`);
  const sw = await evaluate('document.documentElement.scrollWidth');
  check(`mobile ${hash}: content fits 390`, sw <= 390, `scrollWidth=${sw}`);
  await shot(name);
}

console.log(failures.length ? `DONE — ${failures.length} FAILED: ${failures.join(', ')}` : 'DONE — all checks passed');
ws.close();
chrome.kill();
process.exit(failures.length ? 1 : 0);
