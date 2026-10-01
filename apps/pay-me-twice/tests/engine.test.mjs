import { describe, it, expect } from 'vitest';
import {
  evaluateInvoice, factsSourceAfterEdit, normalizeFacts, normalizeInvoiceNumber, normalizeSupplier,
  validateFacts, monthToPeriod, displayPeriod, formatCents, payInvoice,
} from '../engine/engine.mjs';
import { extractFields, extractDocument } from '../engine/documents.mjs';

/** Independent in-memory store implementing the engine's store contract. */
function memStore(payments = []) {
  const reqs = new Map();
  const attempts = [];
  let seq = payments.length;
  const store = {
    payments,
    requests: reqs,
    attempts,
    async transaction(fn) { return fn(); },
    async getRequest(id) { return reqs.get(id) ?? null; },
    async saveRequest(r) { reqs.set(r.requestId, r); },
    async paymentWithDocHash(h) { return payments.find((p) => p.docHash && p.docHash === h) ?? null; },
    async paymentWithIdentity(s, i, c) {
      return payments.find((p) =>
        p.supplierNorm === s && p.invoiceNorm === i && p.currency === c) ?? null;
    },
    async paymentsForSupplier(s, c) {
      return payments.filter((p) => p.supplierNorm === s && p.currency === c);
    },
    async nextPaymentUid() { seq += 1; return `PAY-${String(seq).padStart(4, '0')}`; },
    async nextTimestamp() { return 'Sep 3, 2026 10:20 AM'; },
    async insertPayment(rec) {
      const clash = payments.find((p) =>
        p.supplierNorm === rec.supplierNorm && p.invoiceNorm === rec.invoiceNorm && p.currency === rec.currency);
      if (clash) return false;
      payments.push({ ...rec, paidAt: 'Sep 3, 2026 10:20 AM' });
      return true;
    },
    async addAttempt(a) { attempts.push(a); },
  };
  return store;
}

const paid = {
  paymentUid: 'PAY-0001',
  requestId: 'orig',
  supplier: 'Test Supplier Co',
  supplierNorm: 'test supplier co',
  invoiceNumber: 'TST-100',
  invoiceNorm: 'TST-100',
  currency: 'USD',
  amountCents: 123400,
  period: '2026-08',
  itemsSignature: 'audit services|1|123400',
  docHash: 'abc123hash',
  paidAt: 'Sep 1, 2026 9:00 AM',
};

const base = {
  supplier: 'Test Supplier Co',
  invoiceNumber: 'TST-100',
  currency: 'USD',
  amountCents: 123400,
  period: '2026-08',
  items: [{ description: 'Audit services', qty: 1, rateCents: 123400, amountCents: 123400 }],
  factsSource: 'generated',
  docSupported: true,
  docHash: '',
};

describe('normalization', () => {
  it('collapses whitespace and case without eating punctuation', () => {
    expect(normalizeSupplier('  Northline   Studio ')).toBe('northline studio');
    expect(normalizeInvoiceNumber(' inv-1042 ')).toBe('INV-1042');
    expect(normalizeInvoiceNumber('INV-1042')).not.toBe(normalizeInvoiceNumber('INV1042'));
  });
  it('maps month labels to periods and back', () => {
    expect(monthToPeriod('September 2026')).toBe('2026-09');
    expect(displayPeriod('2026-10')).toBe('October 2026');
  });
  it('formats integer cents', () => {
    expect(formatCents(48000, 'USD')).toBe('$480.00');
  });
  it('rejects non-integer / negative / absurd amounts', () => {
    const f = normalizeFacts({ ...base, amountCents: 480.5 });
    expect(validateFacts(f).length).toBeGreaterThan(0);
    expect(validateFacts(normalizeFacts({ ...base, amountCents: -100 })).length).toBeGreaterThan(0);
    expect(validateFacts(normalizeFacts({ ...base, currency: 'US Dollars' })).length).toBeGreaterThan(0);
  });
});

describe('verdicts', () => {
  it('identical document hash → duplicate', async () => {
    const v = await evaluateInvoice({ ...base, docHash: 'abc123hash', invoiceNumber: 'TST-999' }, memStore([paid]));
    expect(v.status).toBe('duplicate');
    expect(v.payable).toBe(false);
  });
  it('same supplier + invoice + currency → duplicate', async () => {
    const v = await evaluateInvoice(base, memStore([paid]));
    expect(v.status).toBe('duplicate');
    expect(v.matchedPaymentUid).toBe('PAY-0001');
  });
  it('new reference but missing period → review', async () => {
    const v = await evaluateInvoice({ ...base, invoiceNumber: 'TST-101', period: '' }, memStore([paid]));
    expect(v.status).toBe('review');
    expect(v.payable).toBe(false);
  });
  it('new reference + same period → review (not proof of fraud, not auto-payable)', async () => {
    const v = await evaluateInvoice({ ...base, invoiceNumber: 'TST-101' }, memStore([paid]));
    expect(v.status).toBe('review');
  });
  it('new reference + next period → clear (legitimate recurrence)', async () => {
    const v = await evaluateInvoice({ ...base, invoiceNumber: 'TST-101', period: '2026-09' }, memStore([paid]));
    expect(v.status).toBe('clear');
    expect(v.payable).toBe(true);
  });
  it('different currency does not collide with paid USD identity', async () => {
    const v = await evaluateInvoice({ ...base, currency: 'EUR' }, memStore([paid]));
    expect(v.status).toBe('clear');
  });
  it('unreadable doc without manual facts → unsupported', async () => {
    const v = await evaluateInvoice({ ...base, docSupported: false, factsSource: 'extracted' }, memStore([paid]));
    expect(v.status).toBe('unsupported');
  });
  it('manual facts on unreadable doc still get evaluated', async () => {
    const v = await evaluateInvoice({ ...base, docSupported: false, factsSource: 'manual' }, memStore([paid]));
    expect(v.status).toBe('duplicate');
  });
});

describe('payInvoice', () => {
  it('records a clear payment once; replay returns identical result', async () => {
    const store = memStore([paid]);
    const f = { ...base, invoiceNumber: 'TST-200', period: '2026-09' };
    const r1 = await payInvoice(store, { requestId: 'r1', actor: 't', facts: f });
    expect(r1.outcome).toBe('recorded');
    const r2 = await payInvoice(store, { requestId: 'r1', actor: 't', facts: f });
    expect(r2.outcome).toBe('replayed');
    expect(r2.paymentUid).toBe(r1.paymentUid);
    expect(store.payments.length).toBe(2);
  });
  it('a second distinct request for the same identity is a duplicate', async () => {
    const store = memStore([paid]);
    const f = { ...base, invoiceNumber: 'TST-200', period: '2026-09' };
    await payInvoice(store, { requestId: 'a', actor: 't', facts: f });
    const r = await payInvoice(store, { requestId: 'b', actor: 't', facts: f });
    expect(r.outcome).toBe('duplicate');
    expect(store.payments.length).toBe(2);
  });
  it('review verdicts never record a payment', async () => {
    const store = memStore([paid]);
    const r = await payInvoice(store, {
      requestId: 'rev1', actor: 't',
      facts: { ...base, invoiceNumber: 'TST-300', period: '' },
    });
    expect(r.outcome).toBe('review');
    expect(store.payments.length).toBe(1);
  });
});

describe('extraction', () => {
  it('parses labeled invoice text into facts', () => {
    const { fields } = extractFields([
      'ACME INDUSTRIAL',
      'INVOICE',
      'Supplier: Acme Industrial',
      'Invoice No.: ACM-77',
      'Billing Period: June 2026',
      'Total (USD) $1,250.00',
    ].join('\n'));
    expect(fields.supplier).toBe('Acme Industrial');
    expect(fields.invoiceNumber).toBe('ACM-77');
    expect(fields.period).toBe('2026-06');
    expect(fields.amountCents).toBe(125000);
    expect(fields.currency).toBe('USD');
  });
  it('parses the alternate layout', () => {
    const { fields } = extractFields([
      'From: Beacon Works',
      'Invoice #BW-12',
      'For services rendered: March 2026',
      'Amount due (USD): $77.50',
    ].join('\n'));
    expect(fields.supplier).toBe('Beacon Works');
    expect(fields.invoiceNumber).toBe('BW-12');
    expect(fields.period).toBe('2026-03');
    expect(fields.amountCents).toBe(7750);
  });
  it('image-like bytes are unsupported, never invented', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3]);
    const r = await extractDocument(bytes, 'scan.png');
    expect(r.supported).toBe(false);
    expect(r.fields.supplier).toBeUndefined();
  });

  it('native PDF: escaped parens parse, exact $17.25, missing fields stay missing', async () => {
    const content =
      'BT /F1 12 Tf 50 720 Td (Supplier: Cobalt Fixtures) Tj ' +
      '0 -20 Td (Invoice No.: CF-9) Tj ' +
      '0 -20 Td (Total \\(USD\\) $17.25) Tj ET';
    const pdf =
      `%PDF-1.4\n4 0 obj<</Length ${content.length}>>stream\n${content}\n` +
      'endstream\nendobj\ntrailer<</Root 1 0 R>>';
    const r = await extractDocument(new TextEncoder().encode(pdf), 'cf9.pdf');
    expect(r.supported).toBe(true);
    expect(r.fields.supplier).toBe('Cobalt Fixtures');
    expect(r.fields.invoiceNumber).toBe('CF-9');
    expect(r.fields.amountCents).toBe(1725);
    expect(r.fields.period).toBeUndefined();
    expect(r.found).not.toContain('period');
  });

  it('native PDF: TJ array with escapes and kerning joins correctly', async () => {
    const content =
      'BT /F1 12 Tf 50 720 Td [(Total \\(USD\\)) -40 ($17.25)] TJ ET';
    const pdf =
      `%PDF-1.4\n4 0 obj<</Length ${content.length}>>stream\n${content}\n` +
      'endstream\nendobj\ntrailer<</Root 1 0 R>>';
    const r = await extractDocument(new TextEncoder().encode(pdf), 'tj.pdf');
    expect(r.supported).toBe(true);
    expect(r.fields.amountCents).toBe(1725);
  });

  it('escaped label text parses like plain text', () => {
    const { fields } = extractFields('Supplier: Escaped Co\nTotal \\(USD\\) $17.25');
    expect(fields.amountCents).toBe(1725);
    expect(fields.currency).toBe('USD');
  });

  it('incomplete text leaves unstated fields absent — never guessed', () => {
    const { fields, found } = extractFields('Supplier: Partial Co\nTotal (USD) $9.99');
    expect(fields.supplier).toBe('Partial Co');
    expect(fields.amountCents).toBe(999);
    expect(fields.invoiceNumber).toBeUndefined();
    expect(fields.period).toBeUndefined();
    expect(found).toContain('supplier');
    expect(found).not.toContain('invoiceNumber');
    expect(found).not.toContain('period');
  });

  it('total without a currency code leaves currency unstated', () => {
    const { fields, found } = extractFields('Supplier: No Cur Co\nInvoice No.: NC-7\nTotal 12.34');
    expect(fields.amountCents).toBe(1234);
    expect(fields.currency).toBeUndefined();
    expect(found).not.toContain('currency');
  });

  it('missing currency cannot pay — no USD is assumed', async () => {
    const store = memStore([paid]);
    const r = await payInvoice(store, {
      requestId: 'nc1', actor: 'manual',
      facts: { supplier: 'No Cur Co', invoiceNumber: 'NC-7', amountCents: 1234, currency: '', factsSource: 'manual', docSupported: false },
    });
    expect(r.outcome).toBe('invalid');
    expect(store.payments.length).toBe(1);
    const v = await evaluateInvoice(
      { supplier: 'No Cur Co', invoiceNumber: 'NC-7', amountCents: 1234, currency: '', factsSource: 'manual', docSupported: false },
      store
    );
    expect(v.status).toBe('invalid');
    expect(v.detail).toContain('Currency is required');
  });

  it('editing extracted/generated facts downgrades provenance to mixed', () => {
    expect(factsSourceAfterEdit('extracted')).toBe('mixed');
    expect(factsSourceAfterEdit('generated')).toBe('mixed');
    expect(factsSourceAfterEdit('seed')).toBe('mixed');
    expect(factsSourceAfterEdit('mixed')).toBe('mixed');
    expect(factsSourceAfterEdit('manual')).toBe('manual');
  });

  it('mixed facts validate and disclose document + manual edits', async () => {
    const store = memStore([paid]);
    const v = await evaluateInvoice(
      { ...base, invoiceNumber: 'INV-1043', period: '2026-10', factsSource: 'mixed' },
      store
    );
    expect(v.status).toBe('clear');
    expect(v.evidence.some((e) => e.label === 'Facts source' && /manual edits/.test(e.value))).toBe(true);
  });

  it('manually-entered incomplete facts cannot pay', async () => {
    const store = memStore([paid]);
    const r = await payInvoice(store, {
      requestId: 'm1', actor: 'manual',
      facts: { supplier: 'Partial Co', invoiceNumber: '', amountCents: null, factsSource: 'manual', docSupported: false },
    });
    expect(r.outcome).toBe('invalid');
    expect(store.payments.length).toBe(1);
  });
});
