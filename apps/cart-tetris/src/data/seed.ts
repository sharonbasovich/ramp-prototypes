import type { BasketItem, QuoteSet } from '../engine/types';

/**
 * Seed fixture from SPEC-CART.md — verified arithmetic (the generated concept
 * image contains incorrect allocations and prices and is not a data source).
 * These are example pretax quotes in USD cents; no tax is modeled.
 */
export const SKU_CATALOG: Array<{ skuId: string; name: string; detail: string }> = [
  { skuId: 'coffee', name: 'Coffee', detail: '12 oz bag' },
  { skuId: 'cups', name: 'Cups', detail: '8 oz, pack' },
  { skuId: 'snack-bars', name: 'Snack bars', detail: 'Variety pack' },
];

export const SEED_ITEMS: BasketItem[] = [
  { skuId: 'coffee', name: 'Coffee', detail: '12 oz bag', qty: 4 },
  { skuId: 'cups', name: 'Cups', detail: '8 oz, pack', qty: 3 },
  { skuId: 'snack-bars', name: 'Snack bars', detail: 'Variety pack', qty: 5 },
];

export const SEED_DEADLINE_DAYS = 3;

export const SEED_QUOTE_SET: QuoteSet = {
  currency: 'USD',
  quotedAt: '2026-09-01',
  validUntil: '2027-01-01',
  vendors: [
    {
      id: 'north-supply',
      name: 'North Supply',
      deliveryDays: 1,
      shippingCents: 1800,
      freeShipThresholdCents: null,
      minOrderCents: null,
      quotes: {
        coffee: { skuId: 'coffee', unitCents: 1200, stock: 50 },
        cups: { skuId: 'cups', unitCents: 400, stock: 50 },
        'snack-bars': { skuId: 'snack-bars', unitCents: 600, stock: 50 },
      },
    },
    {
      id: 'bulk-club',
      name: 'Bulk Club',
      deliveryDays: 2,
      shippingCents: 1800,
      freeShipThresholdCents: 6000,
      minOrderCents: null,
      quotes: {
        coffee: { skuId: 'coffee', unitCents: 1000, stock: 50 },
        cups: { skuId: 'cups', unitCents: 1500, stock: 50 },
        'snack-bars': { skuId: 'snack-bars', unitCents: 500, stock: 50 },
      },
    },
    {
      id: 'quickbox',
      name: 'QuickBox',
      deliveryDays: 1,
      shippingCents: 600,
      freeShipThresholdCents: 20000,
      minOrderCents: null,
      quotes: {
        coffee: { skuId: 'coffee', unitCents: 1300, stock: 50 },
        cups: { skuId: 'cups', unitCents: 350, stock: 50 },
        'snack-bars': { skuId: 'snack-bars', unitCents: 650, stock: 50 },
      },
    },
  ],
};

/** Expected fixture outcomes (from SPEC-CART.md, verified). */
export const SEED_EXPECTED = {
  baselineCents: 10100,
  baselineVendor: 'quickbox',
  optimumCents: 8150,
  reductionCents: 1950,
};
