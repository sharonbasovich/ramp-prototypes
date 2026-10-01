// shared/engine.mjs — Budget Brawl business rules.
//
// One implementation drives BOTH backends:
//   - server/sqlstore.mjs  (node:sqlite, BEGIN IMMEDIATE transactions)
//   - shared/memstore.mjs  (single-tab browser sandbox)
// Every mutation runs inside store.transact(...) so the wallet invariant
//   spentMinor + heldMinor <= budgetMinor
// is checked and written atomically against concurrent requests.
//
// Request lifecycle:
//   placeRequest  ->  reserved             (amount <= threshold, funds held)
//                ->  awaiting_approval     (amount  > threshold; fundsHeld
//                                            records whether funds fit now)
//                ->  denied                (not_permitted | insufficient_funds)
//   approve:      awaiting_approval -> reserved           (funds held or fits)
//                                 -> awaiting_funds       (approved, no room)
//   reject:       awaiting_approval/awaiting_funds -> denied(rejected)
//   commit:       reserved -> committed (writes purchase; quote + price recheck)
//   cancel:       held/pending -> cancelled (funds released exactly once)
//   expired:      quote past expiry releases any hold (lazy sweep + on touch)
// Terminal states are idempotent: replaying an op returns the stored result.

export const TERMINAL_STATUSES = new Set(['committed', 'cancelled', 'denied', 'expired']);
const ACTIVE_HOLD_STATUSES = new Set(['reserved', 'awaiting_approval']);
const MAX_AMOUNT_MINOR = 1_000_000_00;

function ok(result) {
  return { ok: true, result };
}

function fail(status, code, detail) {
  return { ok: false, status, code, detail };
}

function cents(minor) {
  return `$${(minor / 100).toFixed(2)}`;
}

export function totals(store) {
  const w = store.getWallet();
  const spentMinor = store.sumSpent();
  const heldMinor = store.sumHeld();
  return {
    budgetMinor: w.budgetMinor,
    spentMinor,
    reservedMinor: heldMinor,
    availableMinor: w.budgetMinor - spentMinor - heldMinor,
  };
}

function available(store) {
  const t = totals(store);
  return t.availableMinor;
}

function itemName(store, req) {
  return store.getItem(req.itemId)?.name ?? req.itemId;
}

/** Public result object for a stored request row. */
export function resultFor(store, req, replayed) {
  const w = store.getWallet();
  return {
    requestId: req.requestId,
    agentId: req.agentId,
    itemId: req.itemId,
    itemName: itemName(store, req),
    qty: req.qty,
    amountMinor: req.amountMinor,
    claimedPriceMinor: req.claimedPriceMinor,
    priceOverridden: !!req.priceOverridden,
    approvalRequired: req.amountMinor > w.approvalThresholdMinor,
    status: req.status,
    reason: req.reason ?? null,
    fundsHeld: !!req.fundsHeld,
    purchaseId: req.purchaseId ?? null,
    quoteExpiresAt: req.quoteExpiresAt,
    detail: req.detail,
    replayed: !!replayed,
    totals: totals(store),
  };
}

function finish(store, req, patch, detail) {
  const next = { ...patch, detail, updatedAt: Date.now() };
  store.updateRequest(req.requestId, next);
  store.addEvent({
    kind: 'request',
    requestId: req.requestId,
    agentId: req.agentId,
    itemId: req.itemId,
    amountMinor: req.amountMinor,
    status: next.status ?? req.status,
    detail,
  });
  return resultFor(store, { ...req, ...next }, false);
}

/** Release a held reservation exactly once (no-op if nothing held). */
function release(store, req) {
  if (req.fundsHeld) {
    store.updateRequest(req.requestId, { fundsHeld: 0 });
    req = { ...req, fundsHeld: 0 };
  }
  return req;
}

/**
 * Insert the request row once and return its result. Validation errors throw
 * via fail() BEFORE any row is written so bad input never touches the ledger.
 */
export function placeRequest(store, input, now) {
  return store.transact(() => {
    const requestId = String(input?.requestId ?? '').trim();
    if (requestId && requestId.length <= 80) {
      const prior = store.getRequest(requestId);
      if (prior) return ok(resultFor(store, prior, true));
    }
    if (!requestId || requestId.length > 80) {
      return fail(400, 'invalid_request_id', 'requestId must be a non-empty string (<=80 chars)');
    }
    const agentId = String(input?.agentId ?? '').trim();
    const agent = store.getAgent(agentId);
    if (!agent) return fail(400, 'unknown_agent', `unknown agent '${agentId}'`);
    const itemId = String(input?.itemId ?? '').trim();
    const item = store.getItem(itemId);
    if (!item) return fail(400, 'unknown_item', `unknown catalog item '${itemId}'`);
    const qty = input?.qty;
    if (typeof qty !== 'number' || !Number.isInteger(qty) || qty < 1 || qty > 999) {
      return fail(400, 'invalid_qty', 'qty must be an integer 1..999');
    }
    const claimedPriceMinor = input?.claimedPriceMinor;
    if (claimedPriceMinor !== undefined && claimedPriceMinor !== null) {
      if (!Number.isInteger(claimedPriceMinor) || claimedPriceMinor < 0) {
        return fail(400, 'invalid_price', 'claimedPriceMinor must be a non-negative integer');
      }
    }
    const wallet = store.getWallet();
    // Catalog is authoritative: the server computes the amount; an agent's
    // claimed price is recorded but never used.
    const amountMinor = item.priceMinor * qty;
    if (amountMinor > MAX_AMOUNT_MINOR) {
      return fail(400, 'amount_too_large', `amount ${amountMinor} exceeds limit`);
    }
    const priceOverridden =
      claimedPriceMinor !== undefined && claimedPriceMinor !== null && claimedPriceMinor !== item.priceMinor;
    const permitted = store.listPermissions(agentId).includes(itemId);
    const quoteExpiresAt = now + wallet.quoteTtlMs;
    const base = {
      requestId,
      agentId,
      itemId,
      qty,
      amountMinor,
      quotedPriceMinor: item.priceMinor,
      quoteExpiresAt,
      claimedPriceMinor: claimedPriceMinor ?? null,
      priceOverridden: priceOverridden ? 1 : 0,
      fundsHeld: 0,
      purchaseId: null,
      createdAt: now,
      updatedAt: now,
    };
    const overrideNote = priceOverridden
      ? ` Claimed price ${cents(claimedPriceMinor)} ignored — catalog price ${cents(item.priceMinor)} is authoritative.`
      : '';

    if (!permitted) {
      const detail =
        `${agent.name} is not permitted to request '${item.name}'. ` +
        `Denied for permission scope, not for amount.${overrideNote}`;
      store.insertRequest({ ...base, status: 'denied', reason: 'not_permitted', detail });
      store.addEvent({ kind: 'request', requestId, agentId, itemId, amountMinor, status: 'denied', detail });
      return ok(resultFor(store, { ...base, status: 'denied', reason: 'not_permitted', detail }, false));
    }

    const avail = available(store);
    const needsApproval = amountMinor > wallet.approvalThresholdMinor;

    if (!needsApproval) {
      if (avail >= amountMinor) {
        const detail = `Reserved ${cents(amountMinor)} from the shared budget. Commit to spend or cancel to release.${overrideNote}`;
        store.insertRequest({ ...base, status: 'reserved', reason: null, fundsHeld: 1, detail });
        store.addEvent({ kind: 'request', requestId, agentId, itemId, amountMinor, status: 'reserved', detail });
        return ok(resultFor(store, { ...base, status: 'reserved', fundsHeld: 1, detail }, false));
      }
      const detail = `Only ${cents(avail)} available — cannot reserve ${cents(amountMinor)}.${overrideNote}`;
      store.insertRequest({ ...base, status: 'denied', reason: 'insufficient_funds', detail });
      store.addEvent({ kind: 'request', requestId, agentId, itemId, amountMinor, status: 'denied', detail });
      return ok(resultFor(store, { ...base, status: 'denied', reason: 'insufficient_funds', detail }, false));
    }

    // Above the approval threshold -> pending approval, never auto-denied.
    const fits = avail >= amountMinor;
    const detail = fits
      ? `${cents(amountMinor)} is above the ${cents(wallet.approvalThresholdMinor)} approval threshold. Funds held; awaiting approval.${overrideNote}`
      : `${cents(amountMinor)} is above the ${cents(wallet.approvalThresholdMinor)} approval threshold and only ${cents(avail)} is available. Pending approval; no funds held.${overrideNote}`;
    const row = {
      ...base,
      status: 'awaiting_approval',
      reason: 'above_threshold',
      fundsHeld: fits ? 1 : 0,
      detail,
    };
    store.insertRequest(row);
    store.addEvent({ kind: 'request', requestId, agentId, itemId, amountMinor, status: 'awaiting_approval', detail });
    return ok(resultFor(store, row, false));
  });
}

function expireIfStale(store, req, now) {
  if (req.quoteExpiresAt !== null && now > req.quoteExpiresAt && !TERMINAL_STATUSES.has(req.status)) {
    req = release(store, req);
    return finish(store, req, { status: 'expired', reason: 'quote_expired' },
      `Quote expired; reservation released. ${req.itemId} must be re-requested at the current catalog price.`);
  }
  return null;
}

export function approveRequest(store, requestId, now) {
  return store.transact(() => {
    let req = store.getRequest(requestId);
    if (!req) return fail(404, 'not_found', `no request '${requestId}'`);
    if (TERMINAL_STATUSES.has(req.status)) return ok(resultFor(store, req, true));
    const expired = expireIfStale(store, req, now);
    if (expired) return ok(expired);
    if (req.status === 'reserved') {
      return ok(resultFor(store, req, true)); // no approval needed
    }
    if (req.status !== 'awaiting_approval' && req.status !== 'awaiting_funds') {
      return fail(409, 'invalid_state', `cannot approve a request in state '${req.status}'`);
    }
    if (!store.listPermissions(req.agentId).includes(req.itemId)) {
      req = release(store, req);
      return ok(finish(store, req, { status: 'denied', reason: 'not_permitted' },
        'Permission scope no longer covers this item. Denied for permission, not amount.'));
    }
    if (req.fundsHeld) {
      return ok(finish(store, req, { status: 'reserved', reason: null },
        `Approved. ${cents(req.amountMinor)} already held — ready to commit.`));
    }
    const avail = available(store);
    if (avail >= req.amountMinor) {
      return ok(finish(store, req, { status: 'reserved', reason: null, fundsHeld: 1 },
        `Approved and ${cents(req.amountMinor)} reserved — ready to commit.`));
    }
    return ok(finish(store, req, { status: 'awaiting_funds', reason: 'awaiting_funds' },
      `Approved, but only ${cents(avail)} is available — waiting for funds. Nothing is held.`));
  });
}

export function rejectRequest(store, requestId, now) {
  return store.transact(() => {
    let req = store.getRequest(requestId);
    if (!req) return fail(404, 'not_found', `no request '${requestId}'`);
    if (TERMINAL_STATUSES.has(req.status)) return ok(resultFor(store, req, true));
    if (req.status !== 'awaiting_approval' && req.status !== 'awaiting_funds') {
      return fail(409, 'invalid_state', `cannot reject a request in state '${req.status}'`);
    }
    const hadFunds = !!req.fundsHeld;
    req = release(store, req);
    return ok(finish(store, req, { status: 'denied', reason: 'rejected' },
      hadFunds
        ? `Rejected by reviewer — held ${cents(req.amountMinor)} released back to the budget.`
        : 'Rejected by reviewer. No funds were held.'));
  });
}

export function commitRequest(store, requestId, now) {
  return store.transact(() => {
    let req = store.getRequest(requestId);
    if (!req) return fail(404, 'not_found', `no request '${requestId}'`);
    if (req.status === 'committed') return ok(resultFor(store, req, true));
    if (req.status !== 'reserved') {
      if (TERMINAL_STATUSES.has(req.status)) {
        return fail(409, 'invalid_state', `cannot commit a request in state '${req.status}'`);
      }
      return fail(409, 'invalid_state', `request '${requestId}' is not holding a reservation (state '${req.status}')`);
    }
    const expired = expireIfStale(store, req, now);
    if (expired) return ok(expired);
    const item = store.getItem(req.itemId);
    if (!item || item.priceMinor !== req.quotedPriceMinor) {
      req = release(store, req);
      const nowPrice = item ? cents(item.priceMinor) : 'removed';
      return ok(finish(store, req, { status: 'expired', reason: 'quote_stale' },
        `Catalog price changed (${cents(req.quotedPriceMinor)} -> ${nowPrice}) since the quote. Reservation released; re-request at the current price.`));
    }
    const purchaseId = `PUR-${req.requestId}`;
    store.insertPurchase({
      purchaseId,
      requestId: req.requestId,
      agentId: req.agentId,
      itemId: req.itemId,
      qty: req.qty,
      amountMinor: req.amountMinor,
      createdAt: now,
    });
    return ok(finish(store, req, { status: 'committed', reason: null, fundsHeld: 0, purchaseId },
      `Committed ${cents(req.amountMinor)} — purchase ${purchaseId} recorded in the ledger.`));
  });
}

export function cancelRequest(store, requestId, now) {
  return store.transact(() => {
    let req = store.getRequest(requestId);
    if (!req) return fail(404, 'not_found', `no request '${requestId}'`);
    if (req.status === 'cancelled') return ok(resultFor(store, req, true));
    if (req.status === 'committed') {
      return fail(409, 'invalid_state', 'already committed — a completed purchase cannot be cancelled');
    }
    if (req.status === 'denied' || req.status === 'expired') {
      return fail(409, 'invalid_state', `nothing to cancel — request is '${req.status}'`);
    }
    const hadFunds = !!req.fundsHeld;
    req = release(store, req);
    return ok(finish(store, req, { status: 'cancelled', reason: 'cancelled' },
      hadFunds
        ? `Cancelled — ${cents(req.amountMinor)} returned to the budget exactly once.`
        : 'Pending request withdrawn. No funds were held.'));
  });
}

/**
 * Lazily expire non-terminal requests whose quote has lapsed. Runs inside a
 * transaction on every state read so balances stay conserved.
 */
export function sweepExpired(store, now) {
  return store.transact(() => {
    for (const req of store.listRequests()) {
      if (TERMINAL_STATUSES.has(req.status)) continue;
      if (req.quoteExpiresAt !== null && now > req.quoteExpiresAt) {
        const r = release(store, req);
        finish(store, r, { status: 'expired', reason: 'quote_expired' },
          'Quote expired; any held funds were released. Re-request at the current catalog price.');
      }
    }
  });
}

export function configure(store, cfg) {
  return store.transact(() => {
    const w = store.getWallet();
    const next = { ...w };
    if (cfg?.budgetMinor !== undefined) {
      if (!Number.isInteger(cfg.budgetMinor) || cfg.budgetMinor < 0) {
        return fail(400, 'invalid_budget', 'budgetMinor must be a non-negative integer');
      }
      next.budgetMinor = cfg.budgetMinor;
    }
    if (cfg?.approvalThresholdMinor !== undefined) {
      if (!Number.isInteger(cfg.approvalThresholdMinor) || cfg.approvalThresholdMinor < 0) {
        return fail(400, 'invalid_threshold', 'approvalThresholdMinor must be a non-negative integer');
      }
      next.approvalThresholdMinor = cfg.approvalThresholdMinor;
    }
    if (cfg?.quoteTtlMs !== undefined) {
      if (!Number.isInteger(cfg.quoteTtlMs) || cfg.quoteTtlMs < 500 || cfg.quoteTtlMs > 3_600_000) {
        return fail(400, 'invalid_ttl', 'quoteTtlMs must be 500..3600000');
      }
      next.quoteTtlMs = cfg.quoteTtlMs;
    }
    const t = totals(store);
    const committed = t.spentMinor + t.reservedMinor;
    if (next.budgetMinor < committed) {
      return fail(409, 'budget_below_commitments',
        `budget ${cents(next.budgetMinor)} is below spent + held ${cents(committed)}`);
    }
    store.setWallet({
      budgetMinor: next.budgetMinor,
      approvalThresholdMinor: next.approvalThresholdMinor,
      quoteTtlMs: next.quoteTtlMs,
    });
    store.addEvent({ kind: 'config', detail: `Config updated: budget ${cents(next.budgetMinor)}, approval threshold ${cents(next.approvalThresholdMinor)}, quote TTL ${next.quoteTtlMs}ms.` });
    return ok({ wallet: next, totals: totals(store) });
  });
}

export function setCatalogPrice(store, itemId, priceMinor) {
  return store.transact(() => {
    if (!Number.isInteger(priceMinor) || priceMinor < 0 || priceMinor > MAX_AMOUNT_MINOR) {
      return fail(400, 'invalid_price', 'priceMinor must be a non-negative integer');
    }
    const item = store.getItem(itemId);
    if (!item) return fail(404, 'unknown_item', `unknown catalog item '${itemId}'`);
    const prev = item.priceMinor;
    store.setItemPrice(itemId, priceMinor);
    store.addEvent({ kind: 'price_change', itemId, amountMinor: priceMinor,
      detail: `Sample catalog price for '${item.name}' changed ${cents(prev)} -> ${cents(priceMinor)}. Open quotes keep their quoted price.` });
    return ok({ itemId, priceMinor });
  });
}

export function reset(store, seed) {
  store.resetAll(seed);
  return snapshot(store);
}

export function snapshot(store) {
  const w = store.getWallet();
  const requests = store.listRequests();
  const purchases = store.listPurchases();
  const events = store.listEvents();
  const t = totals(store);
  const prevented = requests.filter(
    (r) =>
      (r.status === 'denied' && r.reason === 'insufficient_funds') ||
      (r.status === 'awaiting_approval' && !r.fundsHeld) ||
      r.status === 'awaiting_funds'
  );
  return {
    epoch: store.epoch(),
    wallet: {
      budgetMinor: w.budgetMinor,
      approvalThresholdMinor: w.approvalThresholdMinor,
      quoteTtlMs: w.quoteTtlMs,
    },
    totals: t,
    invariant: {
      rule: 'spent + reserved <= budget',
      holds: t.spentMinor + t.reservedMinor <= t.budgetMinor,
    },
    catalog: store.listCatalog(),
    agents: store.listAgents().map((a) => ({
      ...a,
      permissions: store.listPermissions(a.agentId),
    })),
    requests: requests.map((r) => ({
      requestId: r.requestId,
      agentId: r.agentId,
      itemId: r.itemId,
      itemName: itemName(store, r),
      qty: r.qty,
      amountMinor: r.amountMinor,
      status: r.status,
      reason: r.reason ?? null,
      fundsHeld: !!r.fundsHeld,
      purchaseId: r.purchaseId ?? null,
      detail: r.detail,
      quoteExpiresAt: r.quoteExpiresAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
    purchases,
    events,
    impact: {
      preventedCount: prevented.length,
      preventedAmountMinor: prevented.reduce((s, r) => s + r.amountMinor, 0),
      note: 'Requests blocked from reserving over budget. Sample amounts — not realized savings.',
    },
  };
}
