// tests/acceptance.test.mjs — independent acceptance suite.
// Drives the real server over HTTP (SQLite backend) and inspects only
// observable API outcomes + persisted state. Test fixtures are injected via
// POST /api/reset so nothing inherits the demo seed.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = fileURLToPath(new URL('..', import.meta.url));
const PORT = 5515; // distinct from the app's 5315 so tests never collide
const BASE = `http://127.0.0.1:${PORT}`;

// Test-owned fixtures, deliberately different from the demo seed.
const SEED = {
  clockInstant: '2025-04-25T14:00:00Z',
  bookings: [
    // refundable under `now < cutoff`
    { bookingId: 'tb-room', service: 'Room', providerId: 'tp-ok', committedMinor: 40000, paidMinor: 40000, unpaidMinor: 0, policyId: 'tp-tiered' },
    // unpaid balance -> avoided future charges + extra payment due
    { bookingId: 'tb-shuttle', service: 'Shuttle', providerId: 'tp-ok', committedMinor: 18000, paidMinor: 4000, unpaidMinor: 14000, policyId: 'tp-flat' },
    // provider fails once then confirms
    { bookingId: 'tb-av', service: 'AV', providerId: 'tp-flaky', committedMinor: 20000, paidMinor: 20000, unpaidMinor: 0, policyId: 'tp-free' },
    // unsupported policy -> manual review
    { bookingId: 'tb-decor', service: 'Decor', providerId: 'tp-ok', committedMinor: 9500, paidMinor: 9500, unpaidMinor: 0, policyId: 'tp-bad' },
    // invalid financials (C != P+U)
    { bookingId: 'tb-bad', service: 'Misc', providerId: 'tp-ok', committedMinor: 10000, paidMinor: 1000, unpaidMinor: 8000, policyId: 'tp-free' },
  ],
  policies: [
    {
      policyId: 'tp-tiered',
      version: 'v9',
      supported: true,
      summary: 'Free before cutoff; 100% after.',
      sourceRef: 'test policy',
      tiers: [
        { tierId: 'free', boundary: 'before', cutoffInstant: '2025-04-25T16:00:00Z', fee: { kind: 'fixed', amountMinor: 0 } },
        { tierId: 'late', boundary: 'at_or_after', cutoffInstant: '2025-04-25T16:00:00Z', fee: { kind: 'percent', percent: 100 } },
      ],
    },
    { policyId: 'tp-flat', version: 'v1', supported: true, summary: 'flat $60', sourceRef: 'test', tiers: [{ tierId: 't', boundary: 'always', fee: { kind: 'fixed', amountMinor: 6000 } }] },
    { policyId: 'tp-free', version: 'v1', supported: true, summary: 'free', sourceRef: 'test', tiers: [{ tierId: 't', boundary: 'always', fee: { kind: 'fixed', amountMinor: 0 } }] },
    { policyId: 'tp-bad', version: 'v1', supported: false, summary: 'subject to review', sourceRef: 'test', tiers: [] },
  ],
  providers: {
    'tp-ok': { displayName: 'Test OK', script: ['confirmed'] },
    'tp-flaky': { displayName: 'Test Flaky', script: ['fail:503:boom', 'confirmed'] },
  },
};

let child;
let tmpDir;

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

function rowFor(s, bookingId) {
  return s.bookings.find((b) => b.bookingId === bookingId);
}

before(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'exitlane-test-'));
  child = spawn(process.execPath, [join(APP, 'server', 'index.mjs')], {
    env: { ...process.env, PORT: String(PORT), EXITLANE_DB: join(tmpDir, 'test.sqlite') },
    stdio: 'pipe',
  });
  child.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));
  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('server did not start');
});

after(() => {
  child?.kill('SIGTERM');
  rmSync(tmpDir, { recursive: true, force: true });
});

async function resetSeed() {
  const { status, json } = await api('/api/reset', { config: SEED });
  assert.equal(status, 200);
  assert.equal(json.ok, true);
}

async function flowUntilApproved() {
  await api('/api/event/cancel', {});
  await api('/api/packet/prepare', {});
  await api('/api/packet/approve', {});
}

test('health reports sqlite engine honestly', async () => {
  const { json } = await api('/api/health');
  assert.equal(json.engine, 'sqlite');
});

test('fixture totals: refundable 55000-equivalent mix — refund 40000 + avoided 14000 + extra 2000 (E01/E02 math)', async () => {
  await resetSeed();
  const s = await state();
  const room = rowFor(s, 'tb-room').assessment;
  assert.equal(room.refundMinor, 40000);
  assert.equal(room.tierId, 'free');
  const shuttle = rowFor(s, 'tb-shuttle').assessment;
  assert.equal(shuttle.refundMinor, 0);
  assert.equal(shuttle.futureChargesAvoidedMinor, 14000);
  assert.equal(shuttle.extraPaymentMinor, 2000);
  assert.equal(shuttle.netBenefitMinor, 12000);
  const bad = rowFor(s, 'tb-bad').assessment;
  assert.equal(bad.status, 'invalid');
  const decor = rowFor(s, 'tb-decor').assessment;
  assert.equal(decor.status, 'manual_review');
});

test('exact cutoff: at 15:59:59Z free tier; at 16:00:00Z the late tier applies (E03)', async () => {
  await resetSeed();
  const before = await api('/api/clock', { instant: '2025-04-25T15:59:59Z' });
  assert.equal(before.json.ok, true);
  let s = await state();
  assert.equal(rowFor(s, 'tb-room').assessment.tierId, 'free');
  await api('/api/clock', { instant: '2025-04-25T16:00:00Z' });
  s = await state();
  const a = rowFor(s, 'tb-room').assessment;
  assert.equal(a.tierId, 'late');
  assert.equal(a.refundMinor, 0);
});

test('stale approval: clock across cutoff refuses execution before provider call (E05)', async () => {
  await resetSeed();
  await flowUntilApproved();
  const r = await api('/api/clock', { instant: '2025-04-25T16:30:00Z' });
  assert.deepEqual(r.json.result.staleBookings, ['tb-room']);
  const ex = await api('/api/packet/execute', {});
  assert.equal(ex.json.ok, true);
  const s = await state();
  assert.equal(rowFor(s, 'tb-room').request.status, 'stale');
  assert.equal(rowFor(s, 'tb-room').outcomes.length, 0, 'no sandbox call recorded');
  // re-prepare + re-approve + execute now lands on the new tier
  await api('/api/packet/prepare', {});
  await api('/api/packet/approve', {});
  await api('/api/packet/execute', {});
  const s2 = await state();
  assert.equal(rowFor(s2, 'tb-room').request.status, 'executed');
});

test('booking edit after approval invalidates it (E12)', async () => {
  await resetSeed();
  await flowUntilApproved();
  const edit = await api('/api/bookings/amounts', { bookingId: 'tb-room', committedMinor: 42000, paidMinor: 40000, unpaidMinor: 2000 });
  assert.equal(edit.json.ok, true);
  const s = await state();
  const b = rowFor(s, 'tb-room');
  assert.equal(b.version, 2);
  assert.equal(b.request.status, 'stale');
  const ex = await api('/api/requests/req-tb-room/execute', {});
  assert.equal(ex.status, 409);
  assert.equal(ex.json.error.code, 'stale');
});

test('provider failure then retry: history kept, totals honest (E06/E07)', async () => {
  await resetSeed();
  await flowUntilApproved();
  const f = await api('/api/requests/req-tb-av/execute', {});
  assert.equal(f.json.result.outcome.outcome, 'failed');
  let s = await state();
  assert.equal(rowFor(s, 'tb-av').status, 'active');
  assert.equal(s.totals.confirmedRefundsDueMinor, 0);
  const r = await api('/api/requests/req-tb-av/execute', {});
  assert.equal(r.json.result.outcome.outcome, 'confirmed');
  s = await state();
  const av = rowFor(s, 'tb-av');
  assert.equal(av.request.status, 'executed');
  assert.equal(av.outcomes.length, 2);
  assert.equal(s.totals.confirmedRefundsDueMinor, 20000);
  // idempotent replay
  const again = await api('/api/requests/req-tb-av/execute', {});
  assert.equal(again.json.result.replayed, true);
  s = await state();
  assert.equal(rowFor(s, 'tb-av').outcomes.length, 2);
});

test('negative benefit survives end-to-end: flat $60 fee on $180/$40-paid booking (E09-style)', async () => {
  await resetSeed();
  const { json } = await api('/api/reset', {
    config: {
      ...SEED,
      bookings: [{ bookingId: 'neg', committedMinor: 10000, paidMinor: 2000, unpaidMinor: 8000, providerId: 'tp-ok', policyId: 'tp-neg' }],
      policies: [{ policyId: 'tp-neg', supported: true, summary: '$130 fee', sourceRef: 't', tiers: [{ tierId: 't', boundary: 'always', fee: { kind: 'fixed', amountMinor: 13000 } }] }],
    },
  });
  assert.equal(json.ok, true);
  const s = await state();
  const a = rowFor(s, 'neg').assessment;
  assert.equal(a.refundMinor, 0);
  assert.equal(a.extraPaymentMinor, 11000);
  assert.equal(a.netBenefitMinor, -3000);
  assert.equal(s.totals.netEstimatedBenefitMinor, -3000);
});

test('unsupported + invalid bookings are excluded and never executable (E08/E10)', async () => {
  await resetSeed();
  await flowUntilApproved();
  const s = await state();
  assert.equal(rowFor(s, 'tb-decor').request.status, 'excluded');
  assert.equal(rowFor(s, 'tb-decor').request.reason, 'manual_review');
  assert.equal(rowFor(s, 'tb-bad').request.status, 'excluded');
  assert.equal(rowFor(s, 'tb-bad').request.reason, 'invalid');
  const ex = await api('/api/requests/req-tb-decor/execute', {});
  assert.equal(ex.status, 409);
});

test('export distinguishes confirmed/failed/excluded/approved and labels simulated + mode (E13)', async () => {
  await resetSeed();
  await flowUntilApproved();
  await api('/api/requests/req-tb-room/execute', {});
  await api('/api/requests/req-tb-av/execute', {}); // fails first attempt
  const { json } = await api('/api/packet/export');
  assert.equal(json.ok, true);
  const p = json.result;
  assert.equal(p.mode, 'SQLite backend sandbox');
  const states = Object.fromEntries(p.entries.map((e) => [e.bookingId, e.state]));
  assert.equal(states['tb-room'], 'confirmed_simulated');
  assert.equal(states['tb-av'], 'failed');
  assert.equal(states['tb-shuttle'], 'approved');
  assert.equal(states['tb-decor'], 'excluded_manual_review');
  assert.equal(states['tb-bad'], 'excluded_invalid');
  assert.match(p.sandboxNotice, /SIMULATED/);
  assert.ok(p.entries[0].request.approvedInstant);
});

test('confirmed cancellation != received cash; receipt marks once (E14)', async () => {
  await resetSeed();
  await flowUntilApproved();
  await api('/api/requests/req-tb-room/execute', {});
  let s = await state();
  assert.equal(s.totals.confirmedRefundsDueMinor, 40000);
  assert.equal(s.totals.receivedRefundsMinor, 0);
  const m = await api('/api/requests/req-tb-room/refund-received', {});
  assert.equal(m.json.ok, true);
  s = await state();
  assert.equal(s.totals.receivedRefundsMinor, 40000);
  const m2 = await api('/api/requests/req-tb-room/refund-received', {});
  assert.equal(m2.json.result.replayed, true);
  assert.equal((await state()).totals.receivedRefundsMinor, 40000);
});

test('double execution across concurrent HTTP calls records exactly one outcome (idempotency)', async () => {
  await resetSeed();
  await flowUntilApproved();
  const [a, b] = await Promise.all([
    api('/api/requests/req-tb-room/execute', {}),
    api('/api/requests/req-tb-room/execute', {}),
  ]);
  const outcomes = (await state()).bookings.find((x) => x.bookingId === 'tb-room').outcomes;
  assert.equal(outcomes.length, 1, `expected exactly one recorded outcome, got ${outcomes.length} (${a.status}/${b.status})`);
});

test('reset bumps epoch; dead-epoch request ids are unknown (404)', async () => {
  await resetSeed();
  await flowUntilApproved();
  const e1 = (await state()).epoch;
  await resetSeed();
  const s = await state();
  assert.equal(s.epoch, e1 + 1);
  const ex = await api('/api/requests/req-tb-room/execute', {});
  assert.equal(ex.status, 404);
});

test('unknown routes and malformed bodies fail cleanly', async () => {
  const res = await fetch(`${BASE}/api/nonexistent`, { method: 'POST', body: '{}' });
  assert.equal(res.status, 404);
  const bad = await fetch(`${BASE}/api/clock`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'not-json' });
  assert.equal(bad.status, 500); // body parse error -> internal; never a silent mutation
  const badClock = await api('/api/clock', { instant: 'garbage' });
  assert.equal(badClock.json.ok, false);
});
