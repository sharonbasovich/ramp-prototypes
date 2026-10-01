export interface PriceTier {
  /** Applies when units bought from this vendor for this SKU >= minQty. */
  minQty: number;
  unitCents: number;
}

export interface VendorSkuQuote {
  skuId: string;
  /** Base unit price in integer cents. */
  unitCents: number;
  /** Units the vendor can supply of this SKU. */
  stock: number;
  /**
   * Optional volume tiers. When present, the applicable tier is the one with
   * the largest minQty <= units allocated to this vendor for this SKU; if no
   * tier qualifies, unitCents applies.
   */
  tiers?: PriceTier[];
}

export interface Vendor {
  id: string;
  name: string;
  /** Calendar days until delivery. Orders miss the deadline if this exceeds it. */
  deliveryDays: number;
  /** Fee charged once per vendor order that ships below its free threshold. */
  shippingCents: number;
  /** Inclusive item-subtotal threshold for free shipping; null = never free. */
  freeShipThresholdCents: number | null;
  /** Minimum item subtotal required to place an order; null = no minimum. */
  minOrderCents: number | null;
  quotes: Record<string, VendorSkuQuote>;
}

export interface QuoteSet {
  /** Only 'USD' is accepted; anything else is rejected. */
  currency: string;
  /** ISO date strings; expired sets (now > validUntil) are rejected. */
  quotedAt: string;
  validUntil: string;
  vendors: Vendor[];
}

export interface BasketItem {
  skuId: string;
  name: string;
  detail: string;
  qty: number;
}

export interface Allocation {
  skuId: string;
  vendorId: string;
  qty: number;
  unitCents: number;
  lineCents: number;
}

export interface VendorOrder {
  vendorId: string;
  itemsCents: number;
  shippingCents: number;
  orderCents: number;
  freeShipApplied: boolean;
}

export interface Plan {
  allocations: Allocation[];
  orders: VendorOrder[];
  itemsCents: number;
  shippingCents: number;
  totalCents: number;
  vendorCount: number;
}

export type SolveResult =
  | { status: 'optimal'; plan: Plan; evaluated: number }
  | { status: 'infeasible'; reasons: string[] }
  | { status: 'boundExceeded'; combinations: number; limit: number };

export interface SolveInput {
  items: BasketItem[];
  deadlineDays: number;
  quoteSet: QuoteSet;
}
