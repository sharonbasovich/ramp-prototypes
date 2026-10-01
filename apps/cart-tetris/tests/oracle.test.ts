import { describe, expect, it } from 'vitest';
import { solve } from '../src/engine/optimize';
import { oracleSolve } from '../src/engine/oracle';
import type { BasketItem, QuoteSet, Vendor } from '../src/engine/types';

/** Deterministic PRNG (mulberry32) so the fuzz is reproducible. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomInput(rand: () => number, caseNo: number) {
  const nV = 2 + Math.floor(rand() * 2); // 2-3 vendors
  const skus = ['a', 'b', 'c'].slice(0, 1 + Math.floor(rand() * 3));
  const vendors: Vendor[] = [];
  for (let v = 0; v < nV; v++) {
    const quotes: Vendor['quotes'] = {};
    for (const s of skus) {
      if (rand() < 0.15) continue; // occasionally a vendor doesn't quote a SKU
      quotes[s] = {
        skuId: s,
        unitCents: 100 + Math.floor(rand() * 2000),
        stock: 1 + Math.floor(rand() * 8),
        tiers:
          rand() < 0.25
            ? [
                { minQty: 2 + Math.floor(rand() * 3), unitCents: 50 + Math.floor(rand() * 800) },
              ]
            : undefined,
      };
    }
    vendors.push({
      id: `v${v}-${caseNo}`,
      name: `V${v}`,
      deliveryDays: 1 + Math.floor(rand() * 3),
      shippingCents: Math.floor(rand() * 2500),
      freeShipThresholdCents: rand() < 0.5 ? 1000 + Math.floor(rand() * 9000) : null,
      minOrderCents: rand() < 0.2 ? 500 + Math.floor(rand() * 3000) : null,
      quotes,
    });
  }
  const items: BasketItem[] = skus.map((s) => ({
    skuId: s,
    name: s,
    detail: 'x',
    qty: 1 + Math.floor(rand() * 4), // small: 1-4 units
  }));
  const quoteSet: QuoteSet = {
    currency: 'USD',
    quotedAt: '2026-01-01',
    validUntil: '2099-01-01',
    vendors,
  };
  return { items, deadlineDays: 1 + Math.floor(rand() * 4), quoteSet };
}

describe('independent brute-force oracle cross-check', () => {
  it('solver total equals oracle optimum on 150 random small cases', () => {
    const rand = rng(0xC0FFEE);
    let optimal = 0;
    let infeasible = 0;
    for (let i = 0; i < 150; i++) {
      const input = randomInput(rand, i);
      const res = solve(input);
      const oracle = oracleSolve(input);
      if (oracle === null) {
        expect(res.status).toBe('infeasible');
        infeasible++;
      } else {
        expect(res.status).toBe('optimal');
        if (res.status === 'optimal') {
          expect(res.plan.totalCents).toBe(oracle.plan.totalCents);
          optimal++;
        }
      }
    }
    // Sanity: both branches actually exercised.
    expect(optimal).toBeGreaterThan(60);
    expect(infeasible).toBeGreaterThan(0);
  });

  it('agrees on the seed fixture', async () => {
    const { SEED_DEADLINE_DAYS, SEED_ITEMS, SEED_QUOTE_SET } = await import('../src/data/seed');
    const input = {
      items: structuredClone(SEED_ITEMS),
      deadlineDays: SEED_DEADLINE_DAYS,
      quoteSet: structuredClone(SEED_QUOTE_SET),
    };
    const res = solve(input);
    const oracle = oracleSolve(input);
    expect(oracle).not.toBeNull();
    if (res.status === 'optimal') expect(res.plan.totalCents).toBe(oracle!.plan.totalCents);
  });
});
