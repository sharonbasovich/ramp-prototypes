// engine/guard.mjs — FX Guard: approval snapshot, staleness, single commit.
//
// The sandbox invoice is a fixed EUR obligation funded in USD against a USD
// budget. An approval binds the complete displayed snapshot: invoice money,
// pair+direction, exact rational rate, fee, budget, quote identity/expiry
// and policy revision. ANY input edit or new quote permanently revokes an
// approval — reverting inputs never restores it. A commit succeeds exactly
// once per approval and only while the snapshot is current, the quote is
// unexpired, and the debit fits the budget. The demo clock is injectable;
// quote validity is a 2-minute DEMO rule, not a provider promise.

import {
  money,
  moneyToJSON,
  moneyFromJSON,
  convert,
  add,
  parseRate,
  rateToJSON,
  rateToDecimal,
  MoneyError,
  isCurrency,
} from './money.mjs';

export const QUOTE_VALID_MS = 120_000; // 2 minutes — demo validity only
export const DEMO_CLOCK_START = Date.parse('2026-10-01T09:00:00.000Z');

export const GUARD_FIXTURE = Object.freeze({
  invoiceLiteral: 'EUR 900.00',
  invoice: Object.freeze({ currency: 'EUR', minor: 90000n }),
  rateText: '1.08',
  fee: Object.freeze({ currency: 'USD', minor: 800n }),
  budget: Object.freeze({ currency: 'USD', minor: 100000n }),
  pair: Object.freeze({ from: 'EUR', to: 'USD' }),
});

let quoteSeq = 0;
let approvalSeq = 0;
let ledgerSeq = 0;

function issueQuote(state, rate, note) {
  quoteSeq += 1;
  const quote = {
    id: `Q-${state.epoch}-${quoteSeq}`,
    pair: { ...state.pair },
    rate,
    issuedAt: state.clock,
    expiresAt: state.clock + QUOTE_VALID_MS,
    validityMs: QUOTE_VALID_MS,
    validityKind: 'demo',
  };
  state.quote = quote;
  state.expiryObserved = false; // tracks the CURRENT quote's expiry
  revokeApproval(state);
  state.policyRevision += 1;
  log(state, 'quote', note ?? `Quote refreshed · 1 ${quote.pair.from} = ${rateToDecimal(rate)} ${quote.pair.to} · fixture rate · valid 2 minutes (demo)`);
  return quote;
}

function log(state, kind, text) {
  state.events.push({ at: state.clock, kind, text });
}

function revokeApproval(state) {
  if (state.approval && !state.approval.revoked) {
    state.approval.revoked = true;
    state.approval.revokedAt = state.clock;
    log(state, 'revoke', `Approval ${state.approval.id} revoked — snapshot inputs changed`);
  }
}

/** Once expiry has been observed it is terminal: a clock that later moves
 *  back cannot resurrect the quote or any approval bound to it. */
function observeExpiry(state) {
  if (!state.expiryObserved && state.clock >= state.quote.expiresAt) {
    state.expiryObserved = true;
    if (state.approval && !state.approval.revoked) {
      state.approval.revoked = true;
      state.approval.revokedAt = state.clock;
      log(state, 'revoke', `Approval ${state.approval.id} revoked — quote expired`);
    }
  }
}

export function createGuardState({ clock = DEMO_CLOCK_START, epoch = 1 } = {}) {
  const state = {
    epoch,
    clock,
    pair: { ...GUARD_FIXTURE.pair },
    inputs: {
      invoice: money(GUARD_FIXTURE.invoice.currency, GUARD_FIXTURE.invoice.minor),
      rate: parseRate(GUARD_FIXTURE.rateText),
      fee: money(GUARD_FIXTURE.fee.currency, GUARD_FIXTURE.fee.minor),
      budget: money(GUARD_FIXTURE.budget.currency, GUARD_FIXTURE.budget.minor),
    },
    policyRevision: 1,
    quote: null,
    expiryObserved: false,
    approval: null,
    ledger: [],
    processedCommands: {},
    committedApprovals: {},
    events: [],
  };
  issueQuote(state, state.inputs.rate, 'Quote loaded · 1 EUR = 1.08 USD · fixture rate · valid 2 minutes (demo)');
  state.policyRevision = 1; // first quote is part of the fixture, not an edit
  return state;
}

/** Canonical identity of the full approvable snapshot. */
export function snapshotFingerprint(state) {
  const { invoice, rate, fee, budget } = state.inputs;
  const q = state.quote;
  return [
    state.epoch,
    invoice.currency, invoice.minor.toString(),
    state.pair.from, state.pair.to,
    rate.n.toString(), rate.d.toString(),
    fee.currency, fee.minor.toString(),
    budget.currency, budget.minor.toString(),
    q.id, q.expiresAt.toString(),
    state.policyRevision,
  ].join('|');
}

/** Derived display/decision values. Pure read — no mutation. */
export function computePlan(state) {
  const { invoice, rate, fee, budget } = state.inputs;
  let converted = null;
  let error = null;
  try {
    converted = convert(invoice, state.pair, rate);
  } catch (e) {
    error = e instanceof MoneyError ? `${e.code}: ${e.message}` : String(e);
  }
  let debit = null;
  if (converted && fee.currency === converted.currency) {
    debit = add(converted, fee);
  } else if (converted) {
    error = `fee currency ${fee.currency} does not match converted currency ${converted.currency}`;
  }
  const expired = state.expiryObserved || state.clock >= state.quote.expiresAt;
  const sameBudgetCurrency = debit !== null && debit.currency === budget.currency;
  if (debit && !sameBudgetCurrency) {
    error = `budget currency ${budget.currency} does not match debit currency ${debit.currency}`;
  }
  const headroomMinor = sameBudgetCurrency ? budget.minor - debit.minor : null; // signed
  const withinBudget = Boolean(sameBudgetCurrency && headroomMinor >= 0n);
  const fp = snapshotFingerprint(state);
  const a = state.approval;
  let approvalStatus = 'none';
  if (a) {
    if (state.committedApprovals[a.id]) approvalStatus = 'committed';
    else if (a.revoked) approvalStatus = 'revoked';
    else if (a.epoch !== state.epoch) approvalStatus = 'stale-epoch';
    else if (a.fingerprint !== fp) approvalStatus = 'stale';
    else if (expired) approvalStatus = 'expired';
    else if (!withinBudget) approvalStatus = 'over-budget';
    else approvalStatus = 'current';
  }
  return {
    converted,
    fee,
    debit,
    budget,
    headroomMinor,
    withinBudget,
    expired,
    error,
    approvalStatus,
    approvalUsable: approvalStatus === 'current',
    fingerprint: fp,
    spentMinor: state.ledger.reduce((acc, r) => acc + BigInt(r.debit.minor), 0n),
  };
}

function setApprovalRevokedOnEdit(state) {
  revokeApproval(state);
  state.policyRevision += 1;
}

/** Reject an attempted bound-input currency/direction change: the approval
 *  is still permanently revoked because the pre-edit snapshot can no longer
 *  be trusted — even though the numeric inputs stay unchanged. */
function rejectBoundEdit(state, field, attempted, expected) {
  setApprovalRevokedOnEdit(state);
  log(state, 'reject', `${field} ${attempted} rejected — fixture pair is ${state.pair.from}→${state.pair.to}`);
  return { ok: false, reason: `${field} must stay ${expected} in this fixture pair`, revokedApproval: true };
}

/** Strict input edits. Any accepted edit — and any attempted currency or
 *  pair-direction change — permanently revokes approval. */
export function editInputs(state, patch) {
  // Currency / direction edits are rejected but still revoke the approval.
  if (patch.pair !== undefined &&
      (patch.pair.from !== state.pair.from || patch.pair.to !== state.pair.to)) {
    return rejectBoundEdit(state, 'FX direction', `${patch.pair.from}→${patch.pair.to}`, `${state.pair.from}→${state.pair.to}`);
  }
  if (patch.invoiceCurrency !== undefined && patch.invoiceCurrency !== state.inputs.invoice.currency) {
    return rejectBoundEdit(state, 'Invoice currency', patch.invoiceCurrency, state.pair.from);
  }
  if (patch.feeCurrency !== undefined && patch.feeCurrency !== state.inputs.fee.currency) {
    return rejectBoundEdit(state, 'Fee currency', patch.feeCurrency, state.pair.to);
  }
  if (patch.budgetCurrency !== undefined && patch.budgetCurrency !== state.inputs.budget.currency) {
    return rejectBoundEdit(state, 'Budget currency', patch.budgetCurrency, state.pair.to);
  }

  const next = { ...state.inputs };
  const changed = [];
  if (patch.invoiceMinor !== undefined) {
    const minor = patch.invoiceMinor;
    if (typeof minor !== 'bigint' || minor < 0n) return fail(state, 'invoice minor units must be a non-negative integer');
    if (minor !== next.invoice.minor) {
      next.invoice = money(next.invoice.currency, minor);
      changed.push(`invoice → ${next.invoice.currency} ${minor.toString()} minor`);
    }
  }
  if (patch.rateText !== undefined) {
    let r;
    try {
      r = parseRate(patch.rateText);
    } catch (e) {
      return fail(state, `invalid rate: ${e.message}`);
    }
    if (r.n !== next.rate.n || r.d !== next.rate.d) {
      next.rate = r;
      changed.push(`rate → ${rateToDecimal(r)} ${state.pair.to}/${state.pair.from}`);
    }
  }
  if (patch.feeMinor !== undefined) {
    const minor = patch.feeMinor;
    if (typeof minor !== 'bigint' || minor < 0n) return fail(state, 'fee must be a non-negative integer minor amount');
    if (minor !== next.fee.minor) {
      next.fee = money(next.fee.currency, minor);
      changed.push(`fee → ${next.fee.currency} ${minor.toString()} minor`);
    }
  }
  if (patch.budgetMinor !== undefined) {
    const minor = patch.budgetMinor;
    if (typeof minor !== 'bigint' || minor < 0n) return fail(state, 'budget must be a non-negative integer minor amount');
    if (minor !== next.budget.minor) {
      next.budget = money(next.budget.currency, minor);
      changed.push(`budget → ${next.budget.currency} ${minor.toString()} minor`);
    }
  }
  if (changed.length === 0) {
    return { ok: true, changed: false };
  }
  state.inputs = next;
  setApprovalRevokedOnEdit(state);
  log(state, 'edit', `Inputs edited: ${changed.join(' · ')}`);
  return { ok: true, changed: true };
}

function fail(state, reason) {
  log(state, 'reject', `Edit rejected: ${reason}`);
  return { ok: false, reason };
}

/** Simulated market move: a revised quote at 1.12 USD/EUR is issued. */
export function simulateFxMove(state, rateText = '1.12') {
  const rate = parseRate(rateText);
  state.inputs = { ...state.inputs, rate };
  issueQuote(state, rate, `FX move · revised quote 1 ${state.pair.from} = ${rateToDecimal(rate)} ${state.pair.to} · fixture rate`);
  return { ok: true };
}

/** Advance the demo clock (UI ticker / tests). Moving the clock back never
 *  revives an expired quote or revoked approval. */
export function guardTick(state, newClock) {
  state.clock = newClock;
  observeExpiry(state);
}

/** Demo control: jump the clock past the quote's demo validity. */
export function expireQuote(state) {
  guardTick(state, state.quote.expiresAt + 1000);
  log(state, 'expire', 'Demo clock advanced past the 2-minute quote validity');
}

/** Issue a fresh quote at the current rate and clock. Never restores an
 *  approval — a fresh explicit approval is still required. */
export function refreshQuote(state) {
  issueQuote(state, state.inputs.rate);
  return { ok: true };
}

export function approve(state) {
  observeExpiry(state);
  const plan = computePlan(state);
  const blocked = (reason) => {
    log(state, 'blocked', `Approval blocked: ${reason}`);
    return { ok: false, reason };
  };
  if (plan.error) return blocked(`cannot approve: ${plan.error}`);
  if (plan.expired) return blocked('quote expired — refresh the quote before approving');
  if (!plan.withinBudget) {
    return blocked('projected debit exceeds budget — approval cannot override insufficient budget');
  }
  approvalSeq += 1;
  state.approval = {
    id: `A-${state.epoch}-${approvalSeq}`,
    epoch: state.epoch,
    fingerprint: plan.fingerprint,
    approvedAt: state.clock,
    revoked: false,
    snapshot: {
      invoice: moneyToJSON(state.inputs.invoice),
      pair: { ...state.pair },
      rate: rateToJSON(state.inputs.rate),
      rateDecimal: rateToDecimal(state.inputs.rate),
      fee: moneyToJSON(state.inputs.fee),
      budget: moneyToJSON(state.inputs.budget),
      debit: moneyToJSON(plan.debit),
      quoteId: state.quote.id,
      quoteIssuedAt: state.quote.issuedAt,
      quoteExpiresAt: state.quote.expiresAt,
      validityKind: 'demo',
      policyRevision: state.policyRevision,
    },
  };
  log(state, 'approve', `Approved snapshot ${state.approval.id} · projected debit ${plan.debit.currency} ${plan.debit.minor.toString()} minor · quote ${state.quote.id}`);
  return { ok: true, approval: state.approval };
}

/**
 * Commit the approved snapshot to the sandbox ledger. Engine-enforced —
 * a caller cannot bypass staleness, expiry, budget or replay rules by
 * invoking this directly with a friendly UI.
 */
export function commit(state, commandId) {
  observeExpiry(state);
  if (typeof commandId !== 'string' || commandId === '') {
    return { ok: false, reason: 'commit requires a command id' };
  }
  if (state.processedCommands[commandId]) {
    const existing = state.ledger.find((r) => r.id === state.processedCommands[commandId]);
    return { ok: true, replay: true, record: existing };
  }
  const plan = computePlan(state);
  const a = state.approval;
  if (!a) return failCommit(state, commandId, 'no approval — approve the displayed snapshot first');
  if (a.epoch !== state.epoch) return failCommit(state, commandId, 'approval belongs to an earlier sandbox epoch');
  if (a.revoked) return failCommit(state, commandId, `approval ${a.id} was revoked — fresh approval required`);
  if (a.fingerprint !== plan.fingerprint) return failCommit(state, commandId, 'snapshot changed since approval — fresh approval required');
  if (plan.expired) return failCommit(state, commandId, 'quote expired — refresh the quote and re-approve');
  if (!plan.withinBudget) return failCommit(state, commandId, 'projected debit exceeds budget — commit blocked');
  if (state.committedApprovals[a.id]) {
    return failCommit(state, commandId, `a ledger debit already exists for approval ${a.id}`);
  }
  ledgerSeq += 1;
  const record = {
    id: `D-${state.epoch}-${ledgerSeq}`,
    commandId,
    approvalId: a.id,
    epoch: state.epoch,
    at: state.clock,
    kind: 'projected-debit-commit',
    debit: moneyToJSON(plan.debit),
    invoice: moneyToJSON(state.inputs.invoice),
    pair: { ...state.pair },
    rate: rateToJSON(state.inputs.rate),
    rateDecimal: rateToDecimal(state.inputs.rate),
    fee: moneyToJSON(state.inputs.fee),
    budget: moneyToJSON(state.inputs.budget),
    quoteId: state.quote.id,
    quoteExpiresAt: state.quote.expiresAt,
    validityKind: 'demo',
    policyRevision: state.policyRevision,
  };
  state.ledger.push(record);
  state.processedCommands[commandId] = record.id;
  state.committedApprovals[a.id] = record.id;
  log(state, 'commit', `Committed ${record.id} · debit ${record.debit.currency} ${record.debit.minor} minor · approval ${a.id}`);
  return { ok: true, replay: false, record };
}

function failCommit(state, commandId, reason) {
  log(state, 'blocked', `Commit blocked (${commandId}): ${reason}`);
  return { ok: false, reason };
}

export function resetGuard(state) {
  const fresh = createGuardState({ clock: DEMO_CLOCK_START, epoch: state.epoch + 1 });
  log(fresh, 'reset', `Sandbox reset · new epoch ${fresh.epoch}`);
  return fresh;
}

/** Honest structured audit export for the FX Guard scenario. */
export function exportGuardAudit(state) {
  const plan = computePlan(state);
  return {
    scenario: 'fx-guard',
    generatedAt: state.clock,
    epoch: state.epoch,
    mode: 'browser sandbox — single tab, no shared budget, no payments',
    disclaimers: [
      'Illustrative fixture quote, not a Ramp quote or rate lock.',
      'Two-minute quote validity is a demo rule, not a provider promise.',
      'Projected exposure difference is not realized savings.',
    ],
    inputs: {
      invoice: moneyToJSON(state.inputs.invoice),
      invoiceLiteral: GUARD_FIXTURE.invoiceLiteral,
      pair: { ...state.pair },
      rate: rateToJSON(state.inputs.rate),
      rateDecimal: rateToDecimal(state.inputs.rate),
      rateDirection: `1 ${state.pair.from} = ${rateToDecimal(state.inputs.rate)} ${state.pair.to}`,
      fee: moneyToJSON(state.inputs.fee),
      budget: moneyToJSON(state.inputs.budget),
      policyRevision: state.policyRevision,
    },
    quote: {
      id: state.quote.id,
      issuedAt: state.quote.issuedAt,
      expiresAt: state.quote.expiresAt,
      validityMs: state.quote.validityMs,
      validityKind: 'demo',
      expired: plan.expired,
    },
    computed: {
      convertedInvoice: plan.converted ? moneyToJSON(plan.converted) : null,
      projectedDebit: plan.debit ? moneyToJSON(plan.debit) : null,
      headroomMinorSigned: plan.headroomMinor != null ? plan.headroomMinor.toString() : null,
      withinBudget: plan.withinBudget,
      error: plan.error,
    },
    approval: state.approval
      ? {
          id: state.approval.id,
          status: plan.approvalStatus,
          usable: plan.approvalUsable,
          revoked: state.approval.revoked,
          approvedAt: state.approval.approvedAt,
          snapshot: state.approval.snapshot,
        }
      : null,
    ledger: state.ledger.map((r) => ({ ...r })),
    decisions: state.events.map((e) => ({ at: e.at, kind: e.kind, text: e.text })),
  };
}
