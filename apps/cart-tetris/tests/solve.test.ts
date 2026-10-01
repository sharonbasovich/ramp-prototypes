import { describe, expect, it } from 'vitest';
import { singleVendorBaseline, solve } from '../src/engine/optimize';
import { planSignature } from '../src/engine/signature';
import { SEED_DEADLINE_DAYS, SEED_ITEMS, SEED_QUOTE_SET } from '../src/data/seed';
import type { BasketItem, QuoteSet, Vendor } from '../src/engine/types';

const clone = <T>(x: T): T => structuredClone(x);

const seedInput = () => ({
  items: clone(SEED_ITEMS),
  deadlineDays: SEED_DEADLINE_DAYS,
  quoteSet: clone(SEED_QUOTE_SET),
});

describe('seed fixture (SPEC-CART verified values)', () => {
  it('finds the exact optimum 8150 vs baseline 10100 (reduction 1950)', () => {
    const input = seedInput();
    const res = solve(input);
    expect(res.status).toBe('optimal');
    if (res.status !== 'optimal') return;
    expect(res.plan.totalCents).toBe(8150);

    const baseline = singleVendorBaseline(input);
    expect(baseline?.vendor.id).toBe('quickbox');
    expect(baseline?.order.orderCents).toBe(10100);
    expect(baseline!.order.orderCents - res.plan.totalCents).toBe(1950);
  });

  it('allocates coffee+bars to Bulk Club (6500, free ship) and cups to QuickBox (1650)', () => {
    const res = solve(seedInput());
    expect(res.status).toBe('optimal');
    if (res.status !== 'optimal') return;
    const bulk = res.plan.orders.find((o) => o.vendorId === 'bulk-club')!;
    const qb = res.plan.orders.find((o) => o.vendorId === 'quickbox')!;
    const north = res.plan.orders.find((o) => o.vendorId === 'north-supply')!;
    expect(bulk.itemsCents).toBe(6500);
    expect(bulk.shippingCents).toBe(0);
    expect(bulk.orderCents).toBe(6500);
    expect(qb.itemsCents).toBe(1050);
    expect(qb.shippingCents).toBe(600);
    expect(qb.orderCents).toBe(1650);
    expect(north.itemsCents).toBe(0);
    expect(res.plan.itemsCents).toBe(7550);
    expect(res.plan.shippingCents).toBe(600);
    const alloc = (sku: string, v: string) =>
      res.plan.allocations.find((a) => a.skuId === sku && a.vendorId === v)?.qty ?? 0;
    expect(alloc('coffee', 'bulk-club')).toBe(4);
    expect(alloc('snack-bars', 'bulk-club')).toBe(5);
    expect(alloc('cups', 'quickbox')).toBe(3);
  });

  it('charges shipping only on vendors that are actually used', () => {
    const res = solve(seedInput());
    if (res.status !== 'optimal') throw new Error('expected optimal');
    expect(res.plan.vendorCount).toBe(2);
    expect(res.plan.shippingCents).toBe(600); // only QuickBox ships below threshold
  });
});

describe('deadline handling', () => {
  it('tightening to 1 day excludes the 2-day vendor and removes the bargain', () => {
    const input = seedInput();
    input.deadlineDays = 1;
    const res = solve(input);
    expect(res.status).toBe('optimal');
    if (res.status !== 'optimal') return;
    expect(res.plan.totalCents).toBe(10100);
    expect(res.plan.totalCents).toBeGreaterThan(8150);
    expect(res.plan.allocations.every((a) => a.vendorId !== 'bulk-club')).toBe(true);
  });

  it('an impossible deadline (0 days) is infeasible with reasons', () => {
    const input = seedInput();
    input.deadlineDays = 0;
    const res = solve(input);
    expect(res.status).toBe('infeasible');
    if (res.status !== 'infeasible') return;
    expect(res.reasons.length).toBeGreaterThan(0);
    expect(res.reasons.join(' ')).toMatch(/deliver/);
  });
});

describe('edge cases', () => {
  it('empty basket totals 0', () => {
    const input = seedInput();
    input.items = input.items.map((i) => ({ ...i, qty: 0 }));
    const res = solve(input);
    expect(res.status).toBe('optimal');
    if (res.status !== 'optimal') return;
    expect(res.plan.totalCents).toBe(0);
    expect(res.plan.allocations).toHaveLength(0);
  });

  it('impossible stock (each vendor has 1, need 4-5) is infeasible', () => {
    const input = seedInput();
    for (const v of input.quoteSet.vendors) {
      for (const q of Object.values(v.quotes)) q.stock = 1;
    }
    const res = solve(input);
    expect(res.status).toBe('infeasible');
  });

  it('inclusive threshold equality ships free', () => {
    const input = seedInput();
    // Bulk Club coffee=1500¢: 4×1500=6000 exactly hits 6000 threshold.
    input.quoteSet.vendors[1].quotes.coffee.unitCents = 1500;
    // Force single-vendor-at-bulk check via a synthetic single-sku basket.
    input.items = [{ skuId: 'coffee', name: 'Coffee', detail: 'x', qty: 4 }];
    const res = solve(input);
    expect(res.status).toBe('optimal');
    if (res.status !== 'optimal') return;
    const bulk = res.plan.orders.find((o) => o.vendorId === 'bulk-club');
    // Optimum may pick a different vendor; check baseline-style evaluation:
    const allAtBulk = solve({
      items: input.items,
      deadlineDays: 3,
      quoteSet: {
        ...input.quoteSet,
        vendors: [input.quoteSet.vendors[1]],
      },
    });
    if (allAtBulk.status === 'optimal') {
      expect(allAtBulk.plan.shippingCents).toBe(0);
      expect(allAtBulk.plan.orders[0].freeShipApplied).toBe(true);
    }
    void bulk;
  });

  it('one cent below the threshold still pays shipping', () => {
    const input = seedInput();
    input.items = [{ skuId: 'coffee', name: 'Coffee', detail: 'x', qty: 4 }];
    input.quoteSet.vendors[1].quotes.coffee.unitCents = 1499; // 4×1499 = 5996 < 6000
    const allAtBulk = solve({
      items: input.items,
      deadlineDays: 3,
      quoteSet: { ...input.quoteSet, vendors: [input.quoteSet.vendors[1]] },
    });
    if (allAtBulk.status !== 'optimal') throw new Error('expected optimal');
    expect(allAtBulk.plan.orders[0].itemsCents).toBe(5996);
    expect(allAtBulk.plan.orders[0].shippingCents).toBe(1800);
  });

  it('cheapest unit prices lose to shipping', () => {
    // Vendor A has the cheapest unit price but a large fee; vendor B wins total.
    const vendors: Vendor[] = [
      {
        id: 'cheap-but-far',
        name: 'CheapFar',
        deliveryDays: 1,
        shippingCents: 5000,
        freeShipThresholdCents: null,
        minOrderCents: null,
        quotes: { widget: { skuId: 'widget', unitCents: 100, stock: 10 } },
      },
      {
        id: 'pricey-local',
        name: 'PriceyLocal',
        deliveryDays: 1,
        shippingCents: 100,
        freeShipThresholdCents: null,
        minOrderCents: null,
        quotes: { widget: { skuId: 'widget', unitCents: 300, stock: 10 } },
      },
    ];
    const quoteSet: QuoteSet = { currency: 'USD', quotedAt: '2026-01-01', validUntil: '2027-01-01', vendors };
    const items: BasketItem[] = [{ skuId: 'widget', name: 'Widget', detail: 'x', qty: 2 }];
    const res = solve({ items, deadlineDays: 3, quoteSet });
    if (res.status !== 'optimal') throw new Error('expected optimal');
    // cheap: 200+5000=5200 vs pricey: 600+100=700 → vendor B
    expect(res.plan.totalCents).toBe(700);
    expect(res.plan.allocations[0].vendorId).toBe('pricey-local');
  });

  it('splitting a SKU across vendors can beat single-vendor fills', () => {
    // stock forces a split: each vendor holds 3, need 4.
    const vendors: Vendor[] = [
      {
        id: 'a',
        name: 'A',
        deliveryDays: 1,
        shippingCents: 100,
        freeShipThresholdCents: null,
        minOrderCents: null,
        quotes: { w: { skuId: 'w', unitCents: 100, stock: 3 } },
      },
      {
        id: 'b',
        name: 'B',
        deliveryDays: 1,
        shippingCents: 100,
        freeShipThresholdCents: null,
        minOrderCents: null,
        quotes: { w: { skuId: 'w', unitCents: 100, stock: 3 } },
      },
    ];
    const res = solve({
      items: [{ skuId: 'w', name: 'W', detail: 'x', qty: 4 }],
      deadlineDays: 3,
      quoteSet: { currency: 'USD', quotedAt: '2026-01-01', validUntil: '2027-01-01', vendors },
    });
    if (res.status !== 'optimal') throw new Error('expected optimal');
    expect(res.plan.totalCents).toBe(400 + 200); // 4×100 items + two shipping fees
    expect(res.plan.vendorCount).toBe(2);
  });

  it('minimum order size disqualifies a vendor', () => {
    const vendors: Vendor[] = [
      {
        id: 'min-order',
        name: 'MinOrder',
        deliveryDays: 1,
        shippingCents: 0,
        freeShipThresholdCents: null,
        minOrderCents: 1000,
        quotes: { w: { skuId: 'w', unitCents: 100, stock: 10 } },
      },
      {
        id: 'normal',
        name: 'Normal',
        deliveryDays: 1,
        shippingCents: 500,
        freeShipThresholdCents: null,
        minOrderCents: null,
        quotes: { w: { skuId: 'w', unitCents: 200, stock: 10 } },
      },
    ];
    const res = solve({
      items: [{ skuId: 'w', name: 'W', detail: 'x', qty: 2 }],
      deadlineDays: 3,
      quoteSet: { currency: 'USD', quotedAt: '2026-01-01', validUntil: '2027-01-01', vendors },
    });
    if (res.status !== 'optimal') throw new Error('expected optimal');
    // MinOrder would be 200 (below 1000 min → disqualified); Normal = 400+500 = 900.
    expect(res.plan.totalCents).toBe(900);
    expect(res.plan.allocations[0].vendorId).toBe('normal');
  });

  it('changing quantity genuinely recomputes a different allocation', () => {
    const a = solve(seedInput());
    const input = seedInput();
    input.items[0].qty = 8; // Bulk Club coffee 8×1000=8000 alone ≥6000 → still free ship; bars may move
    const b = solve(input);
    if (a.status !== 'optimal' || b.status !== 'optimal') throw new Error('expected optimal');
    expect(b.plan.totalCents).not.toBe(a.plan.totalCents);
    expect(planSignature(input.items, input.deadlineDays, input.quoteSet)).not.toBe(
      planSignature(SEED_ITEMS, SEED_DEADLINE_DAYS, SEED_QUOTE_SET),
    );
  });
});

describe('determinism', () => {
  it('solves the same input identically twice', () => {
    const a = solve(seedInput());
    const b = solve(seedInput());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
