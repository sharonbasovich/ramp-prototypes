/**
 * Pay Me Twice — shared, pure engine.
 *
 * Consumed by the Node server (node:sqlite store) and the in-browser sandbox
 * (IndexedDB store). No DOM or Node-only APIs; hashing uses WebCrypto which is
 * available in Node 22 and browsers. All money is integer minor units (cents).
 */

export const CURRENCIES = ['USD', 'EUR', 'GBP'];
export const DEFAULT_CURRENCY = 'USD';

// Explicit fixture clock. The sandbox never uses wall-clock dates for invoice
// data; each recorded attempt advances the fixture by one minute so the demo
// ledger reads Sep 3, 2026 10:14 AM, 10:15 AM, ... like the design concept.
export const FIXTURE_BASE_MS = Date.UTC(2026, 8, 3, 14, 14, 0); // 10:14 AM EDT
const MINUTE_MS = 60_000;

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** trim + collapse internal whitespace + lowercase (display text preserved elsewhere) */
export function normalizeSupplier(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Deliberately light: trim, collapse whitespace, uppercase.
 * Punctuation is preserved — 'INV-1042' and 'INV1042' stay distinct so that
 * near-identical references cannot silently collide into one identity.
 */
export function normalizeInvoiceNumber(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
}

export function normalizeCurrency(value) {
  return String(value ?? '').trim().toUpperCase();
}

export function normalizeFacts(facts) {
  const f = { ...facts };
  f.supplier = String(f.supplier ?? '').trim().replace(/\s+/g, ' ');
  f.invoiceNumber = String(f.invoiceNumber ?? '').trim().replace(/\s+/g, ' ');
  f.currency = normalizeCurrency(f.currency || DEFAULT_CURRENCY);
  f.amountCents = f.amountCents == null ? null : Number(f.amountCents);
  f.period = String(f.period ?? '').trim(); // 'YYYY-MM' or ''
  f.factsSource = f.factsSource || 'manual';
  f.docSupported = f.docSupported !== false;
  f.docHash = f.docHash || '';
  f.filename = f.filename || '';
  f.items = Array.isArray(f.items)
    ? f.items.map((it) => ({
        description: String(it.description ?? '').trim().replace(/\s+/g, ' '),
        qty: Number(it.qty) || 0,
        rateCents: Number(it.rateCents) || 0,
        amountCents: Number(it.amountCents) || 0,
      }))
    : [];
  return f;
}

export function validateFacts(facts) {
  const errors = [];
  if (!facts.supplier) errors.push('Supplier is required.');
  if (!facts.invoiceNumber) errors.push('Invoice number is required.');
  if (!/^[A-Z]{3}$/.test(facts.currency)) errors.push('Currency must be a 3-letter code.');
  if (
    !Number.isSafeInteger(facts.amountCents) ||
    facts.amountCents <= 0 ||
    facts.amountCents > 1_000_000_000_000
  ) {
    errors.push('Amount must be a positive whole number of cents.');
  }
  if (facts.period && !/^\d{4}-(0[1-9]|1[0-2])$/.test(facts.period)) {
    errors.push('Billing period must be a YYYY-MM month.');
  }
  for (const it of facts.items) {
    if (!Number.isSafeInteger(it.amountCents) || it.amountCents < 0) {
      errors.push(`Line item "${it.description || '?'}" has an invalid amount.`);
    }
    if (!Number.isInteger(it.qty) || it.qty <= 0) {
      errors.push(`Line item "${it.description || '?'}" has an invalid quantity.`);
    }
  }
  return errors;
}

/** Signature of the line-item set: case/space-insensitive, order-insensitive. */
export function itemsSignature(items) {
  return (items || [])
    .map((it) => `${normalizeSupplier(it.description)}|${it.qty}|${it.amountCents}`)
    .sort()
    .join('~');
}

export async function sha256Hex(data) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function displayPeriod(period) {
  if (!/^\d{4}-\d{2}$/.test(period || '')) return '—';
  const [y, m] = period.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

export function monthToPeriod(label) {
  const m = /^([A-Za-z]+)\s+(\d{4})$/.exec(String(label || '').trim());
  if (!m) return '';
  const idx = MONTH_NAMES.findIndex(
    (n) => n.toLowerCase() === m[1].toLowerCase() || n.toLowerCase().startsWith(m[1].toLowerCase())
  );
  return idx < 0 ? '' : `${m[2]}-${String(idx + 1).padStart(2, '0')}`;
}

export function formatCents(cents, currency = DEFAULT_CURRENCY) {
  if (!Number.isSafeInteger(cents)) return '—';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

const TS_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', year: 'numeric',
  hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York',
});

/** attemptSeq = number of attempts already recorded (seed = 1 → next 10:15 AM). */
export function fixtureTimestamp(attemptSeq) {
  return TS_FMT.format(new Date(FIXTURE_BASE_MS + attemptSeq * MINUTE_MS));
}

/* ------------------------------------------------------------------ */
/* Verdicts                                                            */
/* ------------------------------------------------------------------ */

/**
 * Evaluate normalized invoice facts against the store's paid history.
 * Store must expose async: paymentWithDocHash(hash),
 * paymentWithIdentity(supplierNorm, invoiceNorm, currency),
 * paymentsForSupplier(supplierNorm, currency).
 *
 * Returns { status, title, detail, evidence, payable, matchedPaymentUid? }
 * status: 'clear' | 'duplicate' | 'review' | 'unsupported' | 'invalid'
 */
export async function evaluateInvoice(rawFacts, store) {
  const facts = normalizeFacts(rawFacts);

  if (facts.docSupported === false && facts.factsSource !== 'manual') {
    return {
      status: 'unsupported',
      title: 'Unsupported document',
      detail:
        'No readable text could be extracted from this document. Enter the invoice facts manually to validate it — we will not guess fields.',
      evidence: [{ label: 'Document', value: facts.filename || 'uploaded file' }],
      payable: false,
    };
  }

  const errors = validateFacts(facts);
  if (errors.length) {
    return {
      status: 'invalid',
      title: 'Cannot validate',
      detail: errors.join(' '),
      evidence: errors.map((label) => ({ label: 'Problem', value: label })),
      payable: false,
    };
  }

  const supplierNorm = normalizeSupplier(facts.supplier);
  const invoiceNorm = normalizeInvoiceNumber(facts.invoiceNumber);
  const evidence = [
    { label: 'Supplier', value: facts.supplier },
    { label: 'Invoice number', value: facts.invoiceNumber },
    { label: 'Amount', value: formatCents(facts.amountCents, facts.currency) },
    { label: 'Billing period', value: displayPeriod(facts.period) },
  ];
  if (facts.factsSource === 'manual') {
    evidence.push({ label: 'Facts source', value: 'Entered manually (no document text verified)' });
  }

  // Signal 1 — identical document bytes already paid.
  if (facts.docHash) {
    const docHit = await store.paymentWithDocHash(facts.docHash);
    if (docHit) {
      return {
        status: 'duplicate',
        title: 'Duplicate blocked',
        detail: 'This document has already been paid — identical file content, even under a new filename.',
        evidence: [
          ...evidence,
          { label: 'Matched content hash', value: `${facts.docHash.slice(0, 12)}…` },
          { label: 'Previously paid (ledger entry)', value: `${docHit.paidAt} · ${docHit.paymentUid}` },
        ],
        payable: false,
        matchedPaymentUid: docHit.paymentUid,
      };
    }
  }

  // Signal 2 — the payable identity (supplier + invoice number + currency) is paid.
  const idHit = await store.paymentWithIdentity(supplierNorm, invoiceNorm, facts.currency);
  if (idHit) {
    return {
      status: 'duplicate',
      title: 'Duplicate blocked',
      detail: 'This invoice matches a bill that has already been paid.',
      evidence: [
        { label: 'Matched supplier', value: idHit.supplier },
        { label: 'Matched invoice number', value: idHit.invoiceNumber },
        { label: 'Matched amount', value: formatCents(idHit.amountCents, idHit.currency) },
        { label: 'Previously paid (ledger entry)', value: `${idHit.paidAt} · ${idHit.paymentUid}` },
      ],
      payable: false,
      matchedPaymentUid: idHit.paymentUid,
    };
  }

  // Signal 3 — near duplicate: same supplier, currency, amount and line items
  // but a different invoice reference. Similarity alone is not proof.
  const sameSupplier = await store.paymentsForSupplier(supplierNorm, facts.currency);
  const sig = itemsSignature(facts.items);
  const near = sameSupplier.filter(
    (p) => p.amountCents === facts.amountCents && p.itemsSignature === sig
  );
  if (near.length) {
    const periods = new Set(near.map((p) => p.period).filter(Boolean));
    if (!facts.period) {
      return {
        status: 'review',
        title: 'Review required',
        detail:
          `Same supplier, amount and line items as paid ${near[0].invoiceNumber}, ` +
          'but the invoice reference is different and no billing period was supplied. ' +
          'Similarity does not prove a duplicate — this cannot be paid automatically.',
        evidence: [
          ...evidence,
          { label: 'Similar paid invoice', value: `${near[0].invoiceNumber} · ${near[0].paidAt}` },
          { label: 'Missing', value: 'Billing / service period' },
        ],
        payable: false,
        matchedPaymentUid: near[0].paymentUid,
      };
    }
    if (periods.has(facts.period)) {
      return {
        status: 'review',
        title: 'Review required',
        detail:
          `Same supplier, amount and billing period as paid ${near[0].invoiceNumber}, ` +
          'but the invoice reference differs. Needs a human decision.',
        evidence: [
          ...evidence,
          { label: 'Similar paid invoice', value: `${near[0].invoiceNumber} · ${near[0].paidAt}` },
          { label: 'Shared billing period', value: displayPeriod(facts.period) },
        ],
        payable: false,
        matchedPaymentUid: near[0].paymentUid,
      };
    }
    // Legitimate recurrence: new reference AND a new service period.
    return {
      status: 'clear',
      title: 'Clear to pay',
      detail:
        `A different invoice from ${facts.supplier}. Same amount and items as ${near[0].invoiceNumber}, ` +
        `but a new reference and a new billing period (${displayPeriod(facts.period)}) — a legitimate next bill, not a duplicate.`,
      evidence: [
        ...evidence,
        { label: 'Prior invoice', value: `${near[0].invoiceNumber} · ${displayPeriod(near[0].period)}` },
        { label: 'New billing period', value: displayPeriod(facts.period) },
      ],
      payable: true,
    };
  }

  return {
    status: 'clear',
    title: 'Clear to pay',
    detail: 'No paid bill matches this supplier + invoice number + currency.',
    evidence,
    payable: true,
  };
}

/* ------------------------------------------------------------------ */
/* Payment flow — must run inside store.transaction()                  */
/* ------------------------------------------------------------------ */

/**
 * Idempotent, transactional pay attempt.
 * The store performs eligibility + recording atomically; uniqueness on
 * (supplier_norm, invoice_norm, currency) and request_id is the last defense.
 */
export async function payInvoice(store, { requestId, actor, facts }) {
  return store.transaction(async () => {
    const prior = await store.getRequest(requestId);
    if (prior) {
      return {
        outcome: 'replayed',
        verdict: prior.verdict,
        paymentUid: prior.paymentUid,
        detail: 'Same request ID — returning the original result. No new ledger entry.',
      };
    }
    const verdict = await evaluateInvoice(facts, store);
    const f = normalizeFacts(facts);
    let outcome;
    let paymentUid = null;
    if (verdict.status === 'clear' && verdict.payable) {
      paymentUid = await store.nextPaymentUid();
      const rec = {
        paymentUid,
        requestId,
        supplier: f.supplier,
        supplierNorm: normalizeSupplier(f.supplier),
        invoiceNumber: f.invoiceNumber,
        invoiceNorm: normalizeInvoiceNumber(f.invoiceNumber),
        currency: f.currency,
        amountCents: f.amountCents,
        period: f.period,
        itemsSignature: itemsSignature(f.items),
        docHash: f.docHash || '',
        filename: f.filename || '',
        actor: actor || 'unknown',
      };
      const inserted = await store.insertPayment(rec);
      if (inserted) {
        outcome = 'recorded';
      } else {
        // Lost a race / identity already paid between check and insert.
        outcome = 'duplicate';
        paymentUid = null;
        const winner = await store.paymentWithIdentity(rec.supplierNorm, rec.invoiceNorm, rec.currency);
        verdict.status = 'duplicate';
        verdict.title = 'Duplicate blocked';
        verdict.payable = false;
        verdict.detail = winner
          ? `Paid by a concurrent request (${winner.paymentUid}). The ledger allowed exactly one.`
          : 'Paid by a concurrent request. The ledger allowed exactly one.';
        verdict.matchedPaymentUid = winner?.paymentUid;
      }
    } else {
      outcome = verdict.status; // 'duplicate' | 'review' | 'unsupported' | 'invalid'
    }
    const at = await store.nextTimestamp();
    await store.addAttempt({
      kind: 'payment',
      requestId,
      actor: actor || 'unknown',
      supplier: f.supplier,
      invoiceNumber: f.invoiceNumber,
      currency: f.currency,
      amountCents: f.amountCents,
      period: f.period,
      result: outcomeLabel(outcome),
      note: attemptNote(outcome, actor, verdict?.matchedPaymentUid),
      at,
    });
    await store.saveRequest({ requestId, outcome, verdict, paymentUid, actor: actor || 'unknown', at });
    return { outcome, verdict, paymentUid, at };
  });
}

export function outcomeLabel(outcome) {
  switch (outcome) {
    case 'clear': return 'Clear to pay';
    case 'recorded': return 'Payment recorded';
    case 'duplicate': return 'Duplicate blocked';
    case 'review': return 'Review required';
    case 'unsupported': return 'Unsupported document';
    case 'invalid': return 'Invalid input';
    case 'replayed': return 'Replayed request';
    default: return outcome;
  }
}

function attemptNote(outcome, actor, matchedUid) {
  const who = actor ? `actor ${actor}` : 'unknown actor';
  switch (outcome) {
    case 'recorded': return `Payment request · ${who}`;
    case 'duplicate':
      return matchedUid ? `Blocked — already paid as ${matchedUid} · ${who}` : `Blocked — already paid · ${who}`;
    case 'review': return `Held for review · ${who}`;
    case 'unsupported': return `No readable facts · ${who}`;
    case 'invalid': return `Rejected input · ${who}`;
    default: return who;
  }
}
