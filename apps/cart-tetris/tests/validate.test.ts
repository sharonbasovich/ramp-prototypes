import { describe, expect, it } from 'vitest';
import { CSV_TEMPLATE, parseCsvQuoteSet, parseQuoteImport, validateQuoteSet } from '../src/engine/validate';
import { planSignature } from '../src/engine/signature';
import { SEED_DEADLINE_DAYS, SEED_ITEMS, SEED_QUOTE_SET } from '../src/data/seed';
import { solve } from '../src/engine/optimize';

const seed = () => structuredClone(SEED_QUOTE_SET);
const now = new Date('2026-10-01T00:00:00Z');

describe('quote set validation', () => {
  it('accepts the seed fixture', () => {
    const { errors } = validateQuoteSet(seed(), now);
    expect(errors).toEqual([]);
  });

  it('rejects expired quotes', () => {
    const qs = seed();
    qs.validUntil = '2020-01-01';
    const { errors, quoteSet } = validateQuoteSet(qs, now);
    expect(quoteSet).toBeUndefined();
    expect(errors.join(' ')).toMatch(/expired/);
  });

  it('rejects non-USD currency', () => {
    const qs = seed();
    qs.currency = 'EUR';
    const { errors } = validateQuoteSet(qs, now);
    expect(errors.join(' ')).toMatch(/USD/);
  });

  it('rejects non-finite / fractional / negative values', () => {
    const qs = seed();
    qs.vendors[0].shippingCents = Number.NaN as unknown as number;
    qs.vendors[1].deliveryDays = 1.5;
    qs.vendors[2].quotes.coffee.unitCents = -50;
    const { errors, quoteSet } = validateQuoteSet(qs, now);
    expect(quoteSet).toBeUndefined();
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });

  it('rejects missing prices (malformed quote)', () => {
    const qs = seed();
    // @ts-expect-error intentionally malformed
    qs.vendors[0].quotes.coffee = { skuId: 'coffee' };
    const { errors } = validateQuoteSet(qs, now);
    expect(errors.join(' ')).toMatch(/unitCents/);
  });
});

describe('import', () => {
  it('round-trips the CSV template into a valid quote set', () => {
    const { quoteSet, errors } = parseCsvQuoteSet(CSV_TEMPLATE);
    expect(errors).toEqual([]);
    expect(quoteSet?.vendors).toHaveLength(3);
    expect(quoteSet?.vendors.find((v) => v.id === 'bulk-club')?.freeShipThresholdCents).toBe(6000);
  });

  it('rejects a CSV missing required columns before replacing data', () => {
    const { errors, quoteSet } = parseCsvQuoteSet('vendor,sku\nA,x\n');
    expect(quoteSet).toBeUndefined();
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects invalid JSON cleanly', () => {
    const { errors } = parseQuoteImport('{not json', now);
    expect(errors[0]).toMatch(/invalid JSON/);
  });

  it('an imported price change genuinely alters the optimized result', () => {
    const base = solve({
      items: structuredClone(SEED_ITEMS),
      deadlineDays: SEED_DEADLINE_DAYS,
      quoteSet: seed(),
    });
    const changed = seed();
    changed.vendors[0].quotes.coffee.unitCents = 500; // North Supply coffee halves
    const res = solve({
      items: structuredClone(SEED_ITEMS),
      deadlineDays: SEED_DEADLINE_DAYS,
      quoteSet: changed,
    });
    if (base.status !== 'optimal' || res.status !== 'optimal') throw new Error('expected optimal');
    expect(res.plan.totalCents).not.toBe(base.plan.totalCents);
  });
});

describe('approval signature invalidation', () => {
  it('any input change produces a different signature', () => {
    const sig = planSignature(structuredClone(SEED_ITEMS), SEED_DEADLINE_DAYS, seed());
    const qtyChanged = structuredClone(SEED_ITEMS);
    qtyChanged[0].qty++;
    expect(planSignature(qtyChanged, SEED_DEADLINE_DAYS, seed())).not.toBe(sig);
    expect(planSignature(structuredClone(SEED_ITEMS), 1, seed())).not.toBe(sig);
    const priceChanged = seed();
    priceChanged.vendors[0].quotes.coffee.unitCents++;
    expect(planSignature(structuredClone(SEED_ITEMS), SEED_DEADLINE_DAYS, priceChanged)).not.toBe(sig);
  });

  it('identical inputs produce an identical signature', () => {
    expect(planSignature(structuredClone(SEED_ITEMS), SEED_DEADLINE_DAYS, seed())).toBe(
      planSignature(structuredClone(SEED_ITEMS), SEED_DEADLINE_DAYS, seed()),
    );
  });
});
