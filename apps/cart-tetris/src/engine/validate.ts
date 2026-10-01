import type { QuoteSet, Vendor, VendorSkuQuote } from './types';

/**
 * Structural + semantic validation for imported quote data. Returns a list of
 * human-readable errors; an empty list means the QuoteSet is safe to install.
 * Validation happens entirely before any existing data is replaced.
 */
export function validateQuoteSet(raw: unknown, now: Date = new Date()): { quoteSet?: QuoteSet; errors: string[] } {
  const errors: string[] = [];
  if (typeof raw !== 'object' || raw === null) return { errors: ['quote file is not an object'] };
  const qs = raw as Partial<QuoteSet>;

  if (qs.currency !== 'USD') errors.push(`currency must be USD (got ${JSON.stringify(qs.currency)})`);
  if (typeof qs.quotedAt !== 'string' || Number.isNaN(Date.parse(qs.quotedAt))) {
    errors.push('quotedAt must be an ISO date string');
  }
  if (typeof qs.validUntil !== 'string' || Number.isNaN(Date.parse(qs.validUntil))) {
    errors.push('validUntil must be an ISO date string');
  } else if (new Date(qs.validUntil) < now) {
    errors.push(`quotes expired on ${qs.validUntil}`);
  }

  if (!Array.isArray(qs.vendors) || qs.vendors.length === 0) {
    errors.push('vendors must be a non-empty array');
    return { errors };
  }

  qs.vendors.forEach((v, i) => {
    errors.push(...validateVendor(v, i));
  });

  return errors.length > 0 ? { errors } : { quoteSet: qs as QuoteSet, errors: [] };
}

function validateVendor(v: Vendor, i: number): string[] {
  const errors: string[] = [];
  const label = v && typeof v.name === 'string' && v.name ? v.name : `vendor #${i + 1}`;
  if (typeof v.id !== 'string' || !v.id) errors.push(`${label}: missing id`);
  if (typeof v.name !== 'string' || !v.name) errors.push(`vendor #${i + 1}: missing name`);
  if (!Number.isInteger(v.deliveryDays) || v.deliveryDays < 0) {
    errors.push(`${label}: deliveryDays must be a whole number >= 0`);
  }
  if (!Number.isInteger(v.shippingCents) || v.shippingCents < 0) {
    errors.push(`${label}: shippingCents must be integer cents >= 0`);
  }
  if (v.freeShipThresholdCents != null && (!Number.isInteger(v.freeShipThresholdCents) || v.freeShipThresholdCents < 0)) {
    errors.push(`${label}: freeShipThresholdCents must be integer cents >= 0 or null`);
  }
  if (v.minOrderCents != null && (!Number.isInteger(v.minOrderCents) || v.minOrderCents < 0)) {
    errors.push(`${label}: minOrderCents must be integer cents >= 0 or null`);
  }
  if (typeof v.quotes !== 'object' || v.quotes === null || Array.isArray(v.quotes)) {
    errors.push(`${label}: quotes must be an object keyed by SKU`);
    return errors;
  }
  for (const [skuId, q] of Object.entries(v.quotes)) {
    errors.push(...validateQuote(label, skuId, q));
  }
  return errors;
}

function validateQuote(label: string, skuId: string, q: VendorSkuQuote): string[] {
  const errors: string[] = [];
  if (typeof q !== 'object' || q === null) {
    errors.push(`${label} / ${skuId}: quote is not an object`);
    return errors;
  }
  if (!Number.isInteger(q.unitCents) || q.unitCents < 0) {
    errors.push(`${label} / ${skuId}: unitCents must be integer cents >= 0`);
  }
  if (!Number.isInteger(q.stock) || q.stock < 0) {
    errors.push(`${label} / ${skuId}: stock must be a whole number >= 0`);
  }
  if (q.tiers != null) {
    if (!Array.isArray(q.tiers)) {
      errors.push(`${label} / ${skuId}: tiers must be an array`);
    } else {
      q.tiers.forEach((t, j) => {
        if (!Number.isInteger(t.minQty) || t.minQty <= 0) {
          errors.push(`${label} / ${skuId} tier ${j + 1}: minQty must be a whole number > 0`);
        }
        if (!Number.isInteger(t.unitCents) || t.unitCents < 0) {
          errors.push(`${label} / ${skuId} tier ${j + 1}: unitCents must be integer cents >= 0`);
        }
      });
    }
  }
  return errors;
}

/** Minimal CSV: one row per vendor×SKU quote, plus a vendor header row. */
export function parseCsvQuoteSet(text: string): { quoteSet?: QuoteSet; errors: string[] } {
  const errors: string[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  if (lines.length < 2) return { errors: ['CSV needs a header and at least one data row'] };
  const header = lines[0].split(',').map((h) => h.trim());
  const need = ['vendor', 'sku', 'unit_cents', 'stock', 'delivery_days', 'shipping_cents'];
  for (const n of need) {
    if (!header.includes(n)) errors.push(`missing column "${n}"`);
  }
  if (errors.length > 0) return { errors };
  const col = (row: string[], name: string) => row[header.indexOf(name)]?.trim() ?? '';

  const vendors = new Map<string, Vendor>();
  let currency = 'USD';
  let validUntil = '';
  for (const [i, line] of lines.slice(1).entries()) {
    const row = line.split(',');
    const label = `row ${i + 2}`;
    const name = col(row, 'vendor');
    if (!name) {
      errors.push(`${label}: empty vendor`);
      continue;
    }
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    let v = vendors.get(id);
    if (!v) {
      v = {
        id,
        name,
        deliveryDays: parseInt(col(row, 'delivery_days'), 10),
        shippingCents: parseInt(col(row, 'shipping_cents'), 10),
        freeShipThresholdCents: col(row, 'free_threshold_cents')
          ? parseInt(col(row, 'free_threshold_cents'), 10)
          : null,
        minOrderCents: col(row, 'min_order_cents') ? parseInt(col(row, 'min_order_cents'), 10) : null,
        quotes: {},
      };
      vendors.set(id, v);
    }
    const sku = col(row, 'sku');
    if (!sku) {
      errors.push(`${label}: empty sku`);
      continue;
    }
    const unitCents = parseInt(col(row, 'unit_cents'), 10);
    const stock = parseInt(col(row, 'stock'), 10);
    if (!Number.isFinite(unitCents)) errors.push(`${label}: bad unit_cents`);
    if (!Number.isFinite(stock)) errors.push(`${label}: bad stock`);
    v.quotes[sku] = { skuId: sku, unitCents, stock };
    if (col(row, 'currency')) currency = col(row, 'currency');
    if (col(row, 'valid_until')) validUntil = col(row, 'valid_until');
  }
  if (errors.length > 0) return { errors };
  const qs: QuoteSet = {
    currency,
    quotedAt: new Date().toISOString(),
    validUntil: validUntil || new Date(Date.now() + 30 * 86400e3).toISOString().slice(0, 10),
    vendors: [...vendors.values()],
  };
  return validateQuoteSet(qs);
}

export const CSV_TEMPLATE = `# Cart Tetris quote template (example data, USD cents)
vendor,sku,unit_cents,stock,delivery_days,shipping_cents,free_threshold_cents,min_order_cents,currency,valid_until
North Supply,coffee,1200,50,1,1800,,,USD,2027-01-01
North Supply,cups,400,50,1,1800,,,USD,2027-01-01
North Supply,snack-bars,600,50,1,1800,,,USD,2027-01-01
Bulk Club,coffee,1000,50,2,1800,6000,,USD,2027-01-01
Bulk Club,cups,1500,50,2,1800,6000,,USD,2027-01-01
Bulk Club,snack-bars,500,50,2,1800,6000,,USD,2027-01-01
QuickBox,coffee,1300,50,1,600,20000,,USD,2027-01-01
QuickBox,cups,350,50,1,600,20000,,USD,2027-01-01
QuickBox,snack-bars,650,50,1,600,20000,,USD,2027-01-01
`;

export function parseQuoteImport(text: string, now: Date = new Date()): { quoteSet?: QuoteSet; errors: string[] } {
  const trimmed = text.trim();
  if (!trimmed) return { errors: ['empty import'] };
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return validateQuoteSet(JSON.parse(trimmed), now);
    } catch (e) {
      return { errors: [`invalid JSON: ${(e as Error).message}`] };
    }
  }
  return parseCsvQuoteSet(trimmed);
}
