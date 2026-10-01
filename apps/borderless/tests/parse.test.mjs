// tests/parse.test.mjs — Currency Check oracle vectors from ACCEPTANCE.md
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseInvoiceAmount } from '../src/engine/parse.mjs';

const ok = (literal, opts = {}) => {
  const r = parseInvoiceAmount({ literal, ...opts });
  assert.equal(r.status, 'ok', `${literal} -> ${r.status}: ${r.reason ?? ''}`);
  return r;
};

// ---- direct parse table ---------------------------------------------------

test('ISO USD literal, CAD native, en-US -> USD 123456', () => {
  const r = ok('1,234.56 USD', { resolvedCurrency: null, numericFormat: 'en-US' });
  assert.equal(r.money.currency, 'USD');
  assert.equal(r.money.minor, 123456n);
});

test('ISO EUR literal de-DE 1.234,56 -> EUR 123456', () => {
  const r = ok('1.234,56 EUR', { numericFormat: 'de-DE' });
  assert.equal(r.money.currency, 'EUR');
  assert.equal(r.money.minor, 123456n);
});

test('ISO EUR literal fr-FR with U+202F grouping -> EUR 123456', () => {
  const r = ok('1 234,56 EUR', { numericFormat: 'fr-FR' });
  assert.equal(r.money.minor, 123456n);
});

test('ISO EUR literal fr-FR with U+00A0 grouping -> EUR 123456 (documented alias)', () => {
  const r = ok('1 234,56 EUR', { numericFormat: 'fr-FR' });
  assert.equal(r.money.minor, 123456n);
});

test('bare integer USD 1234 -> USD 123400 minor', () => {
  const r = ok('USD 1234', { numericFormat: 'en-US' });
  assert.equal(r.money.minor, 123400n);
});

test('JPY 1,234 en-US -> JPY 1234 (exponent 0, no synthetic fraction)', () => {
  const r = ok('JPY 1,234', { numericFormat: 'en-US' });
  assert.equal(r.money.currency, 'JPY');
  assert.equal(r.money.minor, 1234n);
});

test('KWD 1.234 en-US -> KWD 1234 (exponent 3)', () => {
  const r = ok('KWD 1.234', { numericFormat: 'en-US' });
  assert.equal(r.money.minor, 1234n);
});

test('KWD 1,234 de-DE -> KWD 1234, not 1234000', () => {
  const r = ok('KWD 1,234', { numericFormat: 'de-DE' });
  assert.equal(r.money.minor, 1234n);
});

test('KWD 1,234 en-US -> KWD 1234000 (grouping interpretation)', () => {
  const r = ok('KWD 1,234', { numericFormat: 'en-US' });
  assert.equal(r.money.minor, 1234000n);
});

// ---- precision rejections --------------------------------------------------

test('USD 1.234 rejected — excess fractional precision, no rounding', () => {
  const r = parseInvoiceAmount({ literal: 'USD 1.234', numericFormat: 'en-US' });
  assert.equal(r.status, 'reject');
  assert.match(r.reason, /excess fractional precision/);
});

test('JPY 123.45 rejected — fractional JPY, no truncation', () => {
  const r = parseInvoiceAmount({ literal: 'JPY 123.45', numericFormat: 'en-US' });
  assert.equal(r.status, 'reject');
  assert.match(r.reason, /excess fractional precision/);
});

test('KWD 1.2345 rejected — excess KWD precision', () => {
  const r = parseInvoiceAmount({ literal: 'KWD 1.2345', numericFormat: 'en-US' });
  assert.equal(r.status, 'reject');
  assert.match(r.reason, /excess fractional precision/);
});

// ---- holds -----------------------------------------------------------------

test('$-only literal holds for currency resolution; CAD native is not proof', () => {
  const r = parseInvoiceAmount({ literal: '$1,234.56', numericFormat: 'en-US' });
  assert.equal(r.status, 'hold');
  assert.equal(r.need, 'currency');
});

test('$-only + explicit CAD resolution -> CAD 123456 recorded manual', () => {
  const r = ok('$1,234.56', { resolvedCurrency: 'CAD', numericFormat: 'en-US' });
  assert.equal(r.money.currency, 'CAD');
  assert.equal(r.money.minor, 123456n);
  assert.equal(r.evidence.currencySource, 'manual-resolution');
});

test('¥-only literal holds — no automatic JPY choice', () => {
  const r = parseInvoiceAmount({ literal: '¥1,234', numericFormat: 'en-US' });
  assert.equal(r.status, 'hold');
  assert.equal(r.need, 'currency');
});

test('ISO EUR + unresolved format + separated literal -> hold for format', () => {
  const r = parseInvoiceAmount({ literal: '1.234,56 EUR', numericFormat: 'unresolved' });
  assert.equal(r.status, 'hold');
  assert.equal(r.need, 'numeric-format');
});

test('KWD 1,234 unresolved format -> hold (en-US vs de-DE differ by 1000x)', () => {
  const r = parseInvoiceAmount({ literal: 'KWD 1,234', numericFormat: 'unresolved' });
  assert.equal(r.status, 'hold');
  assert.equal(r.need, 'numeric-format');
});

test('no currency evidence -> hold even when separators parse', () => {
  const r = parseInvoiceAmount({ literal: '123.45', numericFormat: 'en-US' });
  assert.equal(r.status, 'hold');
  assert.equal(r.need, 'currency');
});

// ---- adversarial rejections -------------------------------------------------

const REJECTS = [
  ['USD 12,34.56', 'en-US', /malformed/],
  ['1.23.456,78 EUR', 'de-DE', /malformed/],
  ['USD 1,234.56junk', 'en-US', /non-numeric|malformed/],
  ['USD 1e3', 'en-US', /non-numeric|exponent/],
  ['USD Infinity', 'en-US', /no amount|non-numeric|malformed/],
  ['USD NaN', 'en-US', /non-numeric|malformed/],
  ['USD -5', 'en-US', /signed/],
  ['USD +-5', 'en-US', /signed|non-numeric|malformed/],
  ['USD 1,00.00', 'en-US', /malformed/],
];

for (const [literal, fmt, re] of REJECTS) {
  test(`reject ${JSON.stringify(literal)} under ${fmt}`, () => {
    const r = parseInvoiceAmount({ literal, numericFormat: fmt });
    assert.equal(r.status, 'reject', JSON.stringify(r));
    assert.match(r.reason, re);
  });
}

test('empty literal rejected', () => {
  assert.equal(parseInvoiceAmount({ literal: '', numericFormat: 'en-US' }).status, 'reject');
  assert.equal(parseInvoiceAmount({ literal: '   ', numericFormat: 'en-US' }).status, 'reject');
});

test('conflicting ISO codes rejected', () => {
  const r = parseInvoiceAmount({ literal: 'USD 100 EUR', numericFormat: 'en-US' });
  assert.equal(r.status, 'reject');
  assert.match(r.reason, /conflicting ISO/);
});

test('symbol conflicting with ISO code rejected (€100 USD)', () => {
  const r = parseInvoiceAmount({ literal: '€100.00 USD', numericFormat: 'en-US' });
  assert.equal(r.status, 'reject');
  assert.match(r.reason, /conflicts/);
});

test('manual resolution conflicting with symbol rejected ($100 -> EUR)', () => {
  const r = parseInvoiceAmount({
    literal: '$100.00',
    resolvedCurrency: 'EUR',
    numericFormat: 'en-US',
  });
  assert.equal(r.status, 'reject');
  assert.match(r.reason, /conflicts/);
});

test('manual resolution conflicting with literal ISO rejected', () => {
  const r = parseInvoiceAmount({
    literal: 'USD 100.00',
    resolvedCurrency: 'CAD',
    numericFormat: 'en-US',
  });
  assert.equal(r.status, 'reject');
  assert.match(r.reason, /conflicts/);
});

test('consistent symbol + ISO accepted (€1.234,56 EUR)', () => {
  const r = ok('€1.234,56 EUR', { numericFormat: 'de-DE' });
  assert.equal(r.money.minor, 123456n);
});

// ---- size ------------------------------------------------------------------

test('beyond-safe-integer literal preserved exactly', () => {
  const r = ok('USD 90071992547409.93', { numericFormat: 'en-US' });
  assert.equal(r.money.minor.toString(), '9007199254740993');
});

// ---- provenance ------------------------------------------------------------

test('evidence preserves raw literal, format and provenance', () => {
  const r = ok('1.234,56 EUR', { numericFormat: 'de-DE' });
  assert.equal(r.evidence.literal, '1.234,56 EUR');
  assert.equal(r.evidence.isoInLiteral, 'EUR');
  assert.equal(r.evidence.numericFormat, 'de-DE');
  assert.equal(r.evidence.minor, '123456');
  assert.equal(r.evidence.currencySource, 'iso-literal');
});

test('unresolved symbol candidates offered on hold', () => {
  const r = parseInvoiceAmount({ literal: '$1,250.00', numericFormat: 'en-US' });
  assert.deepEqual(r.candidates, ['USD', 'CAD']);
});
