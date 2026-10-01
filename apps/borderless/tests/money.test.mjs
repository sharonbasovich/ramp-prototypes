// tests/money.test.mjs — engine/money.mjs oracle vectors from ACCEPTANCE.md
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  money,
  convert,
  parseRate,
  rateToDecimal,
  divRoundHalfEven,
  formatMoney,
  add,
  sub,
  cmp,
  moneyToJSON,
  moneyFromJSON,
  MoneyError,
} from '../src/engine/money.mjs';

const pair = (from, to) => ({ from, to });
const minor = (m) => m.minor.toString();

// ---- half-even oracle table (ACCEPTANCE.md "Exact FX and half-even") -----

const HALF_EVEN_VECTORS = [
  // [source currency, source minor, target, rate, expected target minor]
  ['USD', '1', 'CAD', '0.5', '0'],
  ['USD', '3', 'CAD', '0.5', '2'],
  ['USD', '5', 'CAD', '0.5', '2'],
  ['USD', '7', 'CAD', '0.5', '4'],
  ['JPY', '1', 'KWD', '0.0025', '2'],
  ['JPY', '3', 'KWD', '0.0025', '8'],
  ['KWD', '125', 'USD', '1', '12'],
  ['KWD', '135', 'USD', '1', '14'],
  ['USD', '1', 'JPY', '50', '0'],
  ['USD', '3', 'JPY', '50', '2'],
  ['EUR', '90000', 'USD', '1.08', '97200'],
  ['EUR', '90000', 'USD', '1.12', '100800'],
];

for (const [sc, sMinor, tc, rate, expected] of HALF_EVEN_VECTORS) {
  test(`convert ${sc} ${sMinor} -> ${tc} @ ${rate} = ${expected} (half-even)`, () => {
    const out = convert(money(sc, BigInt(sMinor)), pair(sc, tc), parseRate(rate));
    assert.equal(out.currency, tc);
    assert.equal(minor(out), expected);
  });
}

test('half-even divider: exact ties go to even', () => {
  assert.equal(divRoundHalfEven(5n, 2n), 2n); // 2.5 -> 2
  assert.equal(divRoundHalfEven(15n, 4n), 4n); // 3.75 -> 4
  assert.equal(divRoundHalfEven(7n, 2n), 4n); // 3.5 -> 4
  assert.equal(divRoundHalfEven(9n, 2n), 4n); // 4.5 -> 4
  assert.equal(divRoundHalfEven(1n, 4n), 0n); // 0.25 -> 0
});

test('identity conversion retains exact minor units', () => {
  const m = money('USD', 123456789012345n);
  const out = convert(m, pair('USD', 'USD'), parseRate('1'));
  assert.equal(minor(out), '123456789012345');
});

test('identity conversion rejects non-1 rate', () => {
  assert.throws(
    () => convert(money('USD', 100n), pair('USD', 'USD'), parseRate('2')),
    /identity conversion rate must equal 1/,
  );
});

test('pair direction is enforced — no silent reversal', () => {
  assert.throws(
    () => convert(money('USD', 100n), pair('EUR', 'USD'), parseRate('1.1')),
    /pair-direction|direction is EUR/,
  );
});

test('rejects zero/negative/non-decimal rates', () => {
  for (const bad of ['0', '-1.2', 'abc', '1e3', '1.2.3', '.5', '', '  ', 'NaN']) {
    assert.throws(() => parseRate(bad), MoneyError, `rate ${JSON.stringify(bad)}`);
  }
});

test('rate rational object must have positive BigInt denominator', () => {
  assert.throws(() => parseRate({ n: 1n, d: 0n }), MoneyError);
  assert.throws(() => parseRate({ n: -3n, d: 5n }), MoneyError);
  assert.throws(() => parseRate({ n: 1, d: 2 }), MoneyError);
});

test('unsupported currency metadata rejected', () => {
  assert.throws(() => money('XXX', 1n), /unsupported currency/);
  assert.throws(() => convert(money('USD', 1n), pair('USD', 'XXX'), parseRate('1')), /supported currencies/);
  assert.throws(() => convert(money('BTC', 1n), pair('BTC', 'USD'), parseRate('1')), MoneyError);
});

test('unlike-currency arithmetic rejected', () => {
  assert.throws(() => add(money('USD', 1n), money('EUR', 1n)), /cannot add/);
  assert.throws(() => sub(money('USD', 1n), money('CAD', 1n)), /cannot subtract/);
  assert.throws(() => cmp(money('JPY', 1n), money('KWD', 1n)), /cannot compare/);
});

test('negative money rejected; subtraction cannot go negative', () => {
  assert.throws(() => money('USD', -5n), /negative/);
  assert.throws(() => sub(money('USD', 5n), money('USD', 6n)), /negative/);
});

test('Money JSON round-trip preserves exact BigInt as decimal string', () => {
  const m = money('USD', 9007199254740993n);
  const json = moneyToJSON(m);
  assert.deepEqual(json, { currency: 'USD', minor: '9007199254740993' });
  assert.equal(moneyFromJSON(json).minor, 9007199254740993n);
  assert.throws(() => moneyFromJSON({ currency: 'USD', minor: 9007199254740993 }), /decimal string/);
});

test('formatMoney renders explicit currency + correct exponent', () => {
  assert.equal(formatMoney(money('USD', 98000n)), 'USD 980.00');
  assert.equal(formatMoney(money('JPY', 198000n)), 'JPY 198,000');
  assert.equal(formatMoney(money('KWD', 12345n)), 'KWD 12.345');
  assert.equal(formatMoney(money('EUR', 90000n)), 'EUR 900.00');
});

test('rateToDecimal renders exact decimal rates', () => {
  assert.equal(rateToDecimal(parseRate('1.08')), '1.08');
  assert.equal(rateToDecimal(parseRate('0.0025')), '0.0025');
  assert.equal(rateToDecimal(parseRate('50')), '50');
  assert.equal(rateToDecimal(parseRate('1')), '1');
});

test('huge amounts stay exact through conversion', () => {
  // USD 90,071,992,547,409.93 -> EUR at exactly 2 USD per EUR
  const out = convert(money('USD', 9007199254740993n), pair('USD', 'EUR'), parseRate('0.5'));
  // 9007199254740993 * 1 * 100 / (2 * 100) = 4503599627370496.5 -> 4503599627370496 (half-even)
  assert.equal(minor(out), '4503599627370496');
});
