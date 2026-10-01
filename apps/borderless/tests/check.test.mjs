import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createCheckState,
  editCheck,
  validateCheck,
  checkResultStale,
  saveNormalizedInvoice,
  resetCheck,
  exportCheckAudit,
  CHECK_FIXTURES,
  fundingCurrencyOf,
} from '../src/engine/check.mjs';

function state(patch) {
  const s = createCheckState();
  if (patch) editCheck(s, patch);
  return s;
}

// ---------- seed + hold semantics ----------
test('seed fixture holds: $1,250.00 has symbol candidates but no explicit currency', () => {
  const r = validateCheck(state());
  assert.equal(r.parse.status, 'hold');
  assert.equal(r.parse.need, 'currency');
  assert.deepEqual([...r.parse.candidates].sort(), ['CAD', 'USD']);
});

test('resolved currency without format holds for numeric-format', () => {
  const r = validateCheck(state({ resolvedCurrency: 'CAD' }));
  assert.equal(r.parse.status, 'hold');
  assert.equal(r.parse.need, 'numeric-format');
});

// ---------- full validate pipeline ----------
test('CAD + en-US resolves $1,250.00 → CAD 125000 minor, CA-USD route blocked', () => {
  const r = validateCheck(state({ resolvedCurrency: 'CAD', numericFormat: 'en-US' }));
  assert.equal(r.parse.status, 'ok');
  assert.equal(r.parse.money.currency, 'CAD');
  assert.equal(r.parse.money.minor, 125000n);
  assert.equal(r.route.decision, 'blocked');
  assert.match(r.route.reason, /CAD funding/);
});

test('CA entity + CAD funding passes preflight with fixture-caveat label', () => {
  const r = validateCheck(state({ resolvedCurrency: 'CAD', numericFormat: 'en-US', fundingAccountId: 'ca-cad' }));
  assert.equal(r.route.decision, 'preflight-passed');
  assert.equal(r.route.label, 'funding-currency preflight passed');
});

test('non-Canada entity is not evaluated (no supported inference)', () => {
  const r = validateCheck(state({ resolvedCurrency: 'CAD', numericFormat: 'en-US', entityCountry: 'US', fundingAccountId: 'us-usd' }));
  assert.equal(r.route.decision, 'not-evaluated');
});

test('resolved USD on the ambiguous literal parses USD, but CA-USD funding still blocked', () => {
  const r = validateCheck(state({ resolvedCurrency: 'USD', numericFormat: 'en-US' }));
  assert.equal(r.parse.status, 'ok');
  assert.equal(r.parse.money.currency, 'USD');
  assert.equal(r.route.decision, 'blocked');
});

// ---------- fixture literals through the pipeline ----------
test('german-eur fixture parses with de-DE (ISO in literal establishes currency)', () => {
  const s = state({ literal: '1.234,56 EUR', resolvedCurrency: null, numericFormat: 'de-DE' });
  const r = validateCheck(s);
  assert.equal(r.parse.status, 'ok');
  assert.equal(r.parse.money.currency, 'EUR');
  assert.equal(r.parse.money.minor, 123456n);
});

test('jpy fixture: JPY 198,000 with en-US → 198000 exact minors (exponent 0)', () => {
  const r = validateCheck(state({ literal: 'JPY 198,000', numericFormat: 'en-US' }));
  assert.equal(r.parse.status, 'ok');
  assert.equal(r.parse.money.currency, 'JPY');
  assert.equal(r.parse.money.minor, 198000n);
});

test('kwd fixture: KWD 12.345 with en-US → 12345 minor (exponent 3, generic example)', () => {
  const r = validateCheck(state({ literal: 'KWD 12.345', numericFormat: 'en-US' }));
  assert.equal(r.parse.status, 'ok');
  assert.equal(r.parse.money.currency, 'KWD');
  assert.equal(r.parse.money.minor, 12345n);
});

test('malformed fixture rejects (bad grouping never guesses)', () => {
  const r = validateCheck(state({ literal: 'USD 1,23.456', numericFormat: 'en-US' }));
  assert.equal(r.parse.status, 'reject');
});

// ---------- staleness ----------
test('edit after validation makes the result stale', () => {
  const s = state({ resolvedCurrency: 'CAD', numericFormat: 'en-US', fundingAccountId: 'ca-cad' });
  validateCheck(s);
  assert.equal(checkResultStale(s), false);
  editCheck(s, { fundingAccountId: 'ca-usd' });
  assert.equal(checkResultStale(s), true);
});

// ---------- save gate ----------
test('save requires a current passing parse AND passing preflight', () => {
  // never validated
  assert.match(saveNormalizedInvoice(state(), 'r1').reason, /validate again/);

  // validated but route blocked
  const blocked = state({ resolvedCurrency: 'CAD', numericFormat: 'en-US' });
  validateCheck(blocked);
  assert.match(saveNormalizedInvoice(blocked, 'r1').reason, /route blocked/);

  // validated but route not evaluated
  const notEval = state({ resolvedCurrency: 'CAD', numericFormat: 'en-US', entityCountry: 'US', fundingAccountId: 'us-usd' });
  validateCheck(notEval);
  assert.match(saveNormalizedInvoice(notEval, 'r1').reason, /not evaluated/);

  // validated but parse rejected
  const bad = state({ literal: 'USD 1,23.456', resolvedCurrency: 'USD', numericFormat: 'en-US', fundingAccountId: 'ca-cad' });
  validateCheck(bad);
  assert.match(saveNormalizedInvoice(bad, 'r1').reason, /parse reject/);

  // stale result
  const stale = state({ resolvedCurrency: 'CAD', numericFormat: 'en-US', fundingAccountId: 'ca-cad' });
  validateCheck(stale);
  editCheck(stale, { literal: '$2,000.00' });
  assert.match(saveNormalizedInvoice(stale, 'r1').reason, /validate again/);
});

test('passing save records normalized invoice with provenance; replay is idempotent', () => {
  const s = state({ resolvedCurrency: 'CAD', numericFormat: 'en-US', fundingAccountId: 'ca-cad' });
  validateCheck(s);
  const r1 = saveNormalizedInvoice(s, 'inv-7');
  assert.equal(r1.ok, true);
  assert.equal(r1.record.currency, 'CAD');
  assert.equal(r1.record.minor, '125000');
  assert.equal(r1.record.literal, '$1,250.00');
  assert.equal(r1.record.currencySource, 'manual-resolution');
  assert.equal(r1.record.routeDecision, 'preflight-passed');
  assert.match(r1.record.note, /sandbox record/);
  const r2 = saveNormalizedInvoice(s, 'inv-7');
  assert.equal(r2.ok, true);
  assert.equal(r2.replay, true);
  assert.equal(s.saved.length, 1);
});

// ---------- reset + audit ----------
test('reset creates a new epoch with fresh inputs and preserved clock shape', () => {
  const s = state({ resolvedCurrency: 'CAD' });
  validateCheck(s);
  const s2 = resetCheck(s);
  assert.equal(s2.epoch, s.epoch + 1);
  assert.equal(s2.resolvedCurrency, null);
  assert.equal(s2.saved.length, 0);
  assert.ok(s2.events.some((e) => e.kind === 'reset'));
});

test('exportCheckAudit carries disclaimers, inputs, result, saved and decisions', () => {
  const s = state({ resolvedCurrency: 'CAD', numericFormat: 'en-US', fundingAccountId: 'ca-cad' });
  validateCheck(s);
  saveNormalizedInvoice(s, 'inv-1');
  const audit = exportCheckAudit(s);
  assert.equal(audit.scenario, 'currency-check');
  assert.ok(audit.disclaimers.length >= 3);
  assert.equal(audit.result.parse.money.minor, '125000');
  assert.equal(audit.result.stale, false);
  assert.equal(audit.saved.length, 1);
  assert.ok(audit.decisions.some((d) => d.kind === 'save'));
  assert.equal(audit.inputs.fundingCurrency, 'CAD');
});

test('fundingCurrencyOf resolves account labels; unknown account → null', () => {
  assert.equal(fundingCurrencyOf(state({ fundingAccountId: 'ca-cad' })), 'CAD');
  assert.equal(fundingCurrencyOf(state({ fundingAccountId: 'nope' })), null);
});

test('all five declared fixtures are wired', () => {
  assert.equal(CHECK_FIXTURES.length, 5);
  assert.deepEqual(
    CHECK_FIXTURES.map((f) => f.id).sort(),
    ['ambiguous-usd', 'german-eur', 'jpy-zero-dec', 'kwd-three-dec', 'malformed'].sort(),
  );
});
