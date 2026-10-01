/**
 * Deterministic sandbox seed. Both the node:sqlite store and the browser
 * IndexedDB store reset to exactly this state — one paid sample invoice.
 */
import { BASE_INVOICE, renderCanonicalDoc } from './documents.mjs';
import {
  fixtureTimestamp, itemsSignature, normalizeCurrency,
  normalizeInvoiceNumber, normalizeSupplier, sha256Hex,
} from './engine.mjs';

export async function buildSeed() {
  const f = { ...BASE_INVOICE };
  const docBytes = new TextEncoder().encode(renderCanonicalDoc(f));
  const docHash = await sha256Hex(docBytes);
  const supplierNorm = normalizeSupplier(f.supplier);
  const invoiceNorm = normalizeInvoiceNumber(f.invoiceNumber);
  const currency = normalizeCurrency(f.currency);

  const payment = {
    paymentUid: 'PAY-0001',
    requestId: 'seed-initial-request',
    supplier: f.supplier,
    supplierNorm,
    invoiceNumber: f.invoiceNumber,
    invoiceNorm,
    currency,
    amountCents: f.amountCents,
    period: f.period,
    itemsSignature: itemsSignature(f.items),
    docHash,
    filename: 'northline_inv1042.pdf',
    actor: 'Seed · accounts payable',
    paidAt: fixtureTimestamp(0), // Sep 3, 2024 10:14 AM
  };

  const attempts = [
    {
      kind: 'payment',
      requestId: 'seed-initial-request',
      actor: 'Seed · accounts payable',
      supplier: f.supplier,
      invoiceNumber: f.invoiceNumber,
      currency,
      amountCents: f.amountCents,
      period: f.period,
      result: 'Payment recorded',
      note: 'Initial request · seed data',
      at: fixtureTimestamp(0),
    },
  ];

  const requests = [
    {
      requestId: 'seed-initial-request',
      outcome: 'recorded',
      verdict: { status: 'clear', title: 'Clear to pay', detail: 'Seed payment.', evidence: [], payable: true },
      paymentUid: 'PAY-0001',
      actor: 'Seed · accounts payable',
      at: fixtureTimestamp(0),
    },
  ];

  return { payment, attempts, requests, clockSeq: 1, paymentSeq: 1 };
}
