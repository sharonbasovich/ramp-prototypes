// engine/check.mjs — Currency Check scenario state.
//
// Wraps the strict parser and the funding-route preflight. A normalized
// invoice can only be saved when BOTH the parse succeeded AND the route
// preflight passed — and even then it is a sandbox record, never a bill.

import { moneyToJSON } from './money.mjs';
import { parseInvoiceAmount } from './parse.mjs';
import { evaluateFundingRoute, ROUTE_DISCLAIMER } from './route.mjs';

export const CHECK_FIXTURES = Object.freeze([
  Object.freeze({ id: 'ambiguous-usd', label: 'Canadian supplier · $1,250.00', literal: '$1,250.00', note: 'symbol never guesses the currency' }),
  Object.freeze({ id: 'german-eur', label: 'German invoice · 1.234,56 EUR', literal: '1.234,56 EUR', note: 'decimal comma + dot grouping' }),
  Object.freeze({ id: 'jpy-zero-dec', label: 'Japanese supplier · JPY 198,000', literal: 'JPY 198,000', note: 'zero decimal places' }),
  Object.freeze({ id: 'kwd-three-dec', label: 'Kuwaiti supplier · KWD 12.345', literal: 'KWD 12.345', note: 'three decimal places — parsing only, no route claim' }),
  Object.freeze({ id: 'malformed', label: 'Malformed · USD 1,23.456', literal: 'USD 1,23.456', note: 'bad grouping must reject, never guess' }),
]);

export const FUNDING_ACCOUNTS = Object.freeze([
  Object.freeze({ id: 'ca-usd', label: 'Canada · USD', fundingCurrency: 'USD' }),
  Object.freeze({ id: 'ca-cad', label: 'Canada · CAD', fundingCurrency: 'CAD' }),
  Object.freeze({ id: 'us-usd', label: 'United States · USD', fundingCurrency: 'USD' }),
  Object.freeze({ id: 'gb-gbp', label: 'United Kingdom · GBP', fundingCurrency: 'GBP' }),
]);

export const ENTITY_COUNTRIES = Object.freeze([
  Object.freeze({ id: 'CA', label: 'Canada' }),
  Object.freeze({ id: 'US', label: 'United States' }),
  Object.freeze({ id: 'GB', label: 'United Kingdom' }),
  Object.freeze({ id: 'DE', label: 'Germany' }),
]);

export function createCheckState({ epoch = 1 } = {}) {
  return {
    epoch,
    literal: '$1,250.00',
    resolvedCurrency: null, // explicit user choice; null = not chosen
    numericFormat: 'unresolved',
    entityCountry: 'CA',
    fundingAccountId: 'ca-usd',
    result: null, // last validation {inputsFingerprint, parse, route}
    saved: [],    // normalized invoice sandbox records
    clock: Date.parse('2026-10-01T09:00:00.000Z'),
    events: [{ at: Date.parse('2026-10-01T09:00:00.000Z'), kind: 'load', text: 'Invoice imported · $1,250.00 · currency unresolved' }],
  };
}

function log(state, kind, text) {
  state.events.push({ at: state.clock, kind, text });
}

function inputsFingerprint(state) {
  return [
    state.literal,
    state.resolvedCurrency ?? '',
    state.numericFormat,
    state.entityCountry,
    state.fundingAccountId,
  ].join('|');
}

export function fundingCurrencyOf(state) {
  const acct = FUNDING_ACCOUNTS.find((a) => a.id === state.fundingAccountId);
  return acct ? acct.fundingCurrency : null;
}

export function editCheck(state, patch) {
  Object.assign(state, patch);
  return { ok: true };
}

export function validateCheck(state) {
  const parse = parseInvoiceAmount({
    literal: state.literal,
    resolvedCurrency: state.resolvedCurrency,
    numericFormat: state.numericFormat,
  });
  const route = evaluateFundingRoute({
    entityCountry: state.entityCountry,
    fundingCurrency: fundingCurrencyOf(state),
  });
  state.result = {
    inputsFingerprint: inputsFingerprint(state),
    at: state.clock,
    parse,
    route,
  };
  if (parse.status === 'ok') {
    log(state, 'validate', `Parsed ${parse.money.currency} ${parse.money.minor.toString()} minor · format ${parse.evidence.numericFormat ?? 'n/a'} · route ${route.decision}`);
  } else {
    log(state, 'validate', `Validation ${parse.status}: ${parse.reason} · route ${route.decision}`);
  }
  return state.result;
}

/** Result is stale once inputs changed since the last validation. */
export function checkResultStale(state) {
  return !state.result || state.result.inputsFingerprint !== inputsFingerprint(state);
}

/** Save a normalized invoice sandbox record — only after a current,
 *  passing parse AND a passing route preflight. Not a real bill. */
export function saveNormalizedInvoice(state, recordId) {
  const r = state.result;
  if (!r || checkResultStale(state)) {
    return { ok: false, reason: 'inputs changed since validation — validate again first' };
  }
  if (r.parse.status !== 'ok') {
    return { ok: false, reason: `cannot save: parse ${r.parse.status} — ${r.parse.reason}` };
  }
  if (r.route.decision !== 'preflight-passed') {
    return {
      ok: false,
      reason: r.route.decision === 'not-evaluated'
        ? 'route was not evaluated — saving requires the documented Canada CAD preflight pass'
        : `route blocked: ${r.route.reason}`,
    };
  }
  if (state.saved.some((s) => s.recordId === recordId)) {
    return { ok: true, replay: true, record: state.saved.find((s) => s.recordId === recordId) };
  }
  const record = {
    recordId,
    at: state.clock,
    kind: 'normalized-invoice',
    note: 'sandbox record — no bill created',
    literal: r.parse.evidence.literal,
    currency: r.parse.money.currency,
    minor: r.parse.money.minor.toString(),
    numericFormat: r.parse.evidence.numericFormat,
    currencySource: r.parse.evidence.currencySource,
    routeDecision: r.route.decision,
    routeLabel: r.route.label,
  };
  state.saved.push(record);
  log(state, 'save', `Normalized invoice saved · ${record.currency} ${record.minor} minor · ${record.routeLabel}`);
  return { ok: true, record };
}

export function resetCheck(state) {
  const fresh = createCheckState({ epoch: state.epoch + 1 });
  log(fresh, 'reset', `Scenario reset · new epoch ${fresh.epoch}`);
  return fresh;
}

export function exportCheckAudit(state) {
  const r = state.result;
  return {
    scenario: 'currency-check',
    generatedAt: state.clock,
    epoch: state.epoch,
    mode: 'browser sandbox — single tab, no shared state, no payments',
    disclaimers: [
      'A symbol never establishes a currency; resolution is always explicit.',
      'KWD/JPY vectors are generic monetary examples — no route-support claim.',
      'Canadian Bill Pay route is a simplified documented fixture; ' + ROUTE_DISCLAIMER,
    ],
    inputs: {
      literal: state.literal,
      resolvedCurrency: state.resolvedCurrency,
      numericFormat: state.numericFormat,
      entityCountry: state.entityCountry,
      fundingAccountId: state.fundingAccountId,
      fundingCurrency: fundingCurrencyOf(state),
    },
    result: r
      ? {
          stale: checkResultStale(state),
          parse: r.parse.status === 'ok'
            ? {
                status: 'ok',
                money: moneyToJSON(r.parse.money),
                evidence: r.parse.evidence,
              }
            : { status: r.parse.status, need: r.parse.need ?? null, reason: r.parse.reason, candidates: r.parse.candidates ?? null },
          route: r.route,
        }
      : null,
    saved: state.saved.map((s) => ({ ...s })),
    decisions: state.events.map((e) => ({ at: e.at, kind: e.kind, text: e.text })),
  };
}
