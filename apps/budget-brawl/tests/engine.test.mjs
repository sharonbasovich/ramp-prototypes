// tests/engine.test.mjs — unit coverage for the shared engine running on the
// in-memory store (the same code path the single-tab browser sandbox uses).
// The acceptance suite covers the SQLite/HTTP path independently.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemStore } from '../shared/memstore.mjs';
import * as engine from '../shared/engine.mjs';

const SEED = {
  wallet: { budgetMinor: 10000, approvalThresholdMinor: 5000, quoteTtlMs: 60000 },
  catalog: [
    { itemId: 'item-x', name: 'Item X', priceMinor: 6000, category: 'T' },
    { itemId: 'item-y', name: 'Item Y', priceMinor: 3000, category: 'T' },
    { itemId: 'locked', name: 'Locked', priceMinor: 100, category: 'T' },
  ],
  agents: [
    { agentId: 'one', name: 'One', lane: 'l', items: ['item-x', 'item-y'] },
    { agentId: 'two', name: 'Two', lane: 'l', items: ['item-y'] },
  ],
};

function fresh() {
  const s = createMemStore(SEED);
  return s;
}

test('engine: reserve/commit/cancel lifecycle keeps invariant', () => {
  const s = fresh();
  const now = Date.now();
  const r = engine.placeRequest(s, { requestId: 'u1', agentId: 'one', itemId: 'item-x', qty: 1 }, now);
  assert.equal(r.result.status, 'awaiting_approval'); // 60 > 50 threshold, held
  assert.equal(r.result.fundsHeld, true);
  const r2 = engine.placeRequest(s, { requestId: 'u2', agentId: 'one', itemId: 'item-x', qty: 1 }, now);
  assert.equal(r2.result.status, 'awaiting_approval');
  assert.equal(r2.result.fundsHeld, false); // only $40 left
  const ap = engine.approveRequest(s, 'u1', now);
  assert.equal(ap.result.status, 'reserved');
  const c = engine.commitRequest(s, 'u1', now);
  assert.equal(c.result.status, 'committed');
  const snap = engine.snapshot(s);
  assert.equal(snap.totals.spentMinor, 6000);
  assert.equal(snap.totals.availableMinor, 4000);
  assert.ok(snap.invariant.holds);
});

test('engine: cancel twice returns funds once; second agent can then reserve', () => {
  const s = fresh();
  const now = Date.now();
  engine.placeRequest(s, { requestId: 'k1', agentId: 'one', itemId: 'item-x', qty: 1 }, now);
  const c1 = engine.cancelRequest(s, 'k1', now);
  assert.equal(c1.result.status, 'cancelled');
  const c2 = engine.cancelRequest(s, 'k1', now);
  assert.equal(c2.result.status, 'cancelled');
  assert.equal(c2.result.replayed, true);
  assert.equal(engine.totals(s).availableMinor, 10000);
  const r = engine.placeRequest(s, { requestId: 'k2', agentId: 'one', itemId: 'item-x', qty: 1 }, now);
  assert.equal(r.result.fundsHeld, true);
});

test('engine: permission denial is distinct from threshold', () => {
  const s = fresh();
  const r = engine.placeRequest(s, { requestId: 'p1', agentId: 'two', itemId: 'item-x', qty: 1 }, Date.now());
  assert.equal(r.result.status, 'denied');
  assert.equal(r.result.reason, 'not_permitted');
  assert.match(r.result.detail, /permission/i);
  assert.match(r.result.detail, /not for amount/i);
});

test('engine: replay returns stored result, no new row or charge', () => {
  const s = fresh();
  const now = Date.now();
  engine.placeRequest(s, { requestId: 'd1', agentId: 'one', itemId: 'item-y', qty: 1 }, now);
  engine.commitRequest(s, 'd1', now);
  const again = engine.placeRequest(s, { requestId: 'd1', agentId: 'one', itemId: 'item-y', qty: 1 }, now);
  assert.equal(again.result.replayed, true);
  assert.equal(again.result.status, 'committed');
  const snap = engine.snapshot(s);
  assert.equal(snap.requests.length, 1);
  assert.equal(snap.totals.spentMinor, 3000);
});

test('engine: quote expiry releases holds on sweep', () => {
  const s = fresh();
  const t0 = Date.now();
  engine.placeRequest(s, { requestId: 'e1', agentId: 'one', itemId: 'item-y', qty: 1 }, t0);
  assert.equal(engine.totals(s).reservedMinor, 3000);
  engine.sweepExpired(s, t0 + 61000);
  assert.equal(engine.totals(s).reservedMinor, 0);
  const snap = engine.snapshot(s);
  assert.equal(snap.requests[0].status, 'expired');
});

test('engine: config rejects budget below commitments', () => {
  const s = fresh();
  const now = Date.now();
  engine.placeRequest(s, { requestId: 'g1', agentId: 'one', itemId: 'item-x', qty: 1 }, now);
  const r = engine.configure(s, { budgetMinor: 5000 });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'budget_below_commitments');
});

test('engine: impact counter reports prevented over-budget requests', () => {
  const s = fresh();
  const now = Date.now();
  engine.placeRequest(s, { requestId: 'i1', agentId: 'one', itemId: 'item-x', qty: 1 }, now);
  engine.placeRequest(s, { requestId: 'i2', agentId: 'one', itemId: 'item-x', qty: 1 }, now);
  const snap = engine.snapshot(s);
  assert.equal(snap.impact.preventedCount, 1);
  assert.equal(snap.impact.preventedAmountMinor, 6000);
});
