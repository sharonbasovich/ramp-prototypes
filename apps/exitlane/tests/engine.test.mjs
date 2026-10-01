// tests/engine.test.mjs — pure engine tests over the in-memory store.
// Independent of the UI and HTTP server: drives shared/engine.mjs against
// shared/memstore.mjs with adversarial fixtures via shared/seed.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemStore } from '../shared/memstore.mjs';
import * as engine from '../shared/engine.mjs';
import { buildSeed, DEFAULT_SEED } from '../shared/seed.mjs';

const CLOCK = '2025-04-25T14:00:00Z'; // Fri 10:00 AM Toronto
const ROOM_CUTOFF = '2025-04-25T16:00:00Z'; // Fri 12:00 PM Toronto (24h before check-in)

function freshStore(config) {
  const built = buildSeed(config);
  assert.equal(built.ok, true, built.error);
  const store = createMemStore(built.seed);
  return store;
}

// Request ids are epoch-scoped; fresh stores are always epoch 1.
const rid = (bookingId, epoch = 1) => `req-${bookingId}-e${epoch}`;

function booking(store, id) {
  return store.getBooking(id);
}
function request(store, id) {
  return store.getRequestByBooking(id);
}
function snap(store) {
  return engine.snapshot(store);
}

/* ---- E01: mostly-unpaid booking, fee between paid and committed ---- */
test('E01: C=300 P=100 U=200 F=150 -> refund 0, avoided 200, extra 50, net 150 (no $200 refund claim)', () => {
  const store = freshStore({
    bookings: [
      { bookingId: 'b1', service: 'X', providerId: 'p', committedMinor: 30000, paidMinor: 10000, unpaidMinor: 20000, policyId: 'pol' },
    ],
    policies: [
      { policyId: 'pol', version: 'v1', tiers: [{ tierId: 't', boundary: 'always', fee: { kind: 'fixed', amountMinor: 15000 } }] },
    ],
    providers: { p: { displayName: 'P', script: ['confirmed'] } },
  });
  const a = snap(store).bookings[0].assessment;
  assert.equal(a.status, 'assessed');
  assert.equal(a.refundMinor, 0);
  assert.equal(a.futureChargesAvoidedMinor, 20000);
  assert.equal(a.extraPaymentMinor, 5000);
  assert.equal(a.netBenefitMinor, 15000);
});

/* ---- E02: fully paid, small fee ---- */
test('E02: C=P=200, U=0, F=50 -> estimated refund 150; nothing is "received cash"', () => {
  const store = freshStore({
    bookings: [{ bookingId: 'b1', committedMinor: 20000, paidMinor: 20000, unpaidMinor: 0, providerId: 'p', policyId: 'pol' }],
    policies: [{ policyId: 'pol', tiers: [{ tierId: 't', boundary: 'always', fee: { kind: 'fixed', amountMinor: 5000 } }] }],
    providers: { p: { script: ['confirmed'] } },
  });
  const a = snap(store).bookings[0].assessment;
  assert.equal(a.refundMinor, 15000);
  assert.equal(a.extraPaymentMinor, 0);
  assert.equal(a.netBenefitMinor, 15000);
  const s = snap(store);
  assert.equal(s.totals.receivedRefundsMinor, 0);
  assert.equal(s.totals.confirmedRefundsDueMinor, 0, 'no provider confirmation yet');
});

/* ---- E03: exact cutoff boundary `now < cutoff` ---- */
test('E03: one second before cutoff uses free tier; exactly at cutoff does not', () => {
  const store = freshStore();
  const cutoffMs = Date.parse(ROOM_CUTOFF);
  const before = engine.assess(booking(store, 'bk-room'), store.getPolicy('pol-room'), cutoffMs - 1000);
  const at = engine.assess(booking(store, 'bk-room'), store.getPolicy('pol-room'), cutoffMs);
  assert.equal(before.tierId, 'free');
  assert.equal(before.feeMinor, 0);
  assert.equal(before.refundMinor, 40000);
  assert.equal(at.tierId, 'inside-24h');
  assert.equal(at.feeMinor, 40000);
  assert.equal(at.refundMinor, 0);
});

/* ---- E04: same instant, two Toronto displays (EST vs EDT) ---- */
test('E04: a cutoff straddling the spring-forward evaluates on the instant, not the wall label', () => {
  // Mar 9, 2025 2:00 AM EST -> EDT. 06:30Z is 1:30 AM EST; 07:30Z is 3:30 AM EDT.
  const policy = {
    policyId: 'pol-dst',
    version: 'v1',
    supported: true,
    summary: 'test',
    sourceRef: 'test',
    tiers: [
      { tierId: 'early', boundary: 'before', cutoffInstant: '2025-03-09T07:00:00Z', fee: { kind: 'fixed', amountMinor: 0 } },
      { tierId: 'late', boundary: 'at_or_after', cutoffInstant: '2025-03-09T07:00:00Z', fee: { kind: 'percent', percent: 100 } },
    ],
  };
  const b = { bookingId: 'x', committedMinor: 1000, paidMinor: 1000, unpaidMinor: 0, currency: 'USD' };
  const estSide = engine.assess(b, policy, Date.parse('2025-03-09T06:59:00Z')); // 1:59 AM EST
  const edtSide = engine.assess(b, policy, Date.parse('2025-03-09T07:00:00Z')); // 3:00 AM EDT — same minute later
  assert.equal(estSide.tierId, 'early');
  assert.equal(edtSide.tierId, 'late');
  // The same instant evaluated twice is identical — no double tier.
  const again = engine.assess(b, policy, Date.parse('2025-03-09T06:59:00Z'));
  assert.deepEqual(again, estSide);
});

/* ---- Fixture sanity: required refundable total ---- */
test('fixture: estimated refundable total is exactly 55000 cents at the default clock', () => {
  const store = freshStore();
  const s = snap(store);
  assert.equal(s.totals.estimatedRefundableMinor, 55000);
  assert.equal(s.totals.estimatedFutureChargesAvoidedMinor, 14000);
  assert.equal(s.totals.estimatedExtraChargesMinor, 2000);
});

/* ---- E05: clock across cutoff invalidates approval before any provider call ---- */
test('E05: approve at refundable instant, advance clock past cutoff, execution refused as stale', () => {
  const store = freshStore();
  engine.cancelEvent(store);
  engine.preparePacket(store);
  engine.approvePacket(store);
  assert.equal(request(store, 'bk-room').status, 'approved');
  const clockOp = engine.setClock(store, '2025-04-25T16:30:00Z'); // past room cutoff
  assert.equal(clockOp.ok, true);
  assert.deepEqual(clockOp.result.staleBookings, ['bk-room']);
  assert.equal(request(store, 'bk-room').status, 'stale');
  const ex = engine.executePacket(store);
  assert.equal(ex.ok, true);
  const roomOutcomes = store.listOutcomes().filter((o) => o.bookingId === 'bk-room');
  assert.equal(roomOutcomes.length, 0, 'no provider call may happen for a stale approval');
  // Updated assessment is visible
  const a = snap(store).bookings.find((b) => b.bookingId === 'bk-room').assessment;
  assert.equal(a.refundMinor, 0);
  assert.equal(a.tierId, 'inside-24h');
  // Re-prepare + re-approve + execute now works on the new figures
  engine.preparePacket(store);
  engine.approvePacket(store);
  engine.executePacket(store);
  assert.equal(request(store, 'bk-room').status, 'executed');
  assert.equal(store.getBooking('bk-room').status, 'cancel_confirmed');
});

/* ---- E06: provider failure keeps booking active and out of confirmed totals ---- */
test('E06: scripted provider failure leaves booking pending; confirmed totals unchanged', () => {
  const store = freshStore();
  engine.cancelEvent(store);
  engine.preparePacket(store);
  engine.approvePacket(store);
  const before = snap(store).totals;
  const r = engine.executeRequest(store, rid('bk-equipment'));
  assert.equal(r.ok, true);
  assert.equal(r.result.outcome.outcome, 'failed');
  assert.equal(request(store, 'bk-equipment').status, 'failed');
  assert.equal(booking(store, 'bk-equipment').status, 'active', 'failed cancellation does not cancel the booking');
  const after = snap(store).totals;
  assert.equal(after.confirmedRefundsDueMinor, before.confirmedRefundsDueMinor);
  assert.equal(after.receivedRefundsMinor, 0);
});

/* ---- E07: idempotent repeat + retry keeps attempt history ---- */
test('E07: re-executing a confirmed request replays; retrying a failure appends attempt history', () => {
  const store = freshStore();
  engine.cancelEvent(store);
  engine.preparePacket(store);
  engine.approvePacket(store);
  engine.executeRequest(store, rid('bk-room'));
  const again = engine.executeRequest(store, rid('bk-room'));
  assert.equal(again.result.replayed, true);
  assert.equal(store.listOutcomesForRequest(rid('bk-room')).length, 1, 'same idempotency key never double-executes');
  // fail then retry
  engine.executeRequest(store, rid('bk-equipment'));
  assert.equal(request(store, 'bk-equipment').status, 'failed');
  const retry = engine.executeRequest(store, rid('bk-equipment'));
  assert.equal(retry.result.outcome.outcome, 'confirmed');
  const outs = store.listOutcomesForRequest(rid('bk-equipment'));
  assert.equal(outs.length, 2);
  assert.equal(outs[0].outcome, 'failed');
  assert.equal(outs[1].outcome, 'confirmed');
  assert.equal(request(store, 'bk-equipment').status, 'executed');
});

/* ---- E08: unsupported policy -> manual review, no figures, not executable ---- */
test('E08: unsupported / absent / contradictory policies require manual review', () => {
  const store = freshStore();
  engine.cancelEvent(store);
  engine.preparePacket(store);
  const decor = request(store, 'bk-decor');
  assert.equal(decor.status, 'excluded');
  assert.equal(decor.reason, 'manual_review');
  const a = snap(store).bookings.find((b) => b.bookingId === 'bk-decor').assessment;
  assert.equal(a.status, 'manual_review');
  assert.equal(a.refundMinor, undefined);
  // no policy at all
  const noPol = freshStore({
    bookings: [{ bookingId: 'b1', committedMinor: 1000, paidMinor: 1000, unpaidMinor: 0, providerId: 'p', policyId: '' }],
    policies: [],
    providers: { p: { script: ['confirmed'] } },
  });
  const a2 = snap(noPol).bookings[0].assessment;
  assert.equal(a2.status, 'manual_review');
  // contradictory tiers (two matching)
  const contra = freshStore({
    bookings: [{ bookingId: 'b1', committedMinor: 1000, paidMinor: 1000, unpaidMinor: 0, providerId: 'p', policyId: 'pol' }],
    policies: [
      {
        policyId: 'pol',
        tiers: [
          { tierId: 'a', boundary: 'always', fee: { kind: 'fixed', amountMinor: 0 } },
          { tierId: 'b', boundary: 'always', fee: { kind: 'fixed', amountMinor: 500 } },
        ],
      },
    ],
    providers: { p: { script: ['confirmed'] } },
  });
  const a3 = snap(contra).bookings[0].assessment;
  assert.equal(a3.status, 'manual_review');
  assert.match(a3.reason, /contradictory/);
});

/* ---- E09: negative net benefit is preserved ---- */
test('E09: C=100 P=20 U=80 F=130 -> extra payment 110, net benefit -30 shown, not clamped', () => {
  const store = freshStore({
    bookings: [{ bookingId: 'b1', committedMinor: 10000, paidMinor: 2000, unpaidMinor: 8000, providerId: 'p', policyId: 'pol' }],
    policies: [{ policyId: 'pol', tiers: [{ tierId: 't', boundary: 'always', fee: { kind: 'fixed', amountMinor: 13000 } }] }],
    providers: { p: { script: ['confirmed'] } },
  });
  const a = snap(store).bookings[0].assessment;
  assert.equal(a.refundMinor, 0);
  assert.equal(a.extraPaymentMinor, 11000);
  assert.equal(a.netBenefitMinor, -3000);
});

/* ---- E10: invalid financials are rejected with a specific explanation ---- */
test('E10: C != P+U, negative paid, or non-USD produce invalid assessments, no figures', () => {
  const store = freshStore({
    bookings: [
      { bookingId: 'bad-sum', committedMinor: 10000, paidMinor: 1000, unpaidMinor: 8000, providerId: 'p', policyId: 'pol' },
      { bookingId: 'bad-cur', committedMinor: 5000, paidMinor: 5000, unpaidMinor: 0, currency: 'CAD', providerId: 'p', policyId: 'pol' },
    ],
    policies: [{ policyId: 'pol', tiers: [{ tierId: 't', boundary: 'always', fee: { kind: 'fixed', amountMinor: 1000 } }] }],
    providers: { p: { script: ['confirmed'] } },
  });
  const rows = snap(store).bookings;
  const badSum = rows.find((b) => b.bookingId === 'bad-sum').assessment;
  assert.equal(badSum.status, 'invalid');
  assert.match(badSum.reason, /committed 10000 != paid 1000 \+ unpaid 8000/);
  const badCur = rows.find((b) => b.bookingId === 'bad-cur').assessment;
  assert.equal(badCur.status, 'invalid');
  assert.match(badCur.reason, /unsupported currency/);
});

/* ---- E11: pre-canceled booking excluded, outcome preserved ---- */
test('E11: a booking canceled before the packet is excluded; re-prepare never duplicates it', () => {
  const store = freshStore({
    bookings: [
      { bookingId: 'gone', status: 'canceled', committedMinor: 5000, paidMinor: 5000, unpaidMinor: 0, providerId: 'p', policyId: 'pol' },
      { bookingId: 'live', committedMinor: 5000, paidMinor: 5000, unpaidMinor: 0, providerId: 'p', policyId: 'pol' },
    ],
    policies: [{ policyId: 'pol', tiers: [{ tierId: 't', boundary: 'always', fee: { kind: 'fixed', amountMinor: 0 } }] }],
    providers: { p: { script: ['confirmed'] } },
  });
  engine.cancelEvent(store);
  engine.preparePacket(store);
  const r = request(store, 'gone');
  assert.equal(r.status, 'excluded');
  assert.equal(r.reason, 'already_canceled');
  engine.approvePacket(store);
  engine.executePacket(store);
  assert.equal(store.listOutcomes().filter((o) => o.bookingId === 'gone').length, 0);
  assert.equal(request(store, 'live').status, 'executed');
});

/* ---- E12: booking change after approval invalidates it ---- */
test('E12: editing amounts after approval makes the request stale; execution refused', () => {
  const store = freshStore();
  engine.cancelEvent(store);
  engine.preparePacket(store);
  engine.approvePacket(store);
  const edit = engine.editBookingAmounts(store, 'bk-room', { paidMinor: 35000, unpaidMinor: 5000 });
  assert.equal(edit.ok, true);
  assert.equal(request(store, 'bk-room').status, 'stale');
  assert.equal(store.getBooking('bk-room').version, 2);
  const ex = engine.executeRequest(store, rid('bk-room'));
  assert.equal(ex.ok, false);
  assert.equal(ex.code, 'stale');
  assert.equal(store.listOutcomesForRequest(rid('bk-room')).length, 0);
});

/* ---- E13: export distinguishes every state ---- */
test('E13: export distinguishes confirmed / failed / excluded / not-approved, with versions + timestamps + mode', () => {
  const store = freshStore();
  engine.cancelEvent(store);
  engine.preparePacket(store);
  engine.approvePacket(store);
  engine.executeRequest(store, rid('bk-room')); // confirmed
  engine.executeRequest(store, rid('bk-equipment')); // fails (scripted)
  // bk-catering + bk-shuttle stay approved-but-unexecuted; bk-decor excluded.
  const packet = engine.exportPacket(store, 'SQLite backend sandbox');
  assert.equal(packet.mode, 'SQLite backend sandbox');
  const states = Object.fromEntries(packet.entries.map((e) => [e.bookingId, e.state]));
  assert.equal(states['bk-room'], 'confirmed_simulated');
  assert.equal(states['bk-equipment'], 'failed');
  assert.equal(states['bk-catering'], 'approved');
  assert.equal(states['bk-decor'], 'excluded_manual_review');
  const room = packet.entries.find((e) => e.bookingId === 'bk-room');
  assert.equal(room.providerOutcomes[0].simulated, true);
  assert.equal(room.policy.version, 'v3');
  assert.equal(room.bookingVersion, 1);
  assert.ok(packet.generatedAtInstant);
  assert.match(packet.sandboxNotice, /SIMULATED/);
});

/* ---- E14: confirmed cancellation is not received cash ---- */
test('E14: after simulated confirmation, refund due is tracked but received stays 0 until marked', () => {
  const store = freshStore();
  engine.cancelEvent(store);
  engine.preparePacket(store);
  engine.approvePacket(store);
  engine.executeRequest(store, rid('bk-room'));
  let s = snap(store);
  assert.equal(s.totals.confirmedRefundsDueMinor, 40000);
  assert.equal(s.totals.receivedRefundsMinor, 0);
  engine.markRefundReceived(store, rid('bk-room'));
  s = snap(store);
  assert.equal(s.totals.receivedRefundsMinor, 40000);
  const replay = engine.markRefundReceived(store, rid('bk-room'));
  assert.equal(replay.result.replayed, true);
  assert.equal(snap(store).totals.receivedRefundsMinor, 40000, 'receipt counted exactly once');
});

/* ---- executePacket reports skipped requests with reasons ---- */
test('packet execute response includes skipped entries: stale refused vs excluded manual_review', () => {
  const store = freshStore();
  engine.cancelEvent(store);
  engine.preparePacket(store);
  engine.approvePacket(store);
  engine.setClock(store, '2025-04-25T16:30:00Z'); // room approval goes stale
  const res = engine.executePacket(store);
  assert.equal(res.ok, true);
  const byBooking = Object.fromEntries(res.result.results.map((r) => [r.bookingId, r]));
  assert.equal(byBooking['bk-room'].skipped, true);
  assert.equal(byBooking['bk-room'].status, 'stale');
  assert.match(byBooking['bk-room'].reason, /stale/);
  assert.match(byBooking['bk-room'].reason, /clock_moved/);
  assert.equal(byBooking['bk-decor'].skipped, true);
  assert.match(byBooking['bk-decor'].reason, /excluded: manual_review/);
  assert.equal(byBooking['bk-catering'].ok, true);
  assert.equal(byBooking['bk-catering'].status, 'executed');
  assert.equal(byBooking['bk-catering'].skipped, undefined);
});

/* ---- P1: failed requests re-verify the approval before any provider call ---- */
test('failed retry revalidates the approval fingerprint; stale requires fresh review, history kept', () => {
  const store = freshStore({
    bookings: [{ bookingId: 'flaky', service: 'AV', providerId: 'tp-flaky', committedMinor: 20000, paidMinor: 20000, unpaidMinor: 0, policyId: 'tp-tiered' }],
    policies: [
      {
        policyId: 'tp-tiered', version: 'v1', supported: true, summary: 'free before cutoff', sourceRef: 't',
        tiers: [
          { tierId: 'free', boundary: 'before', cutoffInstant: '2025-04-25T16:00:00Z', fee: { kind: 'fixed', amountMinor: 0 } },
          { tierId: 'late', boundary: 'at_or_after', cutoffInstant: '2025-04-25T16:00:00Z', fee: { kind: 'percent', percent: 100 } },
        ],
      },
    ],
    providers: { 'tp-flaky': { displayName: 'Flaky', script: ['fail:503:boom', 'confirmed'] } },
  });
  engine.cancelEvent(store);
  engine.preparePacket(store);
  engine.approvePacket(store);
  const first = engine.executeRequest(store, rid('flaky'));
  assert.equal(first.result.outcome.outcome, 'failed');
  engine.setClock(store, '2025-04-25T16:30:00Z'); // crosses the fee cutoff
  const retry = engine.executeRequest(store, rid('flaky'));
  assert.equal(retry.result.stale, true, 'retry must refuse the stale approval before any provider call');
  assert.equal(request(store, 'flaky').status, 'stale');
  assert.equal(store.listOutcomesForRequest(rid('flaky')).length, 1, 'attempt history preserved — no new provider call');
  // Fresh review restores executability on the new figures.
  engine.preparePacket(store);
  engine.approvePacket(store);
  const again = engine.executeRequest(store, rid('flaky'));
  assert.equal(again.result.outcome.outcome, 'confirmed');
  assert.equal(store.listOutcomesForRequest(rid('flaky')).length, 2);
});

/* ---- P1: an invalid assessment can never be approved or executed ---- */
test('approvePacket refuses a booking whose assessment is invalid since prepare; no fake confirmation', () => {
  const store = freshStore();
  engine.cancelEvent(store);
  engine.preparePacket(store);
  // Corrupt the room booking's arithmetic AFTER the packet was prepared:
  // committed 40000 != paid 35000 + unpaid 6000 -> 'invalid' assessment.
  const edit = engine.editBookingAmounts(store, 'bk-room', { paidMinor: 35000, unpaidMinor: 6000 });
  assert.equal(edit.ok, true);
  const ap = engine.approvePacket(store);
  assert.equal(ap.ok, true);
  assert.ok(ap.result.rejected.some((r) => r.bookingId === 'bk-room' && r.reason === 'invalid'));
  assert.equal(request(store, 'bk-room').status, 'excluded');
  assert.equal(request(store, 'bk-room').reason, 'invalid');
  const ex = engine.executeRequest(store, rid('bk-room'));
  assert.equal(ex.ok, false);
  assert.equal(store.listOutcomesForRequest(rid('bk-room')).length, 0, 'no provider call, no confirmation');
  assert.equal(booking(store, 'bk-room').status, 'active');
  // Other valid approvals are unaffected.
  assert.equal(request(store, 'bk-catering').status, 'approved');
});

/* ---- money lifecycle: potential -> approved -> due -> received ---- */
test('money lifecycle keeps remaining potential, packet estimate, due, and received distinct', () => {
  const store = freshStore();
  engine.cancelEvent(store);
  engine.preparePacket(store);
  engine.approvePacket(store);
  engine.executePacket(store);
  const t = snap(store).totals;
  assert.equal(t.estimatedRefundableMinor, 0, 'no assessed bookings remain active');
  assert.equal(t.packetRefundableMinor, 55000, 'the approved packet estimate is preserved, labeled');
  assert.equal(t.confirmedRefundsDueMinor, 55000, 'all approved refunds outstanding');
  assert.equal(t.receivedRefundsMinor, 0);
  assert.equal(t.confirmedCancellations, 3);
  assert.equal(t.failedCancellations, 1, 'equipment scripted 503 counts as failed, not confirmed');
  engine.executeRequest(store, rid('bk-equipment')); // retry succeeds
  const t2 = snap(store).totals;
  assert.equal(t2.confirmedCancellations, 4);
  assert.equal(t2.confirmedRefundsDueMinor, 55000, 'retry does not double-count');
  engine.markRefundReceived(store, rid('bk-room'));
  const t3 = snap(store).totals;
  assert.equal(t3.receivedRefundsMinor, 40000);
  assert.equal(t3.confirmedRefundsDueMinor, 15000, 'received cash leaves the due bucket');
});

/* ---- reset determinism ---- */
test('reset restores identical fixture state (Q03)', () => {
  const store = freshStore();
  engine.cancelEvent(store);
  engine.preparePacket(store);
  engine.approvePacket(store);
  engine.executePacket(store);
  // Identity fields embed the epoch (req-<b>-e<N>, ...|pkt|e<N>) — normalize
  // them so the comparison tests state identity, not the epoch counter.
  const strip = (s) =>
    JSON.stringify(s, (k, v) =>
      k === 'epoch' ? 0 : typeof v === 'string' ? v.replace(/-e\d+$/, '-eN').replace(/\|e\d+$/, '|eN') : v,
    );
  const snapA = strip(snap(store));
  engine.reset(store, buildSeed().seed);
  assert.equal(strip(snap(store)), strip(snap(createMemStore(buildSeed().seed))));
  engine.cancelEvent(store);
  engine.preparePacket(store);
  engine.approvePacket(store);
  engine.executePacket(store);
  assert.equal(strip(snap(store)), snapA);
});

/* ---- request identity is epoch-scoped: pre-reset ids can never act ---- */
test('reset mints new request ids; a dead-epoch id cannot execute the new request', () => {
  const store = freshStore();
  engine.cancelEvent(store);
  engine.preparePacket(store);
  engine.approvePacket(store);
  const oldId = request(store, 'bk-room').requestId;
  assert.equal(oldId, rid('bk-room', 1));
  engine.reset(store, buildSeed().seed);
  assert.equal(store.epoch(), 2);
  engine.cancelEvent(store);
  engine.preparePacket(store);
  engine.approvePacket(store);
  const newId = request(store, 'bk-room').requestId;
  assert.equal(newId, rid('bk-room', 2));
  assert.ok(!store.getRequest(oldId), 'dead-epoch id does not resolve');
  // Even if a stale client crafts the call, there is nothing to execute.
  engine.executeRequest(store, oldId);
  assert.equal(request(store, 'bk-room').status, 'approved', 'old id never touched the new request');
});

/* ---- persisted browser state is schema-validated ---- */
test('memstore.restore rejects valid JSON with a broken schema instead of crashing', () => {
  const store = freshStore();
  assert.equal(store.restore(JSON.stringify({ bookings: null })), false);
  assert.equal(store.restore(JSON.stringify({ bookings: [] })), false, 'missing fields is still invalid');
  assert.equal(store.restore(JSON.stringify('plain string')), false);
  // Store still works — state untouched.
  const s = snap(store);
  assert.equal(s.bookings.length, 5);
  assert.equal(typeof s.epoch, 'number');
  // A well-formed payload restores.
  const serialized = store.serialize();
  store.resetAll(buildSeed().seed);
  assert.equal(store.restore(serialized), true);
});

/* ---- approvals can never execute unapproved / excluded requests ---- */
test('unapproved or excluded requests cannot execute', () => {
  const store = freshStore();
  engine.cancelEvent(store);
  engine.preparePacket(store);
  const r = engine.executeRequest(store, rid('bk-room'));
  assert.equal(r.ok, false);
  assert.equal(r.code, 'invalid_state');
  const r2 = engine.executeRequest(store, rid('bk-decor'));
  assert.equal(r2.ok, false);
  assert.equal(r2.code, 'invalid_state');
});

/* ---- clock rejections ---- */
test('invalid clock input rejected; valid clock moves assessments', () => {
  const store = freshStore();
  const bad = engine.setClock(store, 'not-a-date');
  assert.equal(bad.ok, false);
  assert.equal(bad.code, 'invalid_clock');
  const good = engine.setClock(store, '2025-04-26T18:00:00Z');
  assert.equal(good.ok, true);
  const s = snap(store);
  assert.equal(s.clock.instant, '2025-04-26T18:00:00.000Z');
  assert.equal(s.totals.estimatedRefundableMinor, 15000, 'room tier flipped to inside-24h');
});

/* ---- DEFAULT_SEED exercises buildSeed validation path ---- */
test('buildSeed rejects malformed configs without touching defaults', () => {
  assert.equal(buildSeed({ bookings: [] }).ok, false);
  assert.equal(buildSeed({ bookings: [{ bookingId: 'x' }] }).ok, false);
  assert.equal(buildSeed({ bookings: [{ bookingId: 'x', committedMinor: 100, paidMinor: 100, unpaidMinor: 0, policyId: 'ghost' }] }).ok, false);
  const okSeed = buildSeed();
  assert.equal(okSeed.ok, true);
  assert.equal(okSeed.seed.bookings.length, DEFAULT_SEED.bookings.length);
});
