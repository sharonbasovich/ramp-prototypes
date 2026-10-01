// tests/acceptance.test.mjs — independent acceptance suite.
// Constructs its own wallet/catalog/agents via POST /api/reset, drives the app
// over real HTTP (including concurrent bursts), and inspects only observable
// API outcomes + persisted state. It does not import the app's engine logic.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = fileURLToPath(new URL('..', import.meta.url));
const PORT = 5414; // distinct from the app's 5314 so tests never collide
const BASE = `http://127.0.0.1:${PORT}`;

// Test-owned seed: deliberately different values from the app's demo seed so
// nothing is inherited. Budget $90, threshold $40, test catalog/agents.
const SEED = {
  wallet: { budgetMinor: 9000, approvalThresholdMinor: 4000, quoteTtlMs: 120000 },
  catalog: [
    { itemId: 'widget', name: 'Widget', priceMinor: 6000, category: 'T' },
    { itemId: 'sprocket', name: 'Sprocket', priceMinor: 4500, category: 'T' },
    { itemId: 'lux', name: 'Lux gizmo', priceMinor: 8000, category: 'T' },
    { itemId: 'forbidden', name: 'Forbidden thing', priceMinor: 500, category: 'T' },
  ],
  agents: [
    { agentId: 'agt-a', name: 'Agent A', lane: 'a', items: ['widget', 'sprocket', 'lux'] },
    { agentId: 'agt-b', name: 'Agent B', lane: 'b', items: ['widget', 'sprocket', 'lux'] },
    { agentId: 'agt-c', name: 'Agent C', lane: 'c', items: ['sprocket'] },
  ],
};

let child;
let tmpDir;
let rid = 0;
const ridOf = (p) => `${p}-${++rid}`;

async function api(path, body, method = body === undefined ? 'GET' : 'POST') {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json();
  return { status: res.status, json };
}

async function state() {
  const { status, json } = await api('/api/state');
  assert.equal(status, 200);
  assert.equal(json.ok, true);
  return json.result;
}

async function place(body) {
  return api('/api/requests', body);
}

async function act(id, action) {
  return api(`/api/requests/${encodeURIComponent(id)}/${action}`, {});
}

async function resetToTestSeed() {
  const { status, json } = await api('/api/reset', { config: SEED });
  assert.equal(status, 200);
  assert.equal(json.ok, true);
}

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('server did not start');
}

before(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'bb-test-'));
  child = spawn(process.execPath, [join(APP, 'server', 'index.mjs')], {
    env: {
      ...process.env,
      PORT: String(PORT),
      BUDGET_BRAWL_DB: join(tmpDir, 'test.sqlite'),
    },
    stdio: 'pipe',
  });
  child.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));
  await waitForServer();
});

after(() => {
  child?.kill('SIGTERM');
  rmSync(tmpDir, { recursive: true, force: true });
});

test('competing reservations: 20 parallel $60 requests on a $90 wallet -> exactly one holds funds', async () => {
  await resetToTestSeed();
  const results = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      place({ requestId: `race-${i}`, agentId: 'agt-a', itemId: 'widget', qty: 1 }),
    ),
  );
  const oks = results.map((r) => r.json.result ?? r.json);
  // $60 > $40 threshold => winners pend approval holding funds; losers can't hold.
  const held = oks.filter((r) => r.fundsHeld);
  assert.equal(held.length, 1, `expected exactly one held reservation, got ${held.length}`);
  const s = await state();
  assert.equal(s.totals.spentMinor + s.totals.reservedMinor <= s.totals.budgetMinor, true);
  assert.equal(s.totals.availableMinor, 3000, 'one $60 hold on a $90 wallet leaves $30');
  assert.ok(s.totals.availableMinor >= 0);
});

test('reserve then commit: $60 spent/$0 reserved/$30 available; commit does not change available', async () => {
  await resetToTestSeed();
  // set threshold above the item so the request reserves directly
  const cfg = await api('/api/config', { approvalThresholdMinor: 9000 });
  assert.equal(cfg.json.ok, true);
  const r = await place({ requestId: ridOf('c'), agentId: 'agt-a', itemId: 'widget', qty: 1 });
  assert.equal(r.json.result.status, 'reserved');
  const before = await state();
  assert.equal(before.totals.reservedMinor, 6000);
  const c = await act(r.json.result.requestId, 'commit');
  assert.equal(c.json.ok, true);
  assert.equal(c.json.result.status, 'committed');
  const after = await state();
  assert.equal(after.totals.spentMinor, 6000);
  assert.equal(after.totals.reservedMinor, 0);
  assert.equal(after.totals.availableMinor, before.totals.availableMinor);
});

test('replayed purchase: same request ID returns the same purchase, no second charge', async () => {
  await resetToTestSeed();
  await api('/api/config', { approvalThresholdMinor: 9000 });
  const id = ridOf('replay');
  await place({ requestId: id, agentId: 'agt-a', itemId: 'widget', qty: 1 });
  const c1 = await act(id, 'commit');
  const s1 = await state();
  const r2 = await place({ requestId: id, agentId: 'agt-a', itemId: 'widget', qty: 1 });
  assert.equal(r2.json.result.replayed, true);
  assert.equal(r2.json.result.purchaseId, c1.json.result.purchaseId);
  const s2 = await state();
  assert.equal(s2.totals.spentMinor, s1.totals.spentMinor);
  assert.equal(s2.purchases.length, 1);
  // replayed commit also stable
  const c2 = await act(id, 'commit');
  assert.equal(c2.json.ok, true);
  assert.equal(c2.json.result.purchaseId, s2.purchases[0].purchaseId);
});

test('double cancellation: funds return exactly once', async () => {
  await resetToTestSeed();
  await api('/api/config', { approvalThresholdMinor: 9000 });
  const id = ridOf('cancel');
  await place({ requestId: id, agentId: 'agt-a', itemId: 'widget', qty: 1 });
  const c1 = await act(id, 'cancel');
  assert.equal(c1.json.ok, true);
  assert.equal(c1.json.result.status, 'cancelled');
  const mid = await state();
  assert.equal(mid.totals.availableMinor, 9000);
  const c2 = await act(id, 'cancel');
  assert.equal(c2.json.ok, true);
  const after = await state();
  assert.equal(after.totals.availableMinor, 9000, 'second cancel must not return funds again');
});

test('untrusted price: forged $1 claim is ignored; server charges catalog $60', async () => {
  await resetToTestSeed();
  await api('/api/config', { approvalThresholdMinor: 9000 });
  const r = await place({
    requestId: ridOf('forge'),
    agentId: 'agt-a',
    itemId: 'widget',
    qty: 1,
    claimedPriceMinor: 100,
  });
  assert.equal(r.json.ok, true);
  assert.equal(r.json.result.amountMinor, 6000);
  assert.equal(r.json.result.priceOverridden, true);
  const s = await state();
  assert.equal(s.totals.reservedMinor, 6000, 'reservation must use the catalog price');
});

test('invalid quantity: negative, zero, fractional, unknown item all rejected without ledger change', async () => {
  await resetToTestSeed();
  for (const bad of [
    { qty: -1 }, { qty: 0 }, { qty: 1.5 }, { qty: 1e9 },
  ]) {
    const r = await place({ requestId: ridOf('bad'), agentId: 'agt-a', itemId: 'widget', ...bad });
    assert.equal(r.status, 400, `qty=${bad.qty} should 400`);
    assert.equal(r.json.ok, false);
  }
  const r = await place({ requestId: ridOf('bad'), agentId: 'agt-a', itemId: 'nope', qty: 1 });
  assert.equal(r.status, 400);
  const s = await state();
  assert.equal(s.requests.length, 0, 'invalid input must not create request rows');
  assert.equal(s.totals.availableMinor, 9000);
});

test('approval under scarcity: approved request cannot overspend; waits for funds', async () => {
  await resetToTestSeed();
  // threshold $40: lux ($80) needs approval. First agent reserves widget $60
  // under no-threshold... raise threshold so widget reserves without approval.
  await api('/api/config', { approvalThresholdMinor: 6500 });
  const w = await place({ requestId: ridOf('win'), agentId: 'agt-a', itemId: 'widget', qty: 1 });
  assert.equal(w.json.result.status, 'reserved'); // $60 <= $65, holds funds
  const lux = await place({ requestId: ridOf('lux'), agentId: 'agt-b', itemId: 'lux', qty: 1 });
  assert.equal(lux.json.result.status, 'awaiting_approval');
  assert.equal(lux.json.result.fundsHeld, false, 'only $30 available — must not hold');
  // Approve while funds are consumed: must not overspend.
  const ap = await act(lux.json.result.requestId, 'approve');
  assert.equal(ap.json.ok, true);
  assert.equal(ap.json.result.status, 'awaiting_funds');
  const s = await state();
  assert.ok(s.totals.spentMinor + s.totals.reservedMinor <= s.totals.budgetMinor);
  // Free the funds: the approved request can then be placed.
  await act(w.json.result.requestId, 'cancel');
  const ap2 = await act(lux.json.result.requestId, 'approve');
  assert.equal(ap2.json.result.status, 'reserved');
  assert.equal(ap2.json.result.fundsHeld, true);
});

test('expired quote: commit past TTL is refused and balances are conserved', async () => {
  await resetToTestSeed();
  await api('/api/config', { approvalThresholdMinor: 9000, quoteTtlMs: 500 });
  const r = await place({ requestId: ridOf('ttl'), agentId: 'agt-a', itemId: 'widget', qty: 1 });
  assert.equal(r.json.result.status, 'reserved');
  await new Promise((r2) => setTimeout(r2, 900));
  const c = await act(r.json.result.requestId, 'commit');
  assert.equal(c.json.ok, true);
  assert.equal(c.json.result.status, 'expired');
  const s = await state();
  assert.equal(s.totals.spentMinor, 0);
  assert.equal(s.totals.reservedMinor, 0);
  assert.equal(s.totals.availableMinor, 9000);
});

test('stale quote: catalog price change between quote and commit releases the hold', async () => {
  await resetToTestSeed();
  await api('/api/config', { approvalThresholdMinor: 9000 });
  const r = await place({ requestId: ridOf('stale'), agentId: 'agt-a', itemId: 'widget', qty: 1 });
  assert.equal(r.json.result.status, 'reserved');
  await api('/api/catalog/price', { itemId: 'widget', priceMinor: 7000 });
  const c = await act(r.json.result.requestId, 'commit');
  assert.equal(c.json.result.status, 'expired');
  assert.equal(c.json.result.reason, 'quote_stale');
  const s = await state();
  assert.equal(s.totals.availableMinor, 9000, 'stale quote releases funds, never charges old price');
});

test('commit/cancel race: exactly one terminal transition', async () => {
  await resetToTestSeed();
  await api('/api/config', { approvalThresholdMinor: 9000 });
  const r = await place({ requestId: ridOf('rc'), agentId: 'agt-a', itemId: 'widget', qty: 1 });
  const id = r.json.result.requestId;
  const [a, b] = await Promise.all([act(id, 'commit'), act(id, 'cancel')]);
  const statuses = [a, b].map((x) => (x.json.ok ? x.json.result.status : `ERR${x.status}`));
  const final = await state();
  const row = final.requests.find((x) => x.requestId === id);
  assert.ok(
    (row.status === 'committed' && final.totals.spentMinor === 6000) ||
      (row.status === 'cancelled' && final.totals.availableMinor === 9000),
    `exactly one terminal effect; got ${statuses} final=${row.status}`,
  );
  // never both: spent XOR refund
  assert.notEqual(row.status === 'committed' && final.totals.availableMinor === 9000, true);
});

test('unauthorized agent: forbidden item denied for permission, wallet unchanged', async () => {
  await resetToTestSeed();
  const r = await place({ requestId: ridOf('perm'), agentId: 'agt-c', itemId: 'widget', qty: 1 });
  assert.equal(r.json.ok, true);
  assert.equal(r.json.result.status, 'denied');
  assert.equal(r.json.result.reason, 'not_permitted');
  const s = await state();
  assert.equal(s.totals.availableMinor, 9000);
  // an unknown agent mutating another's reservation is a clean 404/400
  const r2 = await place({ requestId: ridOf('perm'), agentId: 'agt-c', itemId: 'sprocket', qty: 1 });
  const ghost = await act('nonexistent-id', 'cancel');
  assert.equal(ghost.status, 404);
  const r3 = await place({ requestId: ridOf('perm'), agentId: 'ghost-agent', itemId: 'widget', qty: 1 });
  assert.equal(r3.status, 400);
});

test('clean reset: new epoch balance; old request ids cannot mutate the new wallet', async () => {
  await resetToTestSeed();
  await api('/api/config', { approvalThresholdMinor: 9000 });
  const id = ridOf('epoch');
  await place({ requestId: id, agentId: 'agt-a', itemId: 'widget', qty: 1 });
  const e1 = (await state()).epoch;
  await resetToTestSeed();
  const s = await state();
  assert.equal(s.epoch, e1 + 1);
  assert.equal(s.totals.availableMinor, 9000);
  // committing the pre-reset reservation id must fail — it belongs to a dead epoch
  const c = await act(id, 'commit');
  assert.equal(c.status, 404);
});

test('above threshold is pending approval, not auto-denied', async () => {
  await resetToTestSeed();
  // threshold $40; lux $80 fits in $90 -> pending approval holding funds
  const r = await place({ requestId: ridOf('thr'), agentId: 'agt-a', itemId: 'lux', qty: 1 });
  assert.equal(r.json.result.status, 'awaiting_approval');
  assert.notEqual(r.json.result.status, 'denied');
  const ap = await act(r.json.result.requestId, 'approve');
  assert.equal(ap.json.result.status, 'reserved');
  const c = await act(r.json.result.requestId, 'commit');
  assert.equal(c.json.result.status, 'committed');
  const s = await state();
  assert.equal(s.totals.spentMinor, 8000);
  assert.equal(s.totals.availableMinor, 1000);
});

test('invariant holds across mixed concurrent storm', async () => {
  await resetToTestSeed();
  const ops = Array.from({ length: 30 }, (_, i) => {
    const items = ['widget', 'sprocket', 'lux', 'forbidden'];
    return place({
      requestId: `storm-${i}`,
      agentId: `agt-${'abc'[i % 3]}`,
      itemId: items[i % items.length],
      qty: (i % 3) + 1,
    });
  });
  await Promise.all(ops);
  const s = await state();
  assert.ok(
    s.totals.spentMinor + s.totals.reservedMinor <= s.totals.budgetMinor,
    'invariant violated',
  );
  assert.ok(s.invariant.holds);
  assert.ok(s.totals.availableMinor >= 0);
});
