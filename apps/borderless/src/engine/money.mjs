// engine/money.mjs — exact money arithmetic for the Borderless sandbox.
//
// Every monetary value is `{ currency, minor }` where `minor` is a BigInt
// count of the currency's minor units. No Number/float ever touches money.
// Rates are exact decimal-derived rationals `{ n, d }` meaning
// "n/d target major units per one source major unit" and are validated
// against an explicit direction `{ from, to }`.

/** @typedef {{ currency: string, minor: bigint }} Money */
/** @typedef {{ n: bigint, d: bigint }} Rational */
/** @typedef {{ from: string, to: string }} CurrencyPair */

export const CURRENCIES = Object.freeze({
  USD: Object.freeze({ code: 'USD', exponent: 2, label: 'US dollar' }),
  CAD: Object.freeze({ code: 'CAD', exponent: 2, label: 'Canadian dollar' }),
  EUR: Object.freeze({ code: 'EUR', exponent: 2, label: 'Euro' }),
  GBP: Object.freeze({ code: 'GBP', exponent: 2, label: 'Pound sterling' }),
  JPY: Object.freeze({ code: 'JPY', exponent: 0, label: 'Japanese yen' }),
  KWD: Object.freeze({ code: 'KWD', exponent: 3, label: 'Kuwaiti dinar' }),
});

export const CURRENCY_CODES = Object.freeze(Object.keys(CURRENCIES));

export class MoneyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MoneyError';
    this.code = code;
  }
}

export function isCurrency(code) {
  return Object.prototype.hasOwnProperty.call(CURRENCIES, code);
}

export function exponentOf(code) {
  if (!isCurrency(code)) {
    throw new MoneyError('unsupported-currency', `unsupported currency: ${code}`);
  }
  return CURRENCIES[code].exponent;
}

export function pow10(exp) {
  return 10n ** BigInt(exp);
}

/** Create a Money value. minor must be a non-negative BigInt. */
export function money(currency, minor) {
  if (!isCurrency(currency)) {
    throw new MoneyError('unsupported-currency', `unsupported currency: ${currency}`);
  }
  if (typeof minor !== 'bigint') {
    throw new MoneyError('bad-minor', `minor units must be a BigInt, got ${typeof minor}`);
  }
  if (minor < 0n) {
    throw new MoneyError('negative-money', 'sandbox payables cannot be negative');
  }
  return Object.freeze({ currency, minor });
}

export function moneyFromJSON(json) {
  if (!json || typeof json !== 'object') {
    throw new MoneyError('bad-money-json', 'money JSON must be an object');
  }
  if (typeof json.minor !== 'string' || !/^\d+$/.test(json.minor)) {
    throw new MoneyError('bad-money-json', 'money JSON minor must be a decimal string');
  }
  return money(json.currency, BigInt(json.minor));
}

export function moneyToJSON(m) {
  return { currency: m.currency, minor: m.minor.toString() };
}

export function sameCurrency(a, b) {
  return a.currency === b.currency;
}

export function add(a, b) {
  if (!sameCurrency(a, b)) {
    throw new MoneyError('mixed-currency', `cannot add ${a.currency} and ${b.currency}`);
  }
  return money(a.currency, a.minor + b.minor);
}

export function sub(a, b) {
  if (!sameCurrency(a, b)) {
    throw new MoneyError('mixed-currency', `cannot subtract ${a.currency} and ${b.currency}`);
  }
  const d = a.minor - b.minor;
  if (d < 0n) {
    throw new MoneyError('negative-money', 'subtraction would go negative');
  }
  return money(a.currency, d);
}

/** Three-way compare. Returns -1, 0, 1. Throws on currency mismatch. */
export function cmp(a, b) {
  if (!sameCurrency(a, b)) {
    throw new MoneyError('mixed-currency', `cannot compare ${a.currency} and ${b.currency}`);
  }
  return a.minor < b.minor ? -1 : a.minor > b.minor ? 1 : 0;
}

/**
 * Parse an exact decimal rate. "1.08" -> {n:108, d:100}; "50" -> {n:50, d:1}.
 * Rejects signs, exponents, trailing garbage, zero/negative rates and any
 * input that is not a plain non-negative decimal literal.
 */
export function parseRate(text) {
  if (text && typeof text === 'object' && 'n' in text && 'd' in text) {
    const { n, d } = text;
    if (typeof n !== 'bigint' || typeof d !== 'bigint') {
      throw new MoneyError('bad-rate', 'rate components must be BigInt');
    }
    if (d <= 0n) throw new MoneyError('bad-rate', 'rate denominator must be positive');
    if (n <= 0n) throw new MoneyError('bad-rate', 'rate must be positive');
    return Object.freeze(reduceRate({ n, d }));
  }
  if (typeof text !== 'string') {
    throw new MoneyError('bad-rate', 'rate must be a decimal string');
  }
  const t = text.trim();
  const m = /^(\d+)(?:\.(\d+))?$/.exec(t);
  if (!m) {
    throw new MoneyError('bad-rate', `rate is not a plain decimal: ${JSON.stringify(text)}`);
  }
  const frac = m[2] || '';
  const n = BigInt(m[1] + frac);
  const d = pow10(frac.length);
  if (n <= 0n) {
    throw new MoneyError('bad-rate', 'rate must be positive');
  }
  return Object.freeze(reduceRate({ n, d }));
}

function gcd(a, b) {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x === 0n ? 1n : x;
}

export function reduceRate(r) {
  const g = gcd(r.n, r.d);
  return { n: r.n / g, d: r.d / g };
}

export function rateToJSON(r) {
  return { n: r.n.toString(), d: r.d.toString() };
}

/** Render a rational rate as a trimmed decimal string, e.g. 108/100 -> "1.08". */
export function rateToDecimal(r, maxPlaces = 12) {
  // Exact when the denominator only has factors 2 and 5; otherwise rounded
  // display (fixtures are all exact decimals).
  let d = r.d;
  let twos = 0;
  let fives = 0;
  while (d % 2n === 0n) { d /= 2n; twos += 1; }
  while (d % 5n === 0n) { d /= 5n; fives += 1; }
  if (d === 1n) {
    const places = Math.max(twos, fives);
    const scaled = r.n * 2n ** BigInt(Math.max(0, places - twos)) * 5n ** BigInt(Math.max(0, places - fives));
    const s = scaled.toString().padStart(places + 1, '0');
    const intPart = s.slice(0, s.length - places) || '0';
    const frac = places ? s.slice(-places).replace(/0+$/, '') : '';
    return frac ? `${intPart}.${frac}` : intPart;
  }
  // Non-terminating: fixed-place rounded display for UI only.
  const scaled = divRoundHalfEven(r.n * pow10(maxPlaces), r.d);
  const s = scaled.toString().padStart(maxPlaces + 1, '0');
  const intPart = s.slice(0, s.length - maxPlaces);
  const frac = s.slice(-maxPlaces).replace(/0+$/, '');
  return frac ? `${intPart}.${frac}` : intPart;
}

/**
 * Divide a BigInt numerator by a positive denominator, rounding to the
 * nearest integer with ties to even (half-even / banker's rounding).
 */
export function divRoundHalfEven(numerator, denominator) {
  if (typeof numerator !== 'bigint' || typeof denominator !== 'bigint') {
    throw new MoneyError('bad-divide', 'half-even division requires BigInt operands');
  }
  if (denominator <= 0n) {
    throw new MoneyError('bad-divide', 'denominator must be positive');
  }
  const neg = numerator < 0n;
  const a = neg ? -numerator : numerator;
  let q = a / denominator;
  const r = a % denominator;
  const twice = r * 2n;
  if (twice > denominator) {
    q += 1n;
  } else if (twice === denominator && (q & 1n) === 1n) {
    q += 1n;
  }
  return neg ? -q : q;
}

/**
 * Convert `m` into `pair.to` minor units using rational rate `rate`
 * (target major per source major, direction pair.from -> pair.to).
 *
 * unrounded = m.minor * n * 10^t / (d * 10^s), rounded once to the
 * target minor unit with half-even.
 *
 * - The pair direction must match; we never silently invert a quote.
 * - Identity conversion (from === to) returns the exact minor units and
 *   requires the rate, if supplied, to equal 1.
 */
export function convert(m, pair, rate) {
  if (!pair || !isCurrency(pair.from) || !isCurrency(pair.to)) {
    throw new MoneyError('bad-pair', 'conversion pair must name two supported currencies');
  }
  if (m.currency !== pair.from) {
    throw new MoneyError(
      'pair-direction',
      `rate direction is ${pair.from}→${pair.to} but money is ${m.currency}`,
    );
  }
  if (pair.from === pair.to) {
    if (rate !== undefined && rate !== null) {
      const r = parseRate(rate);
      if (r.n !== r.d) {
        throw new MoneyError('bad-identity-rate', 'identity conversion rate must equal 1');
      }
    }
    return money(m.currency, m.minor);
  }
  if (rate === undefined || rate === null) {
    throw new MoneyError('missing-rate', `no rate supplied for ${pair.from}→${pair.to}`);
  }
  const r = parseRate(rate);
  const s = exponentOf(pair.from);
  const t = exponentOf(pair.to);
  const numerator = m.minor * r.n * pow10(t);
  const denominator = r.d * pow10(s);
  return money(pair.to, divRoundHalfEven(numerator, denominator));
}

const GROUP = ',';

/**
 * Display formatting only — never parses, never infers currency.
 * "USD 1,234.56", "JPY 1,234", "KWD 1.234".
 */
export function formatMoney(m, { grouping = true } = {}) {
  const exp = exponentOf(m.currency);
  const digits = m.minor.toString();
  const padded = exp > 0 ? digits.padStart(exp + 1, '0') : digits;
  const intDigits = exp > 0 ? padded.slice(0, padded.length - exp) : padded;
  const fracDigits = exp > 0 ? padded.slice(-exp) : '';
  const intPart = grouping ? groupThousands(intDigits) : intDigits;
  return fracDigits ? `${m.currency} ${intPart}.${fracDigits}` : `${m.currency} ${intPart}`;
}

function groupThousands(intDigits) {
  let out = '';
  let i = intDigits.length;
  while (i > 3) {
    out = GROUP + intDigits.slice(i - 3, i) + out;
    i -= 3;
  }
  return intDigits.slice(0, i) + out;
}
