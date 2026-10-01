// tests/route.test.mjs — funding-route policy oracle from ACCEPTANCE.md
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateFundingRoute, ROUTE_DISCLAIMER } from '../src/engine/route.mjs';

test('Canada + CAD funding -> funding-currency preflight passed (fixture-scoped)', () => {
  const r = evaluateFundingRoute({ entityCountry: 'CA', fundingCurrency: 'CAD' });
  assert.equal(r.decision, 'preflight-passed');
  assert.equal(r.label, 'funding-currency preflight passed');
  assert.match(ROUTE_DISCLAIMER, /not a complete eligibility verdict/);
  assert.ok(r.source.includes('support.ramp.com'));
});

test('Canada + USD funding -> blocked, documented reason', () => {
  const r = evaluateFundingRoute({ entityCountry: 'CA', fundingCurrency: 'USD' });
  assert.equal(r.decision, 'blocked');
  assert.match(r.reason, /requires CAD funding/);
});

test('Canada + KWD funding -> blocked unsupported sandbox route (KWD parses ≠ route)', () => {
  const r = evaluateFundingRoute({ entityCountry: 'CA', fundingCurrency: 'KWD' });
  assert.equal(r.decision, 'blocked');
  assert.match(r.reason, /not a supported route|unsupported/);
});

test('non-Canada entity -> not evaluated, no support inference', () => {
  for (const country of ['US', 'GB', 'DE']) {
    const r = evaluateFundingRoute({ entityCountry: country, fundingCurrency: 'USD' });
    assert.equal(r.decision, 'not-evaluated');
    assert.match(r.reason, /only the simplified documented Canada/);
  }
});

test('missing entity -> not evaluated', () => {
  const r = evaluateFundingRoute({ entityCountry: '', fundingCurrency: 'USD' });
  assert.equal(r.decision, 'not-evaluated');
});
