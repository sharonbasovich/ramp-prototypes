// engine/cost.mjs — True Cost: compare complete landed costs, not stickers.
//
// Vendors quote the same basket. Goods may be priced in any supported
// currency; a supplied fixture rate table converts into the reporting
// currency. Shipping / fees / tax-duty are explicit supplied charges in
// explicit currencies — a blank charge is UNKNOWN, not zero, and an
// incomplete quote can never win the "lowest complete cost" selection.

import {
  money,
  moneyToJSON,
  convert,
  add,
  parseRate,
  rateToJSON,
  rateToDecimal,
  MoneyError,
  isCurrency,
} from './money.mjs';

export const COST_FIXTURE = Object.freeze({
  reporting: 'USD',
  rateText: '1.10', // USD per EUR
  vendors: Object.freeze([
    Object.freeze({
      id: 'berlin',
      name: 'Berlin Supply',
      goods: Object.freeze({ currency: 'EUR', minor: 85000n }),
      shipping: Object.freeze({ currency: 'USD', minor: 9000n }),
      fee: Object.freeze({ currency: 'USD', minor: 2500n }),
      taxDuty: Object.freeze({ currency: 'USD', minor: 0n }),
    }),
    Object.freeze({
      id: 'boston',
      name: 'Boston Supply',
      goods: Object.freeze({ currency: 'USD', minor: 100000n }),
      shipping: Object.freeze({ currency: 'USD', minor: 2000n }),
      fee: Object.freeze({ currency: 'USD', minor: 0n }),
      taxDuty: Object.freeze({ currency: 'USD', minor: 0n }),
    }),
  ]),
});

let selSeq = 0;

export function createCostState({ epoch = 1 } = {}) {
  return {
    epoch,
    reporting: COST_FIXTURE.reporting,
    rate: parseRate(COST_FIXTURE.rateText),
    ratePair: { from: 'EUR', to: 'USD' },
    policyRevision: 1,
    vendors: COST_FIXTURE.vendors.map((v) => ({
      id: v.id,
      name: v.name,
      goods: money(v.goods.currency, v.goods.minor),
      // null = unknown charge (distinct from an explicit zero)
      shipping: v.shipping ? money(v.shipping.currency, v.shipping.minor) : null,
      fee: v.fee ? money(v.fee.currency, v.fee.minor) : null,
      taxDuty: v.taxDuty ? money(v.taxDuty.currency, v.taxDuty.minor) : null,
    })),
    selection: null, // {id, fingerprint, vendorId, total, at, revoked}
    clock: Date.parse('2026-10-01T09:00:00.000Z'),
    events: [{ at: Date.parse('2026-10-01T09:00:00.000Z'), kind: 'load', text: 'Compare like-for-like totals in USD · illustrative quotes' }],
  };
}

function log(state, kind, text) {
  state.events.push({ at: state.clock, kind, text });
}

function costFingerprint(state) {
  const parts = [state.epoch, state.reporting, state.rate.n, state.rate.d, state.policyRevision];
  for (const v of state.vendors) {
    parts.push(
      v.id,
      v.goods.currency, v.goods.minor.toString(),
      v.shipping ? `${v.shipping.currency}:${v.shipping.minor}` : 'unknown',
      v.fee ? `${v.fee.currency}:${v.fee.minor}` : 'unknown',
      v.taxDuty ? `${v.taxDuty.currency}:${v.taxDuty.minor}` : 'unknown',
    );
  }
  return parts.join('|');
}

/** Convert one component to reporting currency; null result + reason when
 *  the fixture has no rate for the pair. */
function convertComponent(amount, state) {
  if (amount === null) return { money: null, unknown: true, reason: 'not supplied — cannot be treated as zero' };
  if (amount.currency === state.reporting) {
    return { money: amount, unknown: false };
  }
  if (amount.currency === state.ratePair.from && state.reporting === state.ratePair.to) {
    try {
      return { money: convert(amount, state.ratePair, state.rate), unknown: false };
    } catch (e) {
      return { money: null, unknown: true, reason: `conversion failed: ${e.message}` };
    }
  }
  return {
    money: null,
    unknown: true,
    reason: `no fixture rate for ${amount.currency}→${state.reporting} — pair unavailable, not assumed`,
  };
}

export function computeVendor(vendor, state) {
  const goods = convertComponent(vendor.goods, state);
  const shipping = convertComponent(vendor.shipping, state);
  const fee = convertComponent(vendor.fee, state);
  const taxDuty = convertComponent(vendor.taxDuty, state);
  const parts = { goods, shipping, fee, taxDuty };
  const unknowns = Object.entries(parts)
    .filter(([, p]) => p.unknown)
    .map(([k, p]) => ({ component: k, reason: p.reason }));
  let total = null;
  if (unknowns.length === 0) {
    try {
      total = [goods, shipping, fee, taxDuty]
        .map((p) => p.money)
        .reduce((acc, m) => add(acc, m));
    } catch (e) {
      unknowns.push({ component: 'total', reason: String(e.message || e) });
    }
  }
  return {
    id: vendor.id,
    name: vendor.name,
    goodsOriginal: vendor.goods,
    goodsConverted: goods.money,
    shippingOriginal: vendor.shipping,
    feeOriginal: vendor.fee,
    taxDutyOriginal: vendor.taxDuty,
    shipping,
    fee,
    taxDuty,
    complete: unknowns.length === 0,
    unknowns,
    total,
  };
}

export function compareCosts(state) {
  const rows = state.vendors.map((v) => computeVendor(v, state));
  // sticker winner = cheapest converted goods across all vendors
  let sticker = null;
  for (const r of rows) {
    if (r.goodsConverted && (!sticker || r.goodsConverted.minor < sticker.goodsConverted.minor)) {
      sticker = r;
    }
  }
  const completeRows = rows.filter((r) => r.complete);
  const incompleteRows = rows.filter((r) => !r.complete);
  let winner = null;
  let tie = false;
  if (completeRows.length > 0) {
    let best = completeRows[0];
    for (const r of completeRows) {
      if (r.total.minor < best.total.minor) best = r;
    }
    tie = completeRows.filter((r) => r.total.minor === best.total.minor).length > 1;
    winner = tie ? null : best;
  }
  // Difference between the complete-cost winner and the runner-up (BigInt —
  // never Number, amounts can exceed safe-integer range).
  let difference = null;
  if (winner && completeRows.length > 1) {
    let runnerUp = null;
    for (const r of completeRows) {
      if (r.id === winner.id) continue;
      if (!runnerUp || r.total.minor < runnerUp.total.minor) runnerUp = r;
    }
    difference = runnerUp ? runnerUp.total.minor - winner.total.minor : null;
  }
  // selection only meaningful when every quote is complete
  const selectionReady = rows.length > 0 && incompleteRows.length === 0 && !tie && winner !== null;
  let selectionStatus = 'none';
  if (state.selection) {
    if (state.selection.revoked) selectionStatus = 'revoked';
    else if (state.selection.fingerprint !== costFingerprint(state)) selectionStatus = 'stale';
    else if (state.selection.epoch !== state.epoch) selectionStatus = 'stale-epoch';
    else selectionStatus = 'current';
  }
  return {
    rows,
    stickerWinner: sticker,
    completeWinner: winner,
    tie,
    differenceMinor: difference,
    incompleteCount: incompleteRows.length,
    selectionReady,
    selectionStatus,
    selectionUsable: selectionStatus === 'current',
    fingerprint: costFingerprint(state),
  };
}

function revokeSelection(state) {
  if (state.selection && !state.selection.revoked) {
    state.selection.revoked = true;
    state.selection.revokedAt = state.clock;
    log(state, 'revoke', `Selection ${state.selection.id} revoked — comparison inputs changed`);
  }
}

/** Edit a vendor component. Pass null minor to mark a charge UNKNOWN. */
export function editCost(state, { vendorId, component, currency, minor, rateText }) {
  const v = state.vendors.find((x) => x.id === vendorId);
  if (rateText !== undefined) {
    try {
      state.rate = parseRate(rateText);
    } catch (e) {
      log(state, 'reject', `Rate edit rejected: ${e.message}`);
      return { ok: false, reason: `invalid rate: ${e.message}` };
    }
    state.policyRevision += 1;
    revokeSelection(state);
    log(state, 'edit', `Fixture rate → 1 EUR = ${rateToDecimal(state.rate)} USD`);
    return { ok: true, changed: true };
  }
  if (!v) return { ok: false, reason: `unknown vendor ${vendorId}` };
  if (!['goods', 'shipping', 'fee', 'taxDuty'].includes(component)) {
    return { ok: false, reason: `unknown component ${component}` };
  }
  if (minor === null) {
    if (component === 'goods') {
      return { ok: false, reason: 'goods amount cannot be unknown — the basket itself must be priced' };
    }
    v[component] = null;
  } else {
    if (typeof minor !== 'bigint' || minor < 0n) {
      return { ok: false, reason: `${component} must be a non-negative integer minor amount or unknown` };
    }
    const cur = currency ?? (v[component]?.currency ?? state.reporting);
    if (!isCurrency(cur)) return { ok: false, reason: `unsupported currency ${cur}` };
    v[component] = money(cur, minor);
  }
  state.policyRevision += 1;
  revokeSelection(state);
  log(state, 'edit', `${v.name} ${component} → ${minor === null ? 'unknown' : `${v[component].currency} ${v[component].minor.toString()} minor`}`);
  return { ok: true, changed: true };
}

/** "Choose lowest complete cost" — creates a review snapshot. Blocked while
 *  any quote is incomplete or totals tie. */
export function selectLowestComplete(state) {
  const cmp = compareCosts(state);
  if (cmp.incompleteCount > 0) {
    const names = cmp.rows.filter((r) => !r.complete).map((r) => r.name).join(', ');
    log(state, 'blocked', `Selection blocked: incomplete quote(s) — ${names}`);
    return { ok: false, reason: `incomplete quote(s): ${names} — supply every charge before selecting` };
  }
  if (cmp.tie) {
    log(state, 'blocked', 'Selection blocked: identical complete totals — a tie, not a winner');
    return { ok: false, reason: 'identical complete totals — no winner to select' };
  }
  if (!cmp.completeWinner) {
    return { ok: false, reason: 'no complete quote available' };
  }
  selSeq += 1;
  state.selection = {
    id: `S-${state.epoch}-${selSeq}`,
    epoch: state.epoch,
    fingerprint: cmp.fingerprint,
    vendorId: cmp.completeWinner.id,
    vendorName: cmp.completeWinner.name,
    total: moneyToJSON(cmp.completeWinner.total),
    selectedAt: state.clock,
    revoked: false,
  };
  log(state, 'select', `Selected ${cmp.completeWinner.name} — lowest complete cost ${state.selection.total.currency} ${state.selection.total.minor} minor`);
  return { ok: true, selection: state.selection };
}

export function resetCost(state) {
  const fresh = createCostState({ epoch: state.epoch + 1 });
  log(fresh, 'reset', `Comparison reset · new epoch ${fresh.epoch}`);
  return fresh;
}

export function exportCostAudit(state) {
  const cmp = compareCosts(state);
  return {
    scenario: 'true-cost',
    generatedAt: state.clock,
    epoch: state.epoch,
    mode: 'browser sandbox — single tab, no shared budget, no payments',
    disclaimers: [
      'Every rate, charge and offer is a supplied fixture — not a quote.',
      'Estimates from supplied assumptions; unknown charges block selection.',
      'Zero tax/duty in this fixture — no universal tax or compliance claim.',
      'The comparison difference is not realized savings.',
    ],
    inputs: {
      reporting: state.reporting,
      rate: { pair: `${state.ratePair.from}→${state.ratePair.to}`, ...rateToJSON(state.rate), decimal: rateToDecimal(state.rate) },
      vendors: state.vendors.map((v) => ({
        id: v.id,
        name: v.name,
        goods: moneyToJSON(v.goods),
        shipping: v.shipping ? moneyToJSON(v.shipping) : null,
        fee: v.fee ? moneyToJSON(v.fee) : null,
        taxDuty: v.taxDuty ? moneyToJSON(v.taxDuty) : null,
      })),
      policyRevision: state.policyRevision,
    },
    computed: {
      rows: cmp.rows.map((r) => ({
        id: r.id,
        name: r.name,
        goodsOriginal: moneyToJSON(r.goodsOriginal),
        goodsConverted: r.goodsConverted ? moneyToJSON(r.goodsConverted) : null,
        shippingOriginal: r.shippingOriginal ? moneyToJSON(r.shippingOriginal) : null,
        feeOriginal: r.feeOriginal ? moneyToJSON(r.feeOriginal) : null,
        taxDutyOriginal: r.taxDutyOriginal ? moneyToJSON(r.taxDutyOriginal) : null,
        complete: r.complete,
        unknowns: r.unknowns,
        total: r.total ? moneyToJSON(r.total) : null,
      })),
      stickerWinner: cmp.stickerWinner ? cmp.stickerWinner.id : null,
      completeWinner: cmp.completeWinner ? cmp.completeWinner.id : null,
      tie: cmp.tie,
      differenceMinor: cmp.differenceMinor != null ? cmp.differenceMinor.toString() : null,
      incompleteCount: cmp.incompleteCount,
    },
    selection: state.selection
      ? { ...state.selection, status: cmp.selectionStatus, usable: cmp.selectionUsable }
      : null,
    decisions: state.events.map((e) => ({ at: e.at, kind: e.kind, text: e.text })),
  };
}
