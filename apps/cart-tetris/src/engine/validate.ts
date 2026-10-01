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

  const seenIds = new Set<string>();
  qs.vendors.forEach((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) {
      errors.push(`vendor #${i + 1}: not an object`);
      return;
    }
    if (typeof v.id === 'string' && v.id) {
      if (seenIds.has(v.id)) errors.push(`duplicate vendor id "${v.id}"`);
      seenIds.add(v.id);
    }
    errors.push(...validateVendor(v, i));
  });

  return errors.length > 0 ? { errors } : { quoteSet: qs as QuoteSet, errors: [] };
}

function validateVendor(v: Vendor, i: number): string[] {
  const errors: string[] = [];
  const label = v && typeof v.name === 'string' && v.name ? v.name : `vendor #${i + 1}`;
  if (typeof v.id !== 'string' || !v.id) errors.push(`${label}: missing id`);
  if (typeof v.name !== 'string' || !v.name) errors.push(`vendor #${i + 1}: missing name`);
  if (!Number.isSafeInteger(v.deliveryDays) || v.deliveryDays < 0) {
    errors.push(`${label}: deliveryDays must be a whole number >= 0`);
  }
  if (!Number.isSafeInteger(v.shippingCents) || v.shippingCents < 0) {
    errors.push(`${label}: shippingCents must be integer cents >= 0`);
  }
  if (v.freeShipThresholdCents != null && (!Number.isSafeInteger(v.freeShipThresholdCents) || v.freeShipThresholdCents < 0)) {
    errors.push(`${label}: freeShipThresholdCents must be integer cents >= 0 or null`);
  }
  if (v.minOrderCents != null && (!Number.isSafeInteger(v.minOrderCents) || v.minOrderCents < 0)) {
    errors.push(`${label}: minOrderCents must be integer cents >= 0 or null`);
  }
  if (typeof v.quotes !== 'object' || v.quotes === null || Array.isArray(v.quotes)) {
    errors.push(`${label}: quotes must be an object keyed by SKU`);
    return errors;
  }
  for (const [skuId, q] of Object.entries(v.quotes)) {
    if (!skuId) {
      errors.push(`${label}: empty SKU key`);
      continue;
    }
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
  if (q.skuId !== skuId) {
    errors.push(`${label} / ${skuId}: quote key does not match skuId ${JSON.stringify(q.skuId)}`);
  }
  if (!Number.isSafeInteger(q.unitCents) || q.unitCents < 0) {
    errors.push(`${label} / ${skuId}: unitCents must be integer cents >= 0`);
  }
  if (!Number.isSafeInteger(q.stock) || q.stock < 0) {
    errors.push(`${label} / ${skuId}: stock must be a whole number >= 0`);
  }
  if (q.tiers != null) {
    if (!Array.isArray(q.tiers)) {
      errors.push(`${label} / ${skuId}: tiers must be an array`);
    } else {
      q.tiers.forEach((t, j) => {
        if (!Number.isSafeInteger(t.minQty) || t.minQty <= 0) {
          errors.push(`${label} / ${skuId} tier ${j + 1}: minQty must be a whole number > 0`);
        }
        if (!Number.isSafeInteger(t.unitCents) || t.unitCents < 0) {
          errors.push(`${label} / ${skuId} tier ${j + 1}: unitCents must be integer cents >= 0`);
        }
      });
    }
  }
  return errors;
}

/** Whole-number only — no decimals, exponents, units, or trailing text. */
function strictInt(raw: string): number | null {
  const s = raw.trim();
  if (!/^-?\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * Minimal CSV: one row per vendor×SKU quote, plus a vendor header row.
 * Strict: numeric cells must be bare integer digits; vendor-level fields
 * (delivery, shipping, thresholds, minimum) and file-level fields (currency,
 * valid_until) must agree on every row of a vendor / every row of the file —
 * conflicting repeats are rejected, never last-row-wins.
 */
export function parseCsvQuoteSet(text: string, now: Date = new Date()): { quoteSet?: QuoteSet; errors: string[] } {
  const errors: string[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  if (lines.length < 2) return { errors: ['CSV needs a header and at least one data row'] };
  const header = lines[0].split(',').map((h) => h.trim());
  const need = [
    'vendor', 'sku', 'unit_cents', 'stock', 'delivery_days', 'shipping_cents',
    'currency', 'quoted_at', 'valid_until',
  ];
  for (const n of need) {
    if (!header.includes(n)) errors.push(`missing column "${n}"`);
  }
  if (errors.length > 0) return { errors };
  const col = (row: string[], name: string) => row[header.indexOf(name)]?.trim() ?? '';

  const reqInt = (row: string[], name: string, label: string): number => {
    const n = strictInt(col(row, name));
    if (n === null) {
      errors.push(`${label}: ${name} must be a whole number (got "${col(row, name)}")`);
      return Number.NaN;
    }
    return n;
  };
  const optInt = (row: string[], name: string, label: string): number | null => {
    const raw = col(row, name);
    if (!raw) return null;
    const n = strictInt(raw);
    if (n === null) errors.push(`${label}: ${name} must be a whole number (got "${raw}")`);
    return n;
  };
  // Field names that must agree across repeated rows of one vendor.
  const VENDOR_FIELDS = ['delivery_days', 'shipping_cents', 'free_threshold_cents', 'min_order_cents'] as const;

  const vendors = new Map<string, Vendor>();
  const vendorNames = new Map<string, string>();
  let currency = '';
  let quotedAt = '';
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
    const priorName = vendorNames.get(id);
    if (priorName !== undefined && priorName !== name) {
      errors.push(`${label}: vendor "${name}" collides with "${priorName}" (same id "${id}")`);
      continue;
    }
    vendorNames.set(id, name);
    const fields = {
      delivery_days: reqInt(row, 'delivery_days', label),
      shipping_cents: reqInt(row, 'shipping_cents', label),
      free_threshold_cents: optInt(row, 'free_threshold_cents', label),
      min_order_cents: optInt(row, 'min_order_cents', label),
    };
    let v = vendors.get(id);
    if (!v) {
      v = {
        id,
        name,
        deliveryDays: fields.delivery_days,
        shippingCents: fields.shipping_cents,
        freeShipThresholdCents: fields.free_threshold_cents,
        minOrderCents: fields.min_order_cents,
        quotes: {},
      };
      vendors.set(id, v);
    } else {
      const cur = {
        delivery_days: v.deliveryDays,
        shipping_cents: v.shippingCents,
        free_threshold_cents: v.freeShipThresholdCents,
        min_order_cents: v.minOrderCents,
      };
      for (const f of VENDOR_FIELDS) {
        if (!Object.is(fields[f], cur[f])) {
          errors.push(`${label}: ${f} "${col(row, f)}" conflicts with "${cur[f] ?? ''}" on earlier ${name} rows`);
        }
      }
    }
    const sku = col(row, 'sku');
    if (!sku) {
      errors.push(`${label}: empty sku`);
      continue;
    }
    if (v.quotes[sku]) {
      errors.push(`${label}: duplicate quote for ${name} / ${sku}`);
      continue;
    }
    const unitCents = reqInt(row, 'unit_cents', label);
    const stock = reqInt(row, 'stock', label);
    if (Number.isSafeInteger(unitCents) && Number.isSafeInteger(stock)) {
      v.quotes[sku] = { skuId: sku, unitCents, stock };
    }
    // File-level provenance is required on every row — never invented.
    const cur = col(row, 'currency');
    if (!cur) {
      errors.push(`${label}: currency is required`);
    } else {
      if (cur !== 'USD') errors.push(`${label}: currency must be USD (got "${cur}")`);
      if (currency && cur !== currency) errors.push(`${label}: currency "${cur}" conflicts with "${currency}"`);
      currency = currency || cur;
    }
    const qa = col(row, 'quoted_at');
    if (!qa) {
      errors.push(`${label}: quoted_at is required`);
    } else if (Number.isNaN(Date.parse(qa))) {
      errors.push(`${label}: quoted_at "${qa}" is not a date`);
    } else {
      if (quotedAt && qa !== quotedAt) {
        errors.push(`${label}: quoted_at "${qa}" conflicts with "${quotedAt}"`);
      }
      quotedAt = quotedAt || qa;
    }
    const vu = col(row, 'valid_until');
    if (!vu) {
      errors.push(`${label}: valid_until is required`);
    } else if (Number.isNaN(Date.parse(vu))) {
      errors.push(`${label}: valid_until "${vu}" is not a date`);
    } else {
      if (new Date(vu) < now) errors.push(`${label}: quote expired on ${vu}`);
      if (validUntil && vu !== validUntil) {
        errors.push(`${label}: valid_until "${vu}" conflicts with "${validUntil}"`);
      }
      validUntil = validUntil || vu;
    }
  }
  if (errors.length > 0) return { errors };
  const qs: QuoteSet = {
    currency,
    quotedAt,
    validUntil,
    vendors: [...vendors.values()],
  };
  return validateQuoteSet(qs, now);
}

export const CSV_TEMPLATE = `# Cart Tetris quote template (example data, USD cents)
vendor,sku,unit_cents,stock,delivery_days,shipping_cents,free_threshold_cents,min_order_cents,currency,quoted_at,valid_until
North Supply,coffee,1200,50,1,1800,,,USD,2026-09-01,2027-01-01
North Supply,cups,400,50,1,1800,,,USD,2026-09-01,2027-01-01
North Supply,snack-bars,600,50,1,1800,,,USD,2026-09-01,2027-01-01
Bulk Club,coffee,1000,50,2,1800,6000,,USD,2026-09-01,2027-01-01
Bulk Club,cups,1500,50,2,1800,6000,,USD,2026-09-01,2027-01-01
Bulk Club,snack-bars,500,50,2,1800,6000,,USD,2026-09-01,2027-01-01
QuickBox,coffee,1300,50,1,600,20000,,USD,2026-09-01,2027-01-01
QuickBox,cups,350,50,1,600,20000,,USD,2026-09-01,2027-01-01
QuickBox,snack-bars,650,50,1,600,20000,,USD,2026-09-01,2027-01-01
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
  return parseCsvQuoteSet(trimmed, now);
}
