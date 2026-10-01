import type { BasketItem, QuoteSet } from './types';

/**
 * Canonical fingerprint of everything that determines the plan: item
 * quantities, deadline, and the full quote set. Approving a plan records this
 * signature; any later input change produces a different signature and voids
 * the approval and the export.
 */
export function planSignature(items: BasketItem[], deadlineDays: number, quoteSet: QuoteSet): string {
  const canon = {
    items: items
      .map((i) => ({ skuId: i.skuId, qty: i.qty }))
      .sort((a, b) => a.skuId.localeCompare(b.skuId)),
    deadlineDays,
    quoteSet: {
      currency: quoteSet.currency,
      quotedAt: quoteSet.quotedAt,
      validUntil: quoteSet.validUntil,
      vendors: quoteSet.vendors
        .map((v) => ({
          id: v.id,
          deliveryDays: v.deliveryDays,
          shippingCents: v.shippingCents,
          freeShipThresholdCents: v.freeShipThresholdCents,
          minOrderCents: v.minOrderCents,
          quotes: Object.keys(v.quotes)
            .sort()
            .map((k) => {
              const q = v.quotes[k];
              return {
                skuId: q.skuId,
                unitCents: q.unitCents,
                stock: q.stock,
                tiers: q.tiers ?? null,
              };
            }),
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    },
  };
  return fnv1a(JSON.stringify(canon));
}

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
