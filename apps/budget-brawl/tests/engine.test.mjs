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
  const r = engine.placeRequest(s, { epoch: s.epoch(), requestId: 'u1', agentId: 'one', itemId: 'item-x', qty: 1 }, now);
  assert.equal(r.result.status, 'awaiting_approval'); // 60 > 50 threshold, held
  assert.equal(r.result.fundsHeld, true);
  const r2 = engine.placeRequest(s, { epoch: s.epoch(), requestId: 'u2', agentId: 'one', itemId: 'item-x', qty: 1 }, now);
  assert.equal(r2.result.status, 'awaiting_approval');
  assert.equal(r2.result.fundsHeld, false); // only $40 left
  const ap = engine.approveRequest(s, 'u1', now, s.epoch());
  assert.equal(ap.result.status, 'reserved');
  const c = engine.commitRequest(s, 'u1', now, s.epoch());
  assert.equal(c.result.status, 'committed');
  const snap = engine.snapshot(s);
  assert.equal(snap.totals.spentMinor, 6000);
  assert.equal(snap.totals.availableMinor, 4000);
  assert.ok(snap.invariant.holds);
});

test('engine: cancel twice returns funds once; second agent can then reserve', () => {
  const s = fresh();
  const now = Date.now();
  engine.placeRequest(s, { epoch: s.epoch(), requestId: 'k1', agentId: 'one', itemId: 'item-x', qty: 1 }, now);
  const c1 = engine.cancelRequest(s, 'k1', now, s.epoch());
  assert.equal(c1.result.status, 'cancelled');
  const c2 = engine.cancelRequest(s, 'k1', now, s.epoch());
  assert.equal(c2.result.status, 'cancelled');
  assert.equal(c2.result.replayed, true);
  assert.equal(engine.totals(s).availableMinor, 10000);
  const r = engine.placeRequest(s, { epoch: s.epoch(), requestId: 'k2', agentId: 'one', itemId: 'item-x', qty: 1 }, now);
  assert.equal(r.result.fundsHeld, true);
});

test('engine: permission denial is distinct from threshold', () => {
  const s = fresh();
  const r = engine.placeRequest(s, { epoch: s.epoch(), requestId: 'p1', agentId: 'two', itemId: 'item-x', qty: 1 }, Date.now());
  assert.equal(r.result.status, 'denied');
  assert.equal(r.result.reason, 'not_permitted');
  assert.match(r.result.detail, /permission/i);
  assert.match(r.result.detail, /not for amount/i);
});

test('engine: replay returns stored result, no new row or charge', () => {
  const s = fresh();
  const now = Date.now();
  engine.placeRequest(s, { epoch: s.epoch(), requestId: 'd1', agentId: 'one', itemId: 'item-y', qty: 1 }, now);
  engine.commitRequest(s, 'd1', now, s.epoch());
  const again = engine.placeRequest(s, { epoch: s.epoch(), requestId: 'd1', agentId: 'one', itemId: 'item-y', qty: 1 }, now);
  assert.equal(again.result.replayed, true);
  assert.equal(again.result.status, 'committed');
  const snap = engine.snapshot(s);
  assert.equal(snap.requests.length, 1);
  assert.equal(snap.totals.spentMinor, 3000);
});

test('engine: quote expiry releases holds on sweep', () => {
  const s = fresh();
  const t0 = Date.now();
  engine.placeRequest(s, { epoch: s.epoch(), requestId: 'e1', agentId: 'one', itemId: 'item-y', qty: 1 }, t0);
  assert.equal(engine.totals(s).reservedMinor, 3000);
  engine.sweepExpired(s, t0 + 61000);
  assert.equal(engine.totals(s).reservedMinor, 0);
  const snap = engine.snapshot(s);
  assert.equal(snap.requests[0].status, 'expired');
});

test('engine: config rejects budget below commitments', () => {
  const s = fresh();
  const now = Date.now();
  engine.placeRequest(s, { epoch: s.epoch(), requestId: 'g1', agentId: 'one', itemId: 'item-x', qty: 1 }, now);
  const r = engine.configure(s, { budgetMinor: 5000 });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'budget_below_commitments');
});

test('engine: pending requests are not claimed as prevented over-budget requests', () => {
  const s = fresh();
  const now = Date.now();
  engine.placeRequest(s, { epoch: s.epoch(), requestId: 'i1', agentId: 'one', itemId: 'item-x', qty: 1 }, now);
  engine.placeRequest(s, { epoch: s.epoch(), requestId: 'i2', agentId: 'one', itemId: 'item-x', qty: 1 }, now);
  const snap = engine.snapshot(s);
  assert.equal(snap.impact.preventedCount, 0);
  assert.equal(snap.impact.preventedAmountMinor, 0);
  assert.equal(snap.impact.pendingCount, 2);
  assert.equal(snap.impact.pendingAmountMinor, 12000);
});


test('engine: reserve ignores expired holds without requiring a state read', () => {
  const s = fresh();
  engine.configure(s, { approvalThresholdMinor: 10000, quoteTtlMs: 500 }, 1000);
  const old = engine.placeRequest(s, { epoch: s.epoch(), requestId: 'old', agentId: 'one', itemId: 'item-x', qty: 1 }, 1000);
  assert.equal(old.result.status, 'reserved');
  const next = engine.placeRequest(s, { epoch: s.epoch(), requestId: 'next', agentId: 'one', itemId: 'item-x', qty: 1 }, 1501);
  assert.equal(next.result.status, 'reserved');
  const snap = engine.snapshot(s);
  assert.equal(snap.requests.find(r => r.requestId === 'old').status, 'expired');
  assert.equal(snap.totals.reservedMinor, 6000);
  assert.equal(snap.totals.availableMinor, 4000);
});

test('engine: approval expires other reservations before deciding available funds', () => {
  const s = fresh();
  engine.configure(s, { approvalThresholdMinor: 10000, quoteTtlMs: 500 }, 1000);
  engine.placeRequest(s, { epoch: s.epoch(), requestId: 'hold', agentId: 'one', itemId: 'item-x', qty: 1 }, 1000);
  engine.configure(s, { approvalThresholdMinor: 5000 }, 1100);
  engine.placeRequest(s, { epoch: s.epoch(), requestId: 'pending', agentId: 'one', itemId: 'item-x', qty: 1 }, 1100);
  const approved = engine.approveRequest(s, 'pending', 1501, s.epoch());
  assert.equal(approved.result.status, 'reserved');
  assert.equal(engine.totals(s).reservedMinor, 6000);
});

test('engine: lowering budget releases expired holds first but preserves live commitments', () => {
  const s = fresh();
  engine.configure(s, { quoteTtlMs: 500 }, 1000);
  engine.placeRequest(s, { epoch: s.epoch(), requestId: 'old', agentId: 'one', itemId: 'item-x', qty: 1 }, 1000);
  assert.equal(engine.configure(s, { budgetMinor: 5000 }, 1200).code, 'budget_below_commitments');
  assert.equal(engine.configure(s, { budgetMinor: 5000 }, 1501).ok, true);
  assert.equal(engine.totals(s).availableMinor, 5000);
});

test('engine: monetary config rejects unsafe/out-of-range values without changing wallet', () => {
  const s = fresh();
  for (const field of ['budgetMinor', 'approvalThresholdMinor']) {
    for (const value of [1e30, Number.MAX_SAFE_INTEGER + 1, 100000001, -1, 0.5, NaN, Infinity]) {
      const result = engine.configure(s, { [field]: value }, 1000);
      assert.equal(result.ok, false, `${field}=${value}`);
      assert.equal(result.status, 400);
      assert.equal(engine.totals(s).budgetMinor, 10000);
    }
  }
  assert.equal(engine.configure(s, { budgetMinor: 100000000 }, 1000).ok, true);
  const r = engine.placeRequest(s, { epoch: s.epoch(), requestId: 'exact', agentId: 'one', itemId: 'item-y', qty: 1 }, 1000);
  assert.equal(r.result.totals.availableMinor, 99997000, 'cent subtraction must remain exact at the supported limit');
});

test('engine: stale commands cannot mutate a reused request ID after reset', () => {
  const s = fresh();
  const input = { epoch: s.epoch(), requestId: 'same-id', agentId: 'one', itemId: 'item-y', qty: 1 };
  engine.placeRequest(s, input, 1000);
  engine.reset(s, SEED);
  const current = engine.placeRequest(s, { ...input, epoch: s.epoch() }, 1000);
  assert.equal(current.result.status, 'reserved');
  for (const op of [engine.approveRequest, engine.rejectRequest, engine.commitRequest, engine.cancelRequest]) {
    assert.equal(op(s, 'same-id', 1000, input.epoch).code, 'stale_epoch');
    assert.equal(op(s, 'same-id', 1000).code, 'epoch_required');
  }
  assert.equal(engine.placeRequest(s, input, 1000).code, 'stale_epoch');
  const snap = engine.snapshot(s);
  assert.equal(snap.requests.length, 1);
  assert.equal(snap.requests[0].status, 'reserved');
  assert.equal(snap.totals.availableMinor, 7000);
  assert.equal(engine.commitRequest(s, 'same-id', 1000, s.epoch()).result.status, 'committed');
});

test('engine: only terminal insufficient-funds denials count as prevented', () => {
  const s = fresh();
  engine.configure(s, { approvalThresholdMinor: 10000 }, 1000);
  engine.placeRequest(s, { epoch: s.epoch(), requestId: 'win', agentId: 'one', itemId: 'item-x', qty: 1 }, 1000);
  engine.placeRequest(s, { epoch: s.epoch(), requestId: 'denied', agentId: 'one', itemId: 'item-x', qty: 1 }, 1000);
  engine.configure(s, { approvalThresholdMinor: 5000 }, 1000);
  engine.placeRequest(s, { epoch: s.epoch(), requestId: 'pending', agentId: 'one', itemId: 'item-x', qty: 1 }, 1000);
  engine.approveRequest(s, 'pending', 1000, s.epoch());
  const snap = engine.snapshot(s);
  assert.equal(snap.impact.preventedCount, 1);
  assert.equal(snap.impact.preventedAmountMinor, 6000);
  assert.equal(snap.impact.pendingCount, 1);
  assert.equal(snap.impact.pendingAmountMinor, 6000);
  assert.match(snap.impact.note, /not realized savings/);
});
