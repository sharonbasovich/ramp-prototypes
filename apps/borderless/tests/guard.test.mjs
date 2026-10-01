// tests/guard.test.mjs — FX Guard approval/staleness/commit oracle
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGuardState,
  computePlan,
  editInputs,
  simulateFxMove,
  expireQuote,
  refreshQuote,
  approve,
  commit,
  resetGuard,
  guardTick,
  QUOTE_VALID_MS,
  DEMO_CLOCK_START,
} from '../src/engine/guard.mjs';

const T0 = Date.parse('2026-10-01T14:00:00.000Z');
const fresh = () => createGuardState({ clock: T0 });
const minor = (m) => m && m.minor.toString();

// ---- fixture arithmetic ----------------------------------------------------

test('fixture: EUR 900 @1.08 + USD 8 fee -> projected debit USD 980, headroom 20', () => {
  const s = fresh();
  const p = computePlan(s);
  assert.equal(minor(p.converted), '97200');
  assert.equal(minor(p.debit), '98000');
  assert.equal(minor(p.budget), '100000');
  assert.equal(p.headroomMinor.toString(), '2000');
  assert.equal(p.withinBudget, true);
  assert.equal(p.spentMinor.toString(), '0'); // bar label is projected debit, not spent
});

test('quote issued with 2-minute demo validity window', () => {
  const s = fresh();
  assert.equal(s.quote.issuedAt, T0);
  assert.equal(s.quote.expiresAt, T0 + QUOTE_VALID_MS);
  assert.equal(s.quote.validityKind, 'demo');
});

// ---- approve / staleness ----------------------------------------------------

test('approve records complete bound snapshot', () => {
  const s = fresh();
  const r = approve(s);
  assert.equal(r.ok, true);
  assert.equal(r.approval.snapshot.invoice.minor, '90000');
  assert.equal(r.approval.snapshot.invoice.currency, 'EUR');
  assert.equal(r.approval.snapshot.rateDecimal, '1.08');
  assert.equal(r.approval.snapshot.debit.minor, '98000');
  assert.equal(r.approval.snapshot.quoteId, s.quote.id);
  assert.equal(computePlan(s).approvalStatus, 'current');
});

test('rate edit to 1.12 -> USD 1016 debit, over budget by 16, approval stale, commit blocked', () => {
  const s = fresh();
  approve(s);
  editInputs(s, { rateText: '1.12' });
  const p = computePlan(s);
  assert.equal(minor(p.debit), '101600');
  assert.equal(p.headroomMinor.toString(), '-1600');
  assert.equal(p.withinBudget, false);
  assert.equal(p.approvalStatus, 'revoked');
  const c = commit(s, 'cmd-1');
  assert.equal(c.ok, false);
  assert.equal(s.ledger.length, 0);
});

test('edit rate back to 1.08 does NOT restore approval (sticky revocation)', () => {
  const s = fresh();
  approve(s);
  editInputs(s, { rateText: '1.12' });
  editInputs(s, { rateText: '1.08' });
  const p = computePlan(s);
  assert.equal(minor(p.debit), '98000'); // numbers restored…
  assert.equal(p.approvalStatus, 'revoked'); // …approval is not
  const c = commit(s, 'cmd-1');
  assert.equal(c.ok, false);
  assert.equal(s.ledger.length, 0);
});

test('every bound-input edit revokes: amount, fee, budget, currencies, direction', () => {
  for (const patch of [
    { invoiceMinor: 90100n },
    { feeMinor: 900n },
    { budgetMinor: 200000n },
    { invoiceCurrency: 'GBP' },   // rejected edit still revokes
    { feeCurrency: 'EUR' },
    { budgetCurrency: 'EUR' },
    { pair: { from: 'USD', to: 'EUR' } },
  ]) {
    const s = fresh();
    approve(s);
    editInputs(s, patch);
    assert.equal(computePlan(s).approvalStatus, 'revoked', Object.keys(patch).join(','));
    assert.equal(commit(s, 'c').ok, false);
  }
});

test('approval cannot override insufficient budget', () => {
  const s = fresh();
  editInputs(s, { rateText: '1.12' });
  const r = approve(s);
  assert.equal(r.ok, false);
  assert.match(r.reason, /budget/);
});

// ---- commit semantics --------------------------------------------------------

test('commit succeeds exactly once; replay and second command cannot duplicate', () => {
  const s = fresh();
  approve(s);
  const c1 = commit(s, 'cmd-1');
  assert.equal(c1.ok, true);
  assert.equal(c1.record.debit.minor, '98000');
  assert.equal(s.ledger.length, 1);

  // same command id replayed -> idempotent, no new record
  const c2 = commit(s, 'cmd-1');
  assert.equal(c2.ok, true);
  assert.equal(c2.replay, true);
  assert.equal(s.ledger.length, 1);

  // different command id -> blocked, ledger unchanged
  const c3 = commit(s, 'cmd-2');
  assert.equal(c3.ok, false);
  assert.match(c3.reason, /already exists/);
  assert.equal(s.ledger.length, 1);

  const p = computePlan(s);
  assert.equal(p.spentMinor.toString(), '98000');
  assert.equal((BigInt(p.budget.minor) - p.spentMinor).toString(), '2000');
});

test('commit without approval blocked; engine enforces even with no UI', () => {
  const s = fresh();
  const c = commit(s, 'cmd-x');
  assert.equal(c.ok, false);
  assert.match(c.reason, /no approval/);
});

// ---- expiry ------------------------------------------------------------------

test('expiry boundary: 14:01:59.999 valid, 14:02:00.000 expired, 14:02:00.001 expired', () => {
  for (const [at, valid] of [
    [T0 + QUOTE_VALID_MS - 1, true],
    [T0 + QUOTE_VALID_MS, false],
    [T0 + QUOTE_VALID_MS + 1, false],
  ]) {
    const s = fresh();
    approve(s);
    guardTick(s, at);
    const c = commit(s, `cmd-${at}`);
    assert.equal(c.ok, valid, `at ${new Date(at).toISOString()}`);
    assert.equal(s.ledger.length, valid ? 1 : 0);
  }
});

test('expired quote blocks approve and commit; refresh + reapprove restores flow', () => {
  const s = fresh();
  approve(s);
  expireQuote(s);
  assert.equal(computePlan(s).expired, true);
  assert.equal(approve(s).ok, false);
  assert.equal(commit(s, 'cmd-1').ok, false);
  assert.equal(s.ledger.length, 0);

  refreshQuote(s);
  assert.equal(computePlan(s).expired, false);
  // refresh alone did NOT resurrect the old approval
  assert.equal(computePlan(s).approvalStatus, 'revoked');
  assert.equal(commit(s, 'cmd-1').ok, false);
  assert.equal(approve(s).ok, true);
  const c = commit(s, 'cmd-1');
  assert.equal(c.ok, true);
  assert.equal(s.ledger.length, 1);
});

test('clock moved back after observed expiry cannot self-heal', () => {
  const s = fresh();
  approve(s);
  expireQuote(s); // clock now past validity, expiry observed
  guardTick(s, T0 + 1000); // rewind demo clock
  assert.equal(computePlan(s).expired, true); // still treated expired
  assert.equal(commit(s, 'cmd-1').ok, false);
  assert.equal(s.ledger.length, 0);
});

// ---- epoch isolation ---------------------------------------------------------

test('reset creates new epoch; old approval cannot commit in the new sandbox', () => {
  const s = fresh();
  approve(s);
  const oldApproval = s.approval;
  const s2 = resetGuard(s);
  assert.notEqual(s2.epoch, s.epoch);
  // transplant stale approval into new epoch — engine still refuses
  s2.approval = oldApproval;
  const c = commit(s2, 'cmd-1');
  assert.equal(c.ok, false);
  assert.match(c.reason, /epoch|revoked/);
  assert.equal(s2.ledger.length, 0);
});

// ---- FX move via simulate ----------------------------------------------------

test('simulateFxMove requotes at 1.12, invalidates approval, blocks over-budget commit', () => {
  const s = fresh();
  approve(s);
  simulateFxMove(s);
  const p = computePlan(s);
  assert.equal(minor(p.debit), '101600');
  assert.equal(p.withinBudget, false);
  assert.equal(p.approvalStatus, 'revoked');
  assert.equal(commit(s, 'cmd-1').ok, false);
});

// ---- late/async approval callback -------------------------------------------

test('editing between approve and commit leaves the old snapshot unusable', () => {
  const s = fresh();
  approve(s);
  const fp = s.approval.fingerprint;
  editInputs(s, { feeMinor: 900n });
  assert.notEqual(computePlan(s).fingerprint, fp);
  assert.equal(commit(s, 'cmd-1').ok, false);
});
