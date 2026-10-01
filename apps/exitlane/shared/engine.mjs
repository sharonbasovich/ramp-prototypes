// shared/engine.mjs — ExitLane business rules.
//
// One implementation drives BOTH backends:
//   - server/sqlstore.mjs  (node:sqlite, BEGIN IMMEDIATE transactions)
//   - shared/memstore.mjs  (single-tab browser sandbox)
// Every mutation runs inside store.transact(...).
//
// The engine's "now" is the labeled DEMONSTRATION CLOCK stored in the store
// (store.getClockMs()), never the wall clock — advancing it across a policy
// cutoff deterministically re-tiers every assessment.
//
// Cancellation request lifecycle (one per booking per epoch):
//   preparePacket -> prepared        (executable assessment fingerprinted)
//                  -> excluded        (already_canceled | manual_review | invalid)
//   approvePacket -> approved        (approvedFingerprint recorded)
//   execute       -> executed        (sandbox provider confirmed, SIMULATED)
//                  -> failed         (scripted provider failure; retryable)
//                  -> stale          (assessment changed since approval —
//                                     clock moved, booking/policy changed)
//   stale -> preparePacket -> prepared -> approved -> execute
// Executed is terminal for the request: replaying returns the stored
// outcome — the same idempotency key can never cancel twice.

export const MAX_MINOR = 100_000_000_00;
export const ASSESS_VERSION = 1;

function ok(result) {
  return { ok: true, result };
}

function fail(status, code, detail) {
  return { ok: false, status, code, detail };
}

function isInt(v) {
  return typeof v === 'number' && Number.isInteger(v);
}

function toMs(iso) {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/* ------------------------------------------------------------------ */
/* Assessment — deterministic tier evaluation                          */
/* ------------------------------------------------------------------ */

/**
 * Does a tier apply at instant nowMs?
 *   'before'      -> nowMs <  cutoffInstant   (exact cutoff does NOT apply)
 *   'at_or_after' -> nowMs >= cutoffInstant
 *   'always'      -> fallback, no instant required
 */
function tierApplies(tier, nowMs) {
  const boundary = tier?.boundary;
  if (boundary === 'always') return true;
  const cutoff = toMs(tier?.cutoffInstant);
  if (cutoff === null) return false; // unusable cutoff -> tier cannot apply
  if (boundary === 'before') return nowMs < cutoff;
  if (boundary === 'at_or_after') return nowMs >= cutoff;
  return false; // unknown operator -> never silently applies
}

function feeFor(tier, committedMinor) {
  const fee = tier?.fee;
  if (!fee) return null;
  if (fee.kind === 'fixed' && isInt(fee.amountMinor) && fee.amountMinor >= 0) {
    return fee.amountMinor;
  }
  if (fee.kind === 'percent' && isInt(fee.percent) && fee.percent >= 0 && fee.percent <= 100) {
    return Math.round((committedMinor * fee.percent) / 100);
  }
  return null;
}

/**
 * Evaluate a booking against its policy at nowMs.
 * Returns an assessment object; `status` is one of:
 *   'assessed'      -> a single tier matched, figures computed
 *   'manual_review' -> policy absent / unsupported / contradictory / no tier
 *   'invalid'       -> booking financials are inconsistent
 * Money rules (spec): require C = P + U. refund = max(P - F, 0);
 * extra payment = max(F - P, 0); net benefit = refund + U - extra = C - F.
 */
export function assess(booking, policy, nowMs) {
  const base = { status: 'assessed', reason: null, uncertainty: null };
  const c = booking.committedMinor;
  const p = booking.paidMinor;
  const u = booking.unpaidMinor;
  for (const [name, v] of [
    ['committedMinor', c],
    ['paidMinor', p],
    ['unpaidMinor', u],
  ]) {
    if (!isInt(v) || v < 0 || v > MAX_MINOR) {
      return {
        ...base,
        status: 'invalid',
        reason: `${name} must be a non-negative integer minor amount`,
        detail: `${booking.bookingId}: ${name} is ${JSON.stringify(v)} — the assessment is rejected rather than guessing a balancing amount.`,
      };
    }
  }
  if (booking.currency !== 'USD') {
    return {
      ...base,
      status: 'invalid',
      reason: `unsupported currency '${booking.currency}'`,
      detail: `${booking.bookingId}: amounts are ${booking.currency}; this sandbox compares integer USD cents only and never converts currencies.`,
    };
  }
  if (c !== p + u) {
    return {
      ...base,
      status: 'invalid',
      reason: `committed ${c} != paid ${p} + unpaid ${u}`,
      detail: `${booking.bookingId}: committed total ${c} does not equal paid ${p} + unpaid ${u}. Fix the booking; no refund is estimated.`,
    };
  }
  if (!policy) {
    return {
      ...base,
      status: 'manual_review',
      reason: 'no policy on file',
      detail: `${booking.bookingId}: no cancellation policy is linked. A person must review the provider terms — no refund is estimated.`,
    };
  }
  if (policy.supported === false) {
    return {
      ...base,
      status: 'manual_review',
      reason: 'policy terms are not machine-readable',
      detail: `${booking.bookingId}: policy ${policy.policyId} ${policy.version} is marked unsupported ("${policy.summary}"). Manual review required — no refund is estimated.`,
    };
  }
  const tiers = Array.isArray(policy.tiers) ? policy.tiers : [];
  const matches = tiers.filter((t) => tierApplies(t, nowMs));
  if (matches.length === 0) {
    return {
      ...base,
      status: 'manual_review',
      reason: 'no policy tier applies at this instant',
      detail: `${booking.bookingId}: no tier of ${policy.policyId} ${policy.version} covers the current time. Manual review required — the engine never invents a refund.`,
    };
  }
  if (matches.length > 1) {
    return {
      ...base,
      status: 'manual_review',
      reason: 'contradictory tiers match this instant',
      detail: `${booking.bookingId}: ${matches.length} tiers of ${policy.policyId} ${policy.version} apply simultaneously — the policy is contradictory. Manual review required.`,
    };
  }
  const tier = matches[0];
  const feeMinor = feeFor(tier, c);
  if (feeMinor === null) {
    return {
      ...base,
      status: 'manual_review',
      reason: 'tier fee is not a supported structure',
      detail: `${booking.bookingId}: tier '${tier.tierId}' has an unreadable fee. Manual review required.`,
    };
  }
  const refundMinor = Math.max(p - feeMinor, 0);
  const extraPaymentMinor = Math.max(feeMinor - p, 0);
  const futureChargesAvoidedMinor = u;
  const netBenefitMinor = refundMinor + u - extraPaymentMinor; // == c - feeMinor
  return {
    ...base,
    tierId: tier.tierId,
    tierLabel: tier.label ?? tier.tierId,
    boundary: tier.boundary,
    cutoffInstant: tier.cutoffInstant ?? null,
    feeMinor,
    refundMinor,
    extraPaymentMinor,
    futureChargesAvoidedMinor,
    netBenefitMinor, // negative values are preserved, never clamped
    policyId: policy.policyId,
    policyVersion: policy.version,
    policySummary: policy.summary,
    sourceRef: policy.sourceRef,
    detail:
      feeMinor === 0
        ? `Tier '${tier.tierId}': no cancellation fee — full ${p}-cent payment is estimated refundable.`
        : `Tier '${tier.tierId}': fee ${feeMinor} cents -> refund ${refundMinor}, extra due ${extraPaymentMinor}, future charges avoided ${u}, net ${netBenefitMinor}.`,
  };
}

/**
 * Fingerprint binding an approval to exactly what was reviewed: booking +
 * policy versions and every assessed figure. Any change — clock crossing a
 * cutoff, edited amounts, new policy version — produces a different
 * fingerprint and invalidates the approval.
 */
export function fingerprint(booking, policy, assessment) {
  return [
    ASSESS_VERSION,
    booking.bookingId,
    booking.version,
    booking.committedMinor,
    booking.paidMinor,
    booking.unpaidMinor,
    policy?.policyId ?? 'none',
    policy?.version ?? 'none',
    assessment.status,
    assessment.tierId ?? '-',
    assessment.feeMinor ?? '-',
    assessment.refundMinor ?? '-',
    assessment.extraPaymentMinor ?? '-',
    assessment.futureChargesAvoidedMinor ?? '-',
    assessment.netBenefitMinor ?? '-',
  ].join('|');
}

function assessBooking(store, booking, nowMs) {
  const policy = booking.policyId ? store.getPolicy(booking.policyId) : null;
  const a = assess(booking, policy, nowMs);
  a.fingerprint = fingerprint(booking, policy, a);
  return a;
}

function assessAll(store, nowMs) {
  const out = new Map();
  for (const b of store.listBookings()) out.set(b.bookingId, assessBooking(store, b, nowMs));
  return out;
}

/* ------------------------------------------------------------------ */
/* Clock                                                               */
/* ------------------------------------------------------------------ */

export function getClockMs(store) {
  return store.getClockMs();
}

export function setClock(store, instant) {
  return store.transact(() => {
    const ms = typeof instant === 'number' ? instant : toMs(instant);
    if (ms === null || !Number.isFinite(ms)) {
      return fail(400, 'invalid_clock', 'clock must be a valid ISO instant or epoch ms');
    }
    const prev = store.getClockMs();
    store.setClockMs(ms);
    const now = ms;
    // Approvals are bound to the assessed fingerprint. Moving the clock
    // across a cutoff re-tiers an assessment and must surface the stale
    // approval immediately — before any provider is touched.
    const stale = [];
    for (const req of store.listRequests()) {
      if (req.status !== 'approved') continue;
      const booking = store.getBooking(req.bookingId);
      if (!booking) continue;
      const a = assessBooking(store, booking, now);
      if (a.fingerprint !== req.approvedFingerprint) {
        store.updateRequest(req.requestId, { status: 'stale', staleReason: 'clock_moved' });
        stale.push(req.bookingId);
        store.addEvent({
          kind: 'stale',
          bookingId: req.bookingId,
          detail: `Demo clock moved ${new Date(prev).toISOString()} -> ${new Date(now).toISOString()}; assessment changed — approval for '${req.bookingId}' is stale and cannot execute.`,
        });
      }
    }
    store.addEvent({
      kind: 'clock',
      detail: `Demonstration clock set to ${new Date(now).toISOString()} (was ${new Date(prev).toISOString()}).${stale.length ? ` Stale approvals: ${stale.join(', ')}.` : ''}`,
    });
    return ok({ clockInstant: new Date(now).toISOString(), staleBookings: stale });
  });
}

/* ------------------------------------------------------------------ */
/* Event                                                               */
/* ------------------------------------------------------------------ */

export function cancelEvent(store) {
  return store.transact(() => {
    const ev = store.getEvent();
    if (ev.status === 'canceled') return ok({ event: ev, replayed: true });
    const now = store.getClockMs();
    const next = { ...ev, status: 'canceled', canceledInstant: new Date(now).toISOString() };
    store.setEvent(next);
    store.addEvent({
      kind: 'event_canceled',
      detail: `Event '${ev.name}' marked canceled at ${new Date(now).toISOString()} (demo clock). Linked bookings are NOT touched — each needs its own sandbox cancellation request.`,
    });
    return ok({ event: next, replayed: false });
  });
}

/* ------------------------------------------------------------------ */
/* Packet lifecycle                                                    */
/* ------------------------------------------------------------------ */

function upsertAssessmentRequest(store, booking, a, nowMs) {
  const existing = store.getRequestByBooking(booking.bookingId);
  // Never clobber a request that already has an approval or provider
  // history — stale handling is explicit.
  if (existing && ['approved', 'executed', 'failed'].includes(existing.status)) {
    return { request: existing, changed: false, skipped: true };
  }
  const terminal = booking.status !== 'active';
  let status;
  let reason = null;
  if (terminal) {
    status = 'excluded';
    reason = 'already_canceled';
  } else if (a.status !== 'assessed') {
    status = 'excluded';
    reason = a.status; // 'manual_review' | 'invalid'
  } else {
    status = 'prepared';
  }
  const row = {
    requestId: existing?.requestId ?? `req-${booking.bookingId}`,
    bookingId: booking.bookingId,
    status,
    reason,
    fingerprint: a.fingerprint,
    assessedInstant: new Date(nowMs).toISOString(),
    approvedFingerprint: null,
    approvedInstant: null,
    approvedRefundMinor: null,
    approvedExtraMinor: null,
    approvedAvoidedMinor: null,
    approvedNetMinor: null,
    staleReason: null,
    idempotencyKey: `exitlane|${booking.bookingId}|pkt`,
    updatedAt: nowMs,
  };
  if (existing) {
    store.updateRequest(existing.requestId, row);
  } else {
    store.insertRequest({ ...row, createdAt: nowMs, refundReceivedMinor: null });
  }
  return { request: { ...(existing ?? {}), ...row }, changed: true, skipped: false };
}

export function preparePacket(store) {
  return store.transact(() => {
    const now = store.getClockMs();
    const assessments = assessAll(store, now);
    const results = [];
    for (const booking of store.listBookings()) {
      const a = assessments.get(booking.bookingId);
      const r = upsertAssessmentRequest(store, booking, a, now);
      results.push({ bookingId: booking.bookingId, ...r });
    }
    const prepared = results.filter((r) => r.request.status === 'prepared').length;
    const excluded = results.filter((r) => r.request.status === 'excluded').length;
    store.addEvent({
      kind: 'packet_prepared',
      detail: `Cancellation packet assembled at ${new Date(now).toISOString()} (demo clock): ${prepared} executable, ${excluded} excluded. Nothing has been sent — sandbox only.`,
    });
    return ok({ prepared, excluded, results: results.map((r) => ({ bookingId: r.bookingId, status: r.request.status, reason: r.request.reason })) });
  });
}

export function approvePacket(store) {
  return store.transact(() => {
    const now = store.getClockMs();
    const approved = [];
    const skipped = [];
    for (const req of store.listRequests()) {
      if (req.status !== 'prepared') {
        if (req.status !== 'excluded') skipped.push(req.bookingId);
        continue;
      }
      // Approval binds the fingerprint assessed right now — not a stale one.
      const booking = store.getBooking(req.bookingId);
      const a = assessBooking(store, booking, now);
      store.updateRequest(req.requestId, {
        status: 'approved',
        fingerprint: a.fingerprint,
        approvedFingerprint: a.fingerprint,
        approvedRefundMinor: a.refundMinor ?? null,
        approvedExtraMinor: a.extraPaymentMinor ?? null,
        approvedAvoidedMinor: a.futureChargesAvoidedMinor ?? null,
        approvedNetMinor: a.netBenefitMinor ?? null,
        assessedInstant: new Date(now).toISOString(),
        approvedInstant: new Date(now).toISOString(),
      });
      approved.push(req.bookingId);
    }
    store.addEvent({
      kind: 'approved',
      detail: approved.length
        ? `Cancellation packet approved at ${new Date(now).toISOString()} (demo clock): ${approved.join(', ')}. Approvals bind the current booking + policy versions and assessed figures.`
        : 'No executable requests to approve.',
    });
    return ok({ approved, skipped });
  });
}

function scriptedOutcome(store, booking, attemptIndex) {
  const providers = store.getProviders();
  const p = providers?.[booking.providerId];
  const script = p?.script?.length ? p.script : ['confirmed'];
  const entry = script[Math.min(attemptIndex, script.length - 1)];
  if (entry.startsWith('fail:')) {
    const [, code, ...rest] = entry.split(':');
    return { outcome: 'failed', code, detail: rest.join(':') || 'simulated provider failure', simulated: true };
  }
  return {
    outcome: 'confirmed',
    code: '200',
    ref: `SIM-${booking.confirmationRef}-CX${attemptIndex + 1}`,
    detail: `Simulated cancellation confirmed by ${p?.displayName ?? booking.provider} (sandbox provider — no real request was sent).`,
    simulated: true,
  };
}

/**
 * Execute one request against its scripted sandbox provider.
 * - 'approved'   -> re-assess now; fingerprint mismatch => 'stale', no call.
 * - 'executed'   -> idempotent replay of the stored outcome.
 * - 'failed'     -> retry: consumes the next scripted outcome, history kept.
 */
export function executeRequest(store, requestId) {
  return store.transact(() => {
    const req = store.getRequest(requestId);
    if (!req) return fail(404, 'not_found', `no request '${requestId}'`);
    const now = store.getClockMs();
    if (req.status === 'executed') {
      const outcomes = store.listOutcomesForRequest(requestId);
      return ok({ requestId, replayed: true, request: req, outcome: outcomes[outcomes.length - 1] ?? null });
    }
    if (req.status === 'prepared' || req.status === 'excluded') {
      return fail(409, 'invalid_state', `request '${requestId}' is '${req.status}' — it must be approved before execution (or it is not executable)`);
    }
    if (req.status === 'stale') {
      return fail(409, 'stale', `request '${requestId}' is stale — re-prepare and re-approve before executing`);
    }
    const booking = store.getBooking(req.bookingId);
    if (!booking) return fail(404, 'not_found', `booking '${req.bookingId}' missing`);
    if (req.status === 'approved') {
      // Recalculate immediately before execution (spec). Any change —
      // clock, booking, policy — invalidates the approval and no provider
      // is contacted.
      const a = assessBooking(store, booking, now);
      if (a.fingerprint !== req.approvedFingerprint) {
        store.updateRequest(requestId, {
          status: 'stale',
          staleReason: 'assessment_changed',
          fingerprint: a.fingerprint,
        });
        store.addEvent({
          kind: 'stale',
          bookingId: req.bookingId,
          detail: `Approval for '${req.bookingId}' was made against older figures; execution refused before any provider action. Updated assessment is shown for re-review.`,
        });
        return ok({ requestId, replayed: false, request: store.getRequest(requestId), outcome: null, stale: true, assessment: a });
      }
    }
    // 'approved' (fresh) or 'failed' (retry): consume next scripted outcome.
    const attempts = store.listOutcomesForRequest(requestId).length;
    const sim = scriptedOutcome(store, booking, attempts);
    const outcomeRow = {
      requestId,
      bookingId: booking.bookingId,
      providerId: booking.providerId,
      attempt: attempts + 1,
      outcome: sim.outcome,
      code: sim.code,
      ref: sim.ref ?? null,
      detail: sim.detail,
      simulated: true,
      idempotencyKey: req.idempotencyKey,
      recordedInstant: new Date(now).toISOString(),
    };
    store.insertOutcome(outcomeRow);
    if (sim.outcome === 'confirmed') {
      store.updateRequest(requestId, { status: 'executed', fingerprint: req.fingerprint });
      store.updateBooking(booking.bookingId, {
        status: 'cancel_confirmed',
        canceledInstant: new Date(now).toISOString(),
      });
      store.addEvent({
        kind: 'executed',
        bookingId: booking.bookingId,
        detail: `SIMULATED: ${booking.provider} confirmed cancellation (${sim.ref}). Estimated refund due is not received cash.`,
      });
      return ok({ requestId, replayed: false, request: store.getRequest(requestId), outcome: outcomeRow });
    }
    store.updateRequest(requestId, { status: 'failed' });
    store.addEvent({
      kind: 'failed',
      bookingId: booking.bookingId,
      detail: `SIMULATED provider failure for ${booking.provider}: ${sim.code} — ${sim.detail}. Booking is NOT canceled; nothing was counted.`,
    });
    return ok({ requestId, replayed: false, request: store.getRequest(requestId), outcome: outcomeRow });
  });
}

export function executePacket(store) {
  return store.transact(() => {
    const results = [];
    for (const req of store.listRequests()) {
      if (req.status !== 'approved') continue;
      const r = executeRequest(store, req.requestId);
      results.push({ bookingId: req.bookingId, ok: r.ok, status: store.getRequest(req.requestId).status, stale: !!r.result?.stale });
    }
    return ok({ results });
  });
}

/**
 * Mark a SIMULATED refund as received for an executed request. Keeps the
 * three states distinct: confirmed cancellation / refund due / refund
 * received. Idempotent — recording twice counts once.
 */
export function markRefundReceived(store, requestId) {
  return store.transact(() => {
    const req = store.getRequest(requestId);
    if (!req) return fail(404, 'not_found', `no request '${requestId}'`);
    if (req.status !== 'executed') {
      return fail(409, 'invalid_state', `refund receipt requires an executed request (state '${req.status}')`);
    }
    if (req.refundReceivedMinor !== null && req.refundReceivedMinor !== undefined) {
      return ok({ requestId, refundReceivedMinor: req.refundReceivedMinor, replayed: true });
    }
    const booking = store.getBooking(req.bookingId);
    const outcomes = store.listOutcomesForRequest(requestId);
    const confirmedAt = outcomes.find((o) => o.outcome === 'confirmed')?.recordedInstant;
    const amount = req.approvedRefundMinor ?? null;
    store.updateRequest(requestId, { refundReceivedMinor: amount ?? 0 });
    store.addEvent({
      kind: 'received',
      bookingId: req.bookingId,
      detail: `SIMULATED refund receipt recorded for '${req.bookingId}' (confirmed at ${confirmedAt ?? 'n/a'}). Sample amount only.`,
    });
    return ok({ requestId, refundReceivedMinor: amount ?? 0, replayed: false });
  });
}

/* ------------------------------------------------------------------ */
/* Booking edits — invalidate stale approvals                          */
/* ------------------------------------------------------------------ */

export function editBookingAmounts(store, bookingId, patch) {
  return store.transact(() => {
    const booking = store.getBooking(bookingId);
    if (!booking) return fail(404, 'not_found', `no booking '${bookingId}'`);
    const next = {
      committedMinor: patch?.committedMinor ?? booking.committedMinor,
      paidMinor: patch?.paidMinor ?? booking.paidMinor,
      unpaidMinor: patch?.unpaidMinor ?? booking.unpaidMinor,
    };
    for (const [k, v] of Object.entries(next)) {
      if (!isInt(v) || v < 0 || v > MAX_MINOR) {
        return fail(400, 'invalid_amount', `${k} must be an integer 0..${MAX_MINOR}`);
      }
    }
    if (booking.status !== 'active') {
      return fail(409, 'invalid_state', `booking '${bookingId}' is '${booking.status}' — amounts are locked`);
    }
    store.updateBooking(bookingId, { ...next, version: booking.version + 1 });
    // Any approval bound to the previous amounts is now stale.
    const req = store.getRequestByBooking(bookingId);
    if (req && req.status === 'approved') {
      store.updateRequest(req.requestId, { status: 'stale', staleReason: 'booking_changed' });
      store.addEvent({
        kind: 'stale',
        bookingId,
        detail: `Booking '${bookingId}' amounts changed (version ${booking.version} -> ${booking.version + 1}); its approval is stale and cannot execute.`,
      });
    }
    store.addEvent({
      kind: 'edited',
      bookingId,
      detail: `Booking '${bookingId}' amounts updated to committed ${next.committedMinor}, paid ${next.paidMinor}, unpaid ${next.unpaidMinor} (version ${booking.version + 1}).`,
    });
    return ok({ booking: store.getBooking(bookingId) });
  });
}

/* ------------------------------------------------------------------ */
/* Snapshot + export                                                   */
/* ------------------------------------------------------------------ */

function totalsFor(bookings, assessments, requests, outcomes) {
  let estimatedRefundableMinor = 0;
  let estimatedFutureChargesAvoidedMinor = 0;
  let estimatedExtraChargesMinor = 0;
  let netEstimatedBenefitMinor = 0;
  let confirmedRefundsDueMinor = 0;
  let receivedRefundsMinor = 0;
  for (const b of bookings) {
    const a = assessments.get(b.bookingId);
    if (a?.status === 'assessed' && b.status === 'active') {
      estimatedRefundableMinor += a.refundMinor;
      estimatedFutureChargesAvoidedMinor += a.futureChargesAvoidedMinor;
      estimatedExtraChargesMinor += a.extraPaymentMinor;
      netEstimatedBenefitMinor += a.netBenefitMinor;
    }
  }
  for (const req of requests) {
    if (req.status === 'executed' && req.approvedRefundMinor != null) {
      confirmedRefundsDueMinor += req.approvedRefundMinor;
    }
    if (req.refundReceivedMinor != null) {
      receivedRefundsMinor += req.refundReceivedMinor;
    }
  }
  return {
    estimatedRefundableMinor,
    estimatedFutureChargesAvoidedMinor,
    estimatedExtraChargesMinor,
    netEstimatedBenefitMinor,
    confirmedRefundsDueMinor,
    receivedRefundsMinor,
    outcomeCount: outcomes.length,
    note: 'Estimated figures assume the structured policy is the complete remaining obligation. Sandbox confirmations are simulated and are not proof that cash reached an account.',
  };
}

export function snapshot(store) {
  const now = store.getClockMs();
  const event = store.getEvent();
  const bookings = store.listBookings();
  const requests = store.listRequests();
  const outcomes = store.listOutcomes();
  const reqByBooking = new Map(requests.map((r) => [r.bookingId, r]));
  const assessments = assessAll(store, now);
  const rows = bookings.map((b) => {
    const policy = b.policyId ? store.getPolicy(b.policyId) : null;
    const a = assessments.get(b.bookingId);
    const req = reqByBooking.get(b.bookingId) ?? null;
    const bOutcomes = outcomes.filter((o) => o.bookingId === b.bookingId);
    return {
      ...b,
      policy: policy
        ? {
            policyId: policy.policyId,
            version: policy.version,
            supported: policy.supported !== false,
            summary: policy.summary,
            sourceRef: policy.sourceRef,
            checkInInstant: policy.checkInInstant ?? null,
            tiers: policy.tiers,
          }
        : null,
      assessment: a,
      request: req,
      outcomes: bOutcomes,
      approvalStale: !!req && req.status === 'approved' && req.approvedFingerprint !== a.fingerprint,
    };
  });
  const timeline = buildTimeline(event, now);
  return {
    epoch: store.epoch(),
    clock: { instant: new Date(now).toISOString(), tz: event.displayTz },
    event,
    bookings: rows,
    requests,
    outcomes,
    totals: totalsFor(bookings, assessments, requests, outcomes),
    timeline,
    events: store.listEvents(),
  };
}

function buildTimeline(event, nowMs) {
  const day = 24 * 3600 * 1000;
  const booked = toMs(event.bookedInstant);
  const canceled = toMs(event.canceledInstant) ?? nowMs;
  return [
    { key: 'booked', instant: new Date(booked).toISOString(), label: 'Event booked', state: 'done' },
    {
      key: 'canceled',
      instant: new Date(canceled).toISOString(),
      label: event.status === 'canceled' ? 'You canceled' : 'Demo clock',
      state: 'now',
    },
    { key: 'processing', instant: new Date(canceled + 1 * day).toISOString(), label: 'Provider processing', sub: '1–3 business days', state: 'future' },
    { key: 'confirmations', instant: new Date(canceled + 3 * day).toISOString(), label: 'Expected confirmations', state: 'future' },
    { key: 'final', instant: new Date(canceled + 7 * day).toISOString(), label: 'Final refunds (if any)', state: 'future' },
  ];
}

export function exportPacket(store, mode) {
  const snap = snapshot(store);
  const stateOf = (b) => {
    if (b.status === 'cancel_confirmed') return 'confirmed_simulated';
    const r = b.request;
    if (!r) return 'not_in_packet';
    if (r.status === 'excluded') return `excluded_${r.reason}`;
    return r.status; // prepared | approved | stale | failed | executed
  };
  return {
    kind: 'exitlane-cancellation-packet',
    generatedAtInstant: snap.clock.instant,
    demoClock: snap.clock.instant,
    displayTz: snap.clock.tz,
    mode,
    sandboxNotice:
      'SIMULATED packet. No real cancellation requests, emails, or refunds were sent or will be sent. Provider outcomes are scripted sandbox results.',
    moneyNotice:
      'Estimates assume each structured policy is the complete remaining obligation. Confirmed cancellation is not received cash; received refund is tracked separately.',
    event: snap.event,
    entries: snap.bookings.map((b) => ({
      bookingId: b.bookingId,
      service: b.service,
      provider: b.provider,
      confirmationRef: b.confirmationRef,
      currency: b.currency,
      committedMinor: b.committedMinor,
      paidMinor: b.paidMinor,
      unpaidMinor: b.unpaidMinor,
      bookingVersion: b.version,
      bookingStatus: b.status,
      state: stateOf(b),
      policy: b.policy
        ? { policyId: b.policy.policyId, version: b.policy.version, supported: b.policy.supported, sourceRef: b.policy.sourceRef }
        : null,
      assessment: b.assessment
        ? {
            status: b.assessment.status,
            reason: b.assessment.reason,
            tierId: b.assessment.tierId ?? null,
            boundary: b.assessment.boundary ?? null,
            cutoffInstant: b.assessment.cutoffInstant ?? null,
            feeMinor: b.assessment.feeMinor ?? null,
            refundMinor: b.assessment.refundMinor ?? null,
            extraPaymentMinor: b.assessment.extraPaymentMinor ?? null,
            futureChargesAvoidedMinor: b.assessment.futureChargesAvoidedMinor ?? null,
            netBenefitMinor: b.assessment.netBenefitMinor ?? null,
            label: 'estimated — not confirmed',
          }
        : null,
      request: b.request
        ? {
            requestId: b.request.requestId,
            status: b.request.status,
            reason: b.request.reason,
            idempotencyKey: b.request.idempotencyKey,
            assessedInstant: b.request.assessedInstant,
            approvedInstant: b.request.approvedInstant,
            approvedFingerprint: b.request.approvedFingerprint,
            staleReason: b.request.staleReason,
            refundReceivedMinor: b.request.refundReceivedMinor,
          }
        : null,
      providerOutcomes: b.outcomes.map((o) => ({
        attempt: o.attempt,
        outcome: o.outcome,
        code: o.code,
        ref: o.ref,
        detail: o.detail,
        simulated: true,
        recordedInstant: o.recordedInstant,
      })),
    })),
    totals: snap.totals,
  };
}

export function reset(store, seed) {
  store.resetAll(seed);
  return snapshot(store);
}
