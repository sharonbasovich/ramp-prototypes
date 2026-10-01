import { describe, expect, it } from 'vitest';
import { solve } from '../src/engine/optimize';
import { parseCsvQuoteSet, validateQuoteSet, CSV_TEMPLATE } from '../src/engine/validate';
import { isApprovalUsable, reduceApprovalOnSignature } from '../src/approval';
import { buildExportCsv } from '../src/export';
import { planSignature } from '../src/engine/signature';
import type { BasketItem, QuoteSet, Vendor } from '../src/engine/types';
import { SEED_ITEMS, SEED_DEADLINE_DAYS, SEED_QUOTE_SET } from '../src/data/seed';

const now = new Date('2026-10-01T00:00:00Z');
const mkSet = (vendors: Vendor[]): QuoteSet => ({
  currency: 'USD',
  quotedAt: '2026-09-01',
  validUntil: '2099-01-01',
  vendors,
});
const item = (skuId: string, qty: number): BasketItem => ({ skuId, name: skuId, detail: 'x', qty });

describe('zero-priced SKUs count as used vendor orders', () => {
  const vendors: Vendor[] = [
    {
      id: 'freebie',
      name: 'Freebie',
      deliveryDays: 1,
      shippingCents: 500,
      freeShipThresholdCents: null,
      minOrderCents: null,
      quotes: { widget: { skuId: 'widget', unitCents: 0, stock: 10 } },
    },
    {
      id: 'pricey',
      name: 'Pricey',
      deliveryDays: 1,
      shippingCents: 0,
      freeShipThresholdCents: null,
      minOrderCents: null,
      quotes: { widget: { skuId: 'widget', unitCents: 400, stock: 10 } },
    },
  ];

  it('a $0 allocation still pays that vendor shipping fee', () => {
    const res = solve({ items: [item('widget', 2)], deadlineDays: 3, quoteSet: mkSet(vendors) });
    if (res.status !== 'optimal') throw new Error('expected optimal');
    const order = res.plan.orders.find((o) => o.vendorId === 'freebie')!;
    expect(order.itemsCents).toBe(0);
    expect(order.shippingCents).toBe(500);
    expect(order.orderCents).toBe(500);
    expect(res.plan.totalCents).toBe(500); // vs pricey 800
    expect(res.plan.vendorCount).toBe(1);
  });

  it('a $0 order is not allowed to bypass the vendor minimum', () => {
    const minned = structuredClone(vendors);
    minned[0].minOrderCents = 1000;
    const res = solve({ items: [item('widget', 2)], deadlineDays: 3, quoteSet: mkSet(minned) });
    if (res.status !== 'optimal') throw new Error('expected optimal');
    // freebie's $0 order is below its 1000¢ minimum → disqualified
    expect(res.plan.allocations.every((a) => a.vendorId === 'pricey')).toBe(true);
    expect(res.plan.totalCents).toBe(800);
  });
});

describe('numeric cost comparison', () => {
  it('compares totals numerically (no lexical padding) past 9 digits', () => {
    const vendors: Vendor[] = [
      {
        id: 'expensive',
        name: 'Expensive',
        deliveryDays: 1,
        shippingCents: 0,
        freeShipThresholdCents: null,
        minOrderCents: null,
        quotes: { w: { skuId: 'w', unitCents: 1_000_000_000, stock: 5 } },
      },
      {
        id: 'cheaper',
        name: 'Cheaper',
        deliveryDays: 1,
        shippingCents: 0,
        freeShipThresholdCents: null,
        minOrderCents: null,
        quotes: { w: { skuId: 'w', unitCents: 999_999_999, stock: 5 } },
      },
    ];
    const res = solve({ items: [item('w', 1)], deadlineDays: 3, quoteSet: mkSet(vendors) });
    if (res.status !== 'optimal') throw new Error('expected optimal');
    expect(res.plan.totalCents).toBe(999_999_999);
    expect(res.plan.allocations[0].vendorId).toBe('cheaper');
  });

  it('skips allocations whose aggregate is not a safe integer', () => {
    const vendors: Vendor[] = [
      {
        id: 'absurd',
        name: 'Absurd',
        deliveryDays: 1,
        shippingCents: 0,
        freeShipThresholdCents: null,
        minOrderCents: null,
        quotes: { w: { skuId: 'w', unitCents: Number.MAX_SAFE_INTEGER, stock: 10 } },
      },
      {
        id: 'sane',
        name: 'Sane',
        deliveryDays: 1,
        shippingCents: 0,
        freeShipThresholdCents: null,
        minOrderCents: null,
        quotes: { w: { skuId: 'w', unitCents: 100, stock: 10 } },
      },
    ];
    const res = solve({ items: [item('w', 4)], deadlineDays: 3, quoteSet: mkSet(vendors) });
    if (res.status !== 'optimal') throw new Error('expected optimal');
    expect(res.plan.totalCents).toBe(400);
    expect(res.plan.allocations.every((a) => a.vendorId === 'sane')).toBe(true);
  });
});

describe('strict CSV parsing', () => {
  const rows = (overrides: (r: string[]) => void): string => {
    const body =
      'Acme,widget,100,10,1,500,,,USD,2026-09-01,2099-01-01\n' +
      'Acme,gadget,200,10,1,500,,,USD,2026-09-01,2099-01-01';
    const arr = body.split('\n').map((l) => l.split(','));
    overrides(arr[0]);
    return CSV_TEMPLATE.split('\n')[1] + '\n' + arr.map((r) => r.join(',')).join('\n');
  };

  it('rejects fractional and decorated numerics', () => {
    for (const bad of ['123.5', '1.9', '1x', '10xyz', '1e3']) {
      const { quoteSet, errors } = parseCsvQuoteSet(rows((r) => (r[2] = bad)), now);
      expect(quoteSet, `value ${bad}`).toBeUndefined();
      expect(errors.join(' ')).toMatch(/unit_cents/);
    }
  });

  it('rejects non-integer stock and vendor fields', () => {
    const { errors } = parseCsvQuoteSet(rows((r) => (r[3] = '2.5')), now);
    expect(errors.join(' ')).toMatch(/stock/);
    const { errors: e2 } = parseCsvQuoteSet(rows((r) => (r[5] = 'fast')), now);
    expect(e2.join(' ')).toMatch(/shipping_cents/);
  });

  it('rejects mixed or non-USD currency anywhere in the file', () => {
    const { errors } = parseCsvQuoteSet(rows((r) => (r[8] = 'CAD')), now);
    expect(errors.join(' ')).toMatch(/currency/);
  });

  it('rejects an expired valid_until on any row, not just the last', () => {
    const { errors, quoteSet } = parseCsvQuoteSet(rows((r) => (r[10] = '2020-01-01')), now);
    expect(quoteSet).toBeUndefined();
    expect(errors.join(' ')).toMatch(/expired/);
  });

  it('rejects conflicting repeated-vendor fields instead of last-row-wins', () => {
    const csv =
      CSV_TEMPLATE.split('\n')[1] +
      '\nAcme,widget,100,10,1,500,,,USD,2026-09-01,2099-01-01' +
      '\nAcme,gadget,200,10,1,900,,,USD,2026-09-01,2099-01-01';
    const { quoteSet, errors } = parseCsvQuoteSet(csv, now);
    expect(quoteSet).toBeUndefined();
    expect(errors.join(' ')).toMatch(/conflicts/);
  });

  it('rejects duplicate (vendor, sku) quote rows', () => {
    const csv =
      CSV_TEMPLATE.split('\n')[1] +
      '\nAcme,widget,100,10,1,500,,,USD,2026-09-01,2099-01-01' +
      '\nAcme,widget,150,10,1,500,,,USD,2026-09-01,2099-01-01';
    const { errors } = parseCsvQuoteSet(csv, now);
    expect(errors.join(' ')).toMatch(/duplicate/);
  });

  it('requires provenance on every row — never invents currency/dates', () => {
    for (const [idx, name] of [[8, 'currency'], [9, 'quoted_at'], [10, 'valid_until']] as const) {
      const { quoteSet, errors } = parseCsvQuoteSet(rows((r) => (r[idx] = '')), now);
      expect(quoteSet, name).toBeUndefined();
      expect(errors.join(' ')).toContain(`${name} is required`);
    }
  });

  it('rejects a CSV missing the provenance columns entirely', () => {
    const csv =
      'vendor,sku,unit_cents,stock,delivery_days,shipping_cents\n' +
      'Acme,widget,100,10,1,500\nAcme,gadget,200,10,1,500';
    const { quoteSet, errors } = parseCsvQuoteSet(csv, now);
    expect(quoteSet).toBeUndefined();
    for (const c of ['currency', 'quoted_at', 'valid_until']) {
      expect(errors.join(' ')).toContain(`missing column "${c}"`);
    }
  });

  it('rejects conflicting quoted_at across rows', () => {
    const { errors } = parseCsvQuoteSet(rows((r) => (r[9] = '2026-01-15')), now);
    expect(errors.join(' ')).toMatch(/quoted_at.*conflicts/);
  });

  it('rejects two vendor names that normalize to the same id', () => {
    const csv =
      CSV_TEMPLATE.split('\n')[1] +
      '\nAcme Inc,widget,100,10,1,500,,,USD,2026-09-01,2099-01-01' +
      '\nAcme-Inc,gadget,200,10,1,500,,,USD,2026-09-01,2099-01-01';
    const { errors } = parseCsvQuoteSet(csv, now);
    expect(errors.join(' ')).toMatch(/collides|same id/);
  });
});

describe('strict quote-set validation', () => {
  it('rejects duplicate vendor ids in JSON', () => {
    const qs = structuredClone(SEED_QUOTE_SET);
    qs.vendors.push(structuredClone(qs.vendors[0]));
    const { errors } = validateQuoteSet(qs, now);
    expect(errors.join(' ')).toMatch(/duplicate vendor id/);
  });

  it('rejects a quote whose key does not match its skuId', () => {
    const qs = structuredClone(SEED_QUOTE_SET);
    qs.vendors[0].quotes.coffee = { ...qs.vendors[0].quotes.coffee, skuId: 'tea' };
    const { errors } = validateQuoteSet(qs, now);
    expect(errors.join(' ')).toMatch(/does not match/);
  });

  it('rejects a null vendor entry instead of crashing', () => {
    const qs = structuredClone(SEED_QUOTE_SET);
    // @ts-expect-error malformed on purpose
    qs.vendors.push(null);
    const { errors } = validateQuoteSet(qs, now);
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('approval revocation is irreversible', () => {
  const sig = planSignature(SEED_ITEMS, SEED_DEADLINE_DAYS, SEED_QUOTE_SET);

  it('edit → restore must NOT resurrect a revoked approval', () => {
    let a = reduceApprovalOnSignature(null, sig);
    expect(a).toBeNull();
    a = reduceApprovalOnSignature({ signature: sig, approvedAt: 't0' }, sig);
    expect(isApprovalUsable(a, sig)).toBe(true);
    a = reduceApprovalOnSignature(a, 'other-sig');
    expect(a?.revoked).toBe(true);
    expect(isApprovalUsable(a, 'other-sig')).toBe(false);
    // inputs restored — same signature, but the approval stays void
    a = reduceApprovalOnSignature(a, sig);
    expect(isApprovalUsable(a, sig)).toBe(false);
    expect(a?.signature).toBe(sig);
    expect(a?.revoked).toBe(true);
  });
});

describe('export', () => {
  it('CSV escapes commas/quotes/newlines and carries provenance', () => {
    const qs = structuredClone(SEED_QUOTE_SET);
    qs.vendors[0].name = 'Acme, "Inc."\nHoldings';
    // Force the whole basket to the weird-named vendor.
    qs.vendors = [qs.vendors[0]];
    for (const q of Object.values(qs.vendors[0].quotes)) q.unitCents = 1;
    const result = solve({ items: structuredClone(SEED_ITEMS), deadlineDays: 3, quoteSet: qs });
    if (result.status !== 'optimal') throw new Error('expected optimal');
    const computed = {
      result,
      baseline: null,
      sig: planSignature(SEED_ITEMS, 3, qs),
      computedAt: '2026-10-01T00:00:00Z',
      quoteSet: qs,
    };
    const csv = buildExportCsv({
      items: SEED_ITEMS,
      deadline: 3,
      quoteSet: qs,
      computed,
      approval: { signature: computed.sig, approvedAt: '2026-10-01T00:00:01Z' },
    });
    expect(csv).toContain('"Acme, ""Inc.""\nHoldings"');
    expect(csv).toContain('# currency,USD');
    expect(csv).toContain(`# quotes_valid_until,${qs.validUntil}`);
    expect(csv).toContain('# plan_signature,');
  });
});
