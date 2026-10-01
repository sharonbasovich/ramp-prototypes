/**
 * Independent acceptance suite — real HTTP against the real node:sqlite server.
 * Documents and records are constructed here, not imported from the app's
 * demo scenarios, per SPEC-PAY-BUDGET's independent-test requirement.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startServer } from '../server/server.mjs';

let server;
let store;
let base;
let seq = 0;
const rid = (p) => `${p}-${Date.now()}-${seq++}`;

const post = (p, body) =>
  fetch(`${base}${p}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json());

const get = (p) => fetch(`${base}${p}`).then((r) => r.json());

/** Hand-written invoice text (independent fixture). */
function doc({ supplier, number, period, total, currency = 'USD', items = true }) {
  return [
    supplier.toUpperCase(),
    'INVOICE',
    `Supplier: ${supplier}`,
    `Invoice No.: ${number}`,
    period ? `Billing Period: ${period}` : null,
    items ? 'Services rendered    1  $1,234.00  $1,234.00' : null,
    `Total (${currency}) ${currency === 'USD' ? '$' : ''}${total}`,
    'Thank you.',
  ].filter(Boolean).join('\n');
}

async function uploadAndFacts(filename, text) {
  const contentBase64 = Buffer.from(text, 'utf8').toString('base64');
  const res = await post('/api/documents', { filename, contentBase64 });
  return res;
}

const SUP = 'Acceptance Test Traders';

beforeAll(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pmt-'));
  ({ server, store } = await startServer(0, path.join(dir, 'test.sqlite')));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => {
  server.close();
  store.close();
});

describe('Pay Me Twice acceptance matrix (HTTP + node:sqlite)', () => {
  it('health reports sqlite sandbox mode', async () => {
    const h = await get('/api/health');
    expect(h.ok).toBe(true);
    expect(h.mode).toBe('sqlite');
  });

  it('renamed original: identical bytes under a new filename → duplicate, one payment', async () => {
    const text = doc({ supplier: SUP, number: 'ATT-1', period: 'August 2026', total: '1,234.00' });
    const ing = await uploadAndFacts('att1.pdf', text);
    expect(ing.supported).toBe(true);
    const f = { ...ing.fields, docHash: ing.docHash, docSupported: true };
    const p1 = await post('/api/pay', { requestId: rid('pay'), actor: 'attacker-a', facts: f });
    expect(p1.outcome).toBe('recorded');

    const renamed = await uploadAndFacts('totally_different_name.pdf', text);
    expect(renamed.docHash).toBe(ing.docHash);
    const f2 = { ...renamed.fields, docHash: renamed.docHash, docSupported: true };
    const p2 = await post('/api/pay', { requestId: rid('pay'), actor: 'attacker-b', facts: f2 });
    expect(p2.outcome).toBe('duplicate');

    const s = await get('/api/state');
    expect(s.payments.filter((p) => p.invoiceNorm === 'ATT-1' || p.invoiceNumber === 'ATT-1').length).toBe(1);
  });

  it('reformatted identity: same supplier/ref/amount in new layout → duplicate', async () => {
    const text = [
      '*** STATEMENT OF SERVICES ***',
      `From: ${SUP}`,
      `Invoice #ATT-1`,
      `For services rendered: August 2026`,
      `Amount due (USD): $1,234.00`,
    ].join('\n');
    const ing = await uploadAndFacts('layout-b.pdf', text);
    const f = { ...ing.fields, docHash: ing.docHash, docSupported: true };
    const p = await post('/api/pay', { requestId: rid('pay'), actor: 'attacker-c', facts: f });
    expect(p.outcome).toBe('duplicate');
  });

  it('ambiguous changed reference → review required, no payment', async () => {
    const text = doc({ supplier: SUP, number: 'ATT-1-REV2', period: null, total: '1,234.00' });
    const ing = await uploadAndFacts('rev2.pdf', text);
    const f = { ...ing.fields, docHash: ing.docHash, docSupported: true, period: '' };
    const v = await post('/api/validate', { facts: f, actor: 'attacker-d' });
    expect(v.verdict.status).toBe('review');
    const p = await post('/api/pay', { requestId: rid('pay'), actor: 'attacker-d', facts: f });
    expect(p.outcome).toBe('review');
    expect(p.paymentUid).toBeNull();
  });

  it('legitimate recurrence: new reference + next month → payable', async () => {
    const text = doc({ supplier: SUP, number: 'ATT-2', period: 'September 2026', total: '1,234.00' });
    const ing = await uploadAndFacts('att2.pdf', text);
    const f = { ...ing.fields, docHash: ing.docHash, docSupported: true };
    const p = await post('/api/pay', { requestId: rid('pay'), actor: 'ap-clerk', facts: f });
    expect(p.outcome).toBe('recorded');
    const s = await get('/api/state');
    expect(s.payments.filter((x) => x.supplier === SUP).length).toBe(2);
  });

  it('unreadable document → unsupported, nothing invented, no payment', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5]);
    const ing = await post('/api/documents', { filename: 'photo.png', contentBase64: png.toString('base64') });
    expect(ing.supported).toBe(false);
    expect(ing.fields).toBeNull();
    const p = await post('/api/pay', {
      requestId: rid('pay'), actor: 'attacker-e',
      facts: { supplier: '', invoiceNumber: '', amountCents: null, docSupported: false, factsSource: 'extracted' },
    });
    expect(['unsupported', 'invalid']).toContain(p.outcome);
  });

  it('true request race: 20 concurrent requests → exactly one payment', async () => {
    const text = doc({ supplier: 'Race Condition LLC', number: 'RACE-7', period: 'May 2026', total: '99.00' });
    const ing = await uploadAndFacts('race7.pdf', text);
    const f = { ...ing.fields, docHash: ing.docHash, docSupported: true };
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        post('/api/pay', { requestId: `race-${i}-${Date.now()}`, actor: `tab-${i}`, facts: f }))
    );
    const recorded = results.filter((r) => r.outcome === 'recorded');
    expect(recorded.length).toBe(1);
    expect(results.filter((r) => r.outcome === 'duplicate').length).toBe(19);
    const s = await get('/api/state');
    expect(s.payments.filter((p) => p.invoiceNumber === 'RACE-7').length).toBe(1);
  });

  it('retry: replaying a successful request ID returns the same payment', async () => {
    const text = doc({ supplier: 'Retry & Sons', number: 'RT-3', period: 'April 2026', total: '10.00' });
    const ing = await uploadAndFacts('rt3.pdf', text);
    const f = { ...ing.fields, docHash: ing.docHash, docSupported: true };
    const id = rid('retry');
    const p1 = await post('/api/pay', { requestId: id, actor: 't', facts: f });
    const before = await get('/api/state');
    const p2 = await post('/api/pay', { requestId: id, actor: 't', facts: f });
    const after = await get('/api/state');
    expect(p1.outcome).toBe('recorded');
    expect(p2.outcome).toBe('replayed');
    expect(p2.paymentUid).toBe(p1.paymentUid);
    expect(after.payments.length).toBe(before.payments.length);
  });

  it('currency isolation: EUR never aggregates or collides with USD', async () => {
    const eurText = doc({ supplier: 'Euro Parts BV', number: 'EU-1', period: 'July 2026', total: '500.00', currency: 'EUR' });
    const ing = await uploadAndFacts('eu1.pdf', eurText);
    const f = { ...ing.fields, docHash: ing.docHash, docSupported: true };
    const p = await post('/api/pay', { requestId: rid('pay'), actor: 't', facts: f });
    expect(p.outcome).toBe('recorded');
    const s = await get('/api/state');
    expect(s.stats.paidByCurrency.EUR).toBe(50000);
    expect(s.stats.paidByCurrency.USD).toBeGreaterThan(0);
    // Identical reference in EUR does not collide with a USD payment.
    const text2 = doc({ supplier: 'Euro Parts BV', number: 'EU-1', period: 'July 2026', total: '500.00', currency: 'USD' });
    const ing2 = await uploadAndFacts('eu1-usd.pdf', text2);
    const p2 = await post('/api/pay', {
      requestId: rid('pay'), actor: 't',
      facts: { ...ing2.fields, docHash: ing2.docHash, docSupported: true },
    });
    expect(p2.outcome).toBe('recorded');
  });

  it('rejected-request conservation: blocked/held attempts move nothing', async () => {
    const before = await get('/api/state');
    const text = doc({ supplier: SUP, number: 'ATT-1', period: 'August 2026', total: '1,234.00' });
    const ing = await uploadAndFacts('att1-again.pdf', text);
    const f = { ...ing.fields, docHash: ing.docHash, docSupported: true };
    await post('/api/pay', { requestId: rid('x'), actor: 't', facts: f });
    await post('/api/pay', { requestId: rid('x'), actor: 't', facts: { ...f, invoiceNumber: 'ATT-9', period: '' } });
    await post('/api/validate', { facts: f, actor: 't' });
    const after = await get('/api/state');
    expect(after.payments.length).toBe(before.payments.length);
    expect(after.stats.paidByCurrency.USD).toBe(before.stats.paidByCurrency.USD);
  });

  it('native PDF: escaped-paren strings, exact $17.25, unstated fields stay missing', async () => {
    const content =
      'BT /F1 12 Tf 50 720 Td (Supplier: Cobalt Fixtures) Tj ' +
      '0 -20 Td (Invoice No.: CF-9) Tj ' +
      '0 -20 Td (Total \\(USD\\) $17.25) Tj ET';
    const pdf = Buffer.from(
      `%PDF-1.4\n4 0 obj<</Length ${content.length}>>stream\n${content}\n` +
      'endstream\nendobj\ntrailer<</Root 1 0 R>>', 'latin1');
    const ing = await post('/api/documents', { filename: 'cf9.pdf', contentBase64: pdf.toString('base64') });
    expect(ing.supported).toBe(true);
    expect(ing.fields.amountCents).toBe(1725);
    expect(ing.fields.supplier).toBe('Cobalt Fixtures');
    expect(ing.fields.invoiceNumber).toBe('CF-9');
    expect(ing.fields.period).toBe(''); // incomplete: never backfilled
    expect(ing.found).not.toContain('period');
    const p = await post('/api/pay', {
      requestId: rid('pay'), actor: 'ap-clerk',
      facts: { ...ing.fields, docHash: ing.docHash, docSupported: true },
    });
    expect(p.outcome).toBe('recorded');
    const s = await get('/api/state');
    const pay = s.payments.find((x) => x.invoiceNumber === 'CF-9');
    expect(pay.amountCents).toBe(1725);
    expect(pay.period).toBe('');
  });

  it('manual incomplete facts cannot pay — invalid, ledger conserved', async () => {
    const before = await get('/api/state');
    const p = await post('/api/pay', {
      requestId: rid('pay'), actor: 'manual-entry',
      facts: { supplier: 'Manual Entry Co', invoiceNumber: '', amountCents: null, period: '', factsSource: 'manual', docSupported: false },
    });
    expect(p.outcome).toBe('invalid');
    expect(p.paymentUid).toBeNull();
    const after = await get('/api/state');
    expect(after.payments.length).toBe(before.payments.length);
  });

  it('reset returns to the seeded state', async () => {
    const s = await post('/api/reset', {});
    expect(s.payments.length).toBe(1);
    expect(s.payments[0].paymentUid).toBe('PAY-0001');
    const again = await get('/api/state');
    expect(again.payments.length).toBe(1);
  });
});
