// engine/parse.mjs — strict invoice-amount parsing for Currency Check.
//
// An invoice literal is never guessed: currency comes only from an explicit
// ISO code in the literal or an explicit user resolution; the numeric
// format (locale) must be explicit before separator characters are
// interpreted; a symbol never establishes a currency. All arithmetic is
// exact BigInt minor units — excess precision is rejected, never rounded
// into acceptance.

import { CURRENCIES, isCurrency, exponentOf, pow10, money } from './money.mjs';

export const NUMERIC_FORMATS = Object.freeze({
  'en-US': Object.freeze({ id: 'en-US', label: 'English · 1,234.56', group: ',', decimal: '.' }),
  'de-DE': Object.freeze({ id: 'de-DE', label: 'German · 1.234,56', group: '.', decimal: ',' }),
  // French grouping accepts the narrow no-break space U+202F, the classic
  // no-break space U+00A0, and a plain space typed by hand — all documented
  // grouping aliases, never a currency signal.
  'fr-FR': Object.freeze({ id: 'fr-FR', label: 'French · 1 234,56', group: null, decimal: ',' }),
});

const FR_GROUP_CLASS = '[\\u0020\\u00A0\\u202F]';

// Symbols only ever narrow a candidate set; they never choose a currency.
const SYMBOL_CANDIDATES = Object.freeze({
  '$': Object.freeze(['USD', 'CAD']),
  '€': Object.freeze(['EUR']),
  '£': Object.freeze(['GBP']),
  '¥': Object.freeze(['JPY']),
});

const ISO_RE = /\b(USD|CAD|EUR|GBP|JPY|KWD)\b/g;
const EDGE_WS_RE = /^[\s\u00A0\u202F]+|[\s\u00A0\u202F]+$/g;

function numRe(formatId) {
  if (formatId === 'fr-FR') {
    return new RegExp(
      `^(?:\\d{1,3}(?:${FR_GROUP_CLASS}\\d{3})+|\\d+)(?:,\\d+)?$`,
    );
  }
  const f = NUMERIC_FORMATS[formatId];
  const g = f.group === '.' ? '\\.' : f.group;
  const d = f.decimal === '.' ? '\\.' : f.decimal;
  return new RegExp(`^(?:\\d{1,3}(?:${g}\\d{3})+|\\d+)(?:${d}\\d+)?$`);
}

/**
 * Parse an invoice amount literal.
 *
 * @param {object} input
 * @param {string} input.literal raw invoice text (required, non-empty)
 * @param {string|null} [input.resolvedCurrency] explicit ISO code chosen by
 *   the user when the literal carries no ISO code (or, when supplied anyway,
 *   must not conflict with literal evidence)
 * @param {string} [input.numericFormat] 'en-US' | 'de-DE' | 'fr-FR' |
 *   'unresolved'. Required whenever the literal contains separator
 *   characters; a bare integer needs no format to be interpreted.
 *
 * @returns one of
 *   { status:'ok', money, evidence }
 *   { status:'hold', need:'currency'|'numeric-format', reason, literal, candidates }
 *   { status:'reject', reason, literal }
 */
export function parseInvoiceAmount({ literal, resolvedCurrency = null, numericFormat = 'unresolved' }) {
  if (typeof literal !== 'string' || literal.trim() === '') {
    return { status: 'reject', reason: 'empty invoice literal', literal: literal ?? '' };
  }
  if (resolvedCurrency != null && !isCurrency(resolvedCurrency)) {
    return { status: 'reject', reason: `unsupported resolved currency: ${resolvedCurrency}`, literal };
  }
  if (numericFormat !== 'unresolved' && !NUMERIC_FORMATS[numericFormat]) {
    return { status: 'reject', reason: `unsupported numeric format: ${numericFormat}`, literal };
  }

  // ---- currency evidence -------------------------------------------------
  const isoHits = new Set();
  for (const m of literal.matchAll(ISO_RE)) isoHits.add(m[1]);
  const symbols = [...literal].filter((ch) => SYMBOL_CANDIDATES[ch]);

  if (isoHits.size > 1) {
    return {
      status: 'reject',
      reason: `conflicting ISO currency codes in literal: ${[...isoHits].join(', ')}`,
      literal,
    };
  }
  const isoInLiteral = isoHits.size === 1 ? [...isoHits][0] : null;

  // symbol vs ISO / resolved conflicts
  const conflicts = (code) =>
    symbols.some((s) => !SYMBOL_CANDIDATES[s].includes(code));

  let currency;
  let currencySource;
  if (isoInLiteral) {
    if (conflicts(isoInLiteral)) {
      return {
        status: 'reject',
        reason: `currency symbol conflicts with ISO code ${isoInLiteral}`,
        literal,
      };
    }
    if (resolvedCurrency && resolvedCurrency !== isoInLiteral) {
      return {
        status: 'reject',
        reason: `resolved currency ${resolvedCurrency} conflicts with literal ISO code ${isoInLiteral}`,
        literal,
      };
    }
    currency = isoInLiteral;
    currencySource = 'iso-literal';
  } else if (resolvedCurrency) {
    if (conflicts(resolvedCurrency)) {
      return {
        status: 'reject',
        reason: `resolved currency ${resolvedCurrency} conflicts with symbol in literal`,
        literal,
      };
    }
    currency = resolvedCurrency;
    currencySource = 'manual-resolution';
  } else {
    return {
      status: 'hold',
      need: 'currency',
      reason: symbols.length
        ? `symbol "${symbols[0]}" cannot establish the invoice currency — choose an ISO currency explicitly`
        : 'no explicit ISO currency — choose an ISO currency explicitly',
      literal,
      candidates: symbols.length ? SYMBOL_CANDIDATES[symbols[0]] : null,
      symbolsSeen: symbols,
    };
  }

  // ---- numeric part ------------------------------------------------------
  const numeric = literal
    .replace(ISO_RE, ' ')
    .replace(/[$€£¥]/g, ' ')
    .replace(EDGE_WS_RE, '');

  if (numeric === '') {
    return { status: 'reject', reason: 'literal contains no amount', literal };
  }
  if (/[A-Za-z]/.test(numeric)) {
    return { status: 'reject', reason: `trailing or embedded non-numeric text: ${numeric}`, literal };
  }
  if (/[+-]/.test(numeric)) {
    return { status: 'reject', reason: 'signed amounts are outside payable-invoice scope', literal };
  }
  if (/[eE]/.test(numeric)) {
    return { status: 'reject', reason: 'exponent notation is not an invoice amount', literal };
  }

  const hasSeparators = /[.,\u00A0\u202F]/.test(numeric) || / \d/.test(numeric);
  const formatExplicit = numericFormat !== 'unresolved';
  if (hasSeparators && !formatExplicit) {
    return {
      status: 'hold',
      need: 'numeric-format',
      reason: 'amount contains separators — choose the numeric format explicitly before parsing',
      literal,
      candidates: Object.keys(NUMERIC_FORMATS),
      isoInLiteral: isoInLiteral,
      currency: currency,
    };
  }

  const formatUsed = formatExplicit ? numericFormat : null;
  if (formatUsed && !numRe(formatUsed).test(numeric)) {
    return {
      status: 'reject',
      reason: `malformed amount for ${formatUsed}: ${numeric}`,
      literal,
    };
  }
  if (!formatUsed && !/^\d+$/.test(numeric)) {
    // Only reachable for separator-free input; anything else was held above.
    return { status: 'reject', reason: `malformed amount: ${numeric}`, literal };
  }

  // ---- to minor units ----------------------------------------------------
  // Regex already validated shape, so splitting is unambiguous per format.
  const exp = exponentOf(currency);
  let intDigits;
  let fracDigits = '';
  if (formatUsed === 'en-US') {
    const cleaned = numeric.replace(/,/g, '');
    const dot = cleaned.indexOf('.');
    intDigits = dot >= 0 ? cleaned.slice(0, dot) : cleaned;
    fracDigits = dot >= 0 ? cleaned.slice(dot + 1) : '';
  } else if (formatUsed === 'de-DE') {
    const cleaned = numeric.replace(/\./g, '');
    const comma = cleaned.indexOf(',');
    intDigits = comma >= 0 ? cleaned.slice(0, comma) : cleaned;
    fracDigits = comma >= 0 ? cleaned.slice(comma + 1) : '';
  } else if (formatUsed === 'fr-FR') {
    const cleaned = numeric.replace(/[\u0020\u00A0\u202F]/g, '');
    const comma = cleaned.indexOf(',');
    intDigits = comma >= 0 ? cleaned.slice(0, comma) : cleaned;
    fracDigits = comma >= 0 ? cleaned.slice(comma + 1) : '';
  } else {
    intDigits = numeric;
  }

  if (intDigits === '' || !/^\d+$/.test(intDigits) || (fracDigits !== '' && !/^\d+$/.test(fracDigits))) {
    return { status: 'reject', reason: `malformed amount: ${numeric}`, literal };
  }
  if (fracDigits.length > exp) {
    return {
      status: 'reject',
      reason: `excess fractional precision for ${currency} (${fracDigits.length} digits > ${exp} minor units)`,
      literal,
    };
  }
  const minor = BigInt(intDigits) * pow10(exp) + BigInt((fracDigits || '').padEnd(exp, '0') || '0');

  return {
    status: 'ok',
    money: money(currency, minor),
    evidence: {
      literal,
      currencySource,
      isoInLiteral,
      symbolsSeen: symbols,
      resolvedCurrency: currencySource === 'manual-resolution' ? currency : null,
      numericFormat: formatUsed,
      formatExplicit,
      integerPart: intDigits,
      fractionPart: fracDigits,
      minor: minor.toString(),
    },
  };
}
