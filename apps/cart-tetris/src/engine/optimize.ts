import type {
  Allocation,
  Plan,
  SolveInput,
  SolveResult,
  Vendor,
  VendorOrder,
  VendorSkuQuote,
} from './types';
import { validateQuoteSet } from './validate';

/**
 * Exact bounded basket optimizer.
 *
 * Semantics: each SKU's quantity may be split across vendors in whole units.
 * A vendor is usable for a SKU only when it quotes that SKU, has enough stock
 * for the units allocated, and meets the delivery deadline. A vendor order
 * costs its item subtotal plus its shipping fee, waived when the subtotal
 * reaches the (inclusive) free-shipping threshold; a vendor order below its
 * minimum order size is infeasible and voids the whole allocation.
 *
 * Search: exhaustive enumeration of every per-SKU split (weak compositions of
 * qty into #eligible vendors), so the optimum found is exact within the bound
 * MAX_COMBINATIONS. With 3 SKUs of 12 units and 3 vendors this is 91^3 ~ 0.75M
 * leaf evaluations, comfortably inside the bound. Larger baskets that would
 * exceed the bound return 'boundExceeded' honestly instead of silently
 * degrading to a heuristic.
 *
 * Tie-breaking (fully deterministic): lower total, then fewer vendors used,
 * then lexicographically compare the flattened qty vector over (sku, vendor)
 * pairs preferring plans that place more units on earlier vendors.
 */

export const MAX_COMBINATIONS = 5_000_000;
export const MAX_QTY_PER_SKU = 12;
export const MAX_SKUS = 3;
export const MAX_VENDORS = 4;

export function unitPriceForQty(quote: VendorSkuQuote, qty: number): number {
  if (!quote.tiers || quote.tiers.length === 0) return quote.unitCents;
  let best = quote.unitCents;
  let bestMin = -1;
  for (const t of quote.tiers) {
    if (qty >= t.minQty && t.minQty > bestMin) {
      bestMin = t.minQty;
      best = t.unitCents;
    }
  }
  return best;
}

export function vendorOrderCost(itemsCents: number, vendor: Vendor, used = itemsCents > 0): VendorOrder | null {
  if (!used) {
    return { vendorId: vendor.id, itemsCents: 0, shippingCents: 0, orderCents: 0, freeShipApplied: false };
  }
  if (vendor.minOrderCents != null && itemsCents < vendor.minOrderCents) return null;
  const free =
    vendor.freeShipThresholdCents != null && itemsCents >= vendor.freeShipThresholdCents;
  const shipping = free ? 0 : vendor.shippingCents;
  return {
    vendorId: vendor.id,
    itemsCents,
    shippingCents: shipping,
    orderCents: itemsCents + shipping,
    freeShipApplied: free,
  };
}

/** Weak compositions of n into k parts, emitted in a fixed order. */
function compositions(n: number, k: number): number[][] {
  const out: number[][] = [];
  const cur = new Array<number>(k).fill(0);
  const rec = (i: number, left: number) => {
    if (i === k - 1) {
      cur[i] = left;
      out.push([...cur]);
      return;
    }
    for (let v = 0; v <= left; v++) {
      cur[i] = v;
      rec(i + 1, left - v);
    }
  };
  if (k === 1) return [[n]];
  rec(0, n);
  return out;
}

interface Prepared {
  vendors: Vendor[];
  /** eligible[skuIndex] -> indices into vendors that can serve this SKU */
  eligible: number[][];
  /** splits[skuIndex] -> every composition vector over eligible list */
  splits: number[][][];
  reasons: string[];
  combinations: number;
}

function prepare(input: SolveInput): Prepared | null {
  const { items, deadlineDays, quoteSet } = input;
  const vendors = quoteSet.vendors;
  const reasons: string[] = [];
  const eligible: number[][] = [];
  let combinations = 1;

  const positive = items.filter((it) => it.qty > 0);
  for (const [idx, it] of positive.entries()) {
    if (it.qty > MAX_QTY_PER_SKU) {
      reasons.push(
        `${it.name}: quantity ${it.qty} exceeds the exact-solver bound of ${MAX_QTY_PER_SKU} units per item`,
      );
      continue;
    }
    const serving: number[] = [];
    for (let v = 0; v < vendors.length; v++) {
      const q = vendors[v].quotes[it.skuId];
      if (q != null && q.stock >= 1) serving.push(v);
    }
    if (serving.length === 0) {
      reasons.push(`${it.name}: no vendor quotes this item`);
      continue;
    }
    const onTime = serving.filter((v) => vendors[v].deliveryDays <= deadlineDays);
    if (onTime.length === 0) {
      const fastest = Math.min(...serving.map((v) => vendors[v].deliveryDays));
      reasons.push(
        `${it.name}: no vendor can deliver within ${deadlineDays} day(s) (fastest is ${fastest} day(s))`,
      );
      continue;
    }
    const combinedStock = onTime.reduce((s, v) => s + vendors[v].quotes[it.skuId]!.stock, 0);
    if (combinedStock < it.qty) {
      reasons.push(
        `${it.name}: on-time vendors hold ${combinedStock} units combined, fewer than the ${it.qty} needed`,
      );
      continue;
    }
    eligible[idx] = onTime;
    combinations *= compositions(it.qty, onTime.length).length;
  }

  const splits: Prepared['splits'] = positive.map((it, i) =>
    eligible[i] && eligible[i]!.length > 0 ? compositions(it.qty, eligible[i]!.length) : [],
  );

  return { vendors, eligible, splits, reasons, combinations };
}

function evaluate(
  input: SolveInput,
  prepared: Prepared,
): { best: Plan | null; evaluated: number } {
  const { items } = input;
  const positive = items.filter((it) => it.qty > 0);
  const { vendors, eligible, splits } = prepared;

  // lineCost[i][vendorIdx][qty]
  const lineCost: Map<number, number[]>[] = positive.map((it, i) => {
    const m = new Map<number, number[]>();
    for (const v of eligible[i] ?? []) {
      const q = vendors[v].quotes[it.skuId]!;
      const arr = new Array<number>(it.qty + 1);
      for (let x = 0; x <= it.qty; x++) {
        arr[x] = x <= q.stock ? x * unitPriceForQty(q, x) : Number.POSITIVE_INFINITY;
      }
      m.set(v, arr);
    }
    return m;
  });

  const nV = vendors.length;
  const subs = new Array<number>(nV).fill(0);
  const picks: number[][] = positive.map(() => new Array<number>(nV).fill(0));
  let evaluated = 0;
  let best: Plan | null = null;
  let bestTotal = Number.POSITIVE_INFINITY;
  let bestVendorCount = Number.POSITIVE_INFINITY;
  let bestAllocKey = '';

  const buildPlan = (): Plan => {
    const allocations: Allocation[] = [];
    positive.forEach((it, i) => {
      for (const v of eligible[i] ?? []) {
        const qty = picks[i][v];
        if (qty > 0) {
          const unit = unitPriceForQty(vendors[v].quotes[it.skuId]!, qty);
          allocations.push({
            skuId: it.skuId,
            vendorId: vendors[v].id,
            qty,
            unitCents: unit,
            lineCents: qty * unit,
          });
        }
      }
    });
    const orders: VendorOrder[] = [];
    let shipping = 0;
    let vendorCount = 0;
    for (let v = 0; v < nV; v++) {
      // A vendor is "used" when any units were allocated to it — including
      // zero-priced units, which still ship and still count toward minimums.
      const used = picks.some((p) => p[v] > 0);
      const vo = vendorOrderCost(subs[v], vendors[v], used);
      if (vo == null) throw new Error('unreachable');
      orders.push(vo);
      if (used) {
        vendorCount++;
        shipping += vo.shippingCents;
      }
    }
    const itemsCents = subs.reduce((a, b) => a + b, 0);
    return {
      allocations,
      orders,
      itemsCents,
      shippingCents: shipping,
      totalCents: itemsCents + shipping,
      vendorCount,
    };
  };

  const consider = (): void => {
    evaluated++;
    let itemsCents = 0;
    for (let v = 0; v < nV; v++) {
      const s = subs[v];
      const minOrder = vendors[v].minOrderCents;
      const used = picks.some((p) => p[v] > 0);
      if (used && minOrder != null && s < minOrder) return;
      itemsCents += s;
      if (!Number.isSafeInteger(itemsCents)) return;
    }
    let shipping = 0;
    let vendorCount = 0;
    for (let v = 0; v < nV; v++) {
      const used = picks.some((p) => p[v] > 0);
      if (!used) continue;
      vendorCount++;
      const s = subs[v];
      const threshold = vendors[v].freeShipThresholdCents;
      if (threshold == null || s < threshold) {
        shipping += vendors[v].shippingCents;
      }
    }
    const total = itemsCents + shipping;
    if (!Number.isSafeInteger(total)) return;
    // Deterministic allocation tie-break: iterate (sku, vendor) in fixed
    // order and prefer the plan whose first differing slot has more units,
    // which concentrates the plan toward earlier vendors.
    const allocKey = picks
      .flatMap((p, i) =>
        (eligible[i] ?? []).map((v) => String(MAX_QTY_PER_SKU - p[v]).padStart(2, '0')),
      )
      .join('');
    if (
      best === null ||
      total < bestTotal ||
      (total === bestTotal && vendorCount < bestVendorCount) ||
      (total === bestTotal && vendorCount === bestVendorCount && allocKey < bestAllocKey)
    ) {
      best = buildPlan();
      bestTotal = total;
      bestVendorCount = vendorCount;
      bestAllocKey = allocKey;
    }
  };

  const rec = (i: number): void => {
    if (i === positive.length) {
      consider();
      return;
    }
    for (const comp of splits[i]) {
      let feasible = true;
      for (let e = 0; e < comp.length; e++) {
        const v = eligible[i]![e];
        const qty = comp[e];
        picks[i][v] = qty;
        if (qty > 0) {
          const cost = lineCost[i].get(v)![qty];
          if (!Number.isFinite(cost)) feasible = false;
          else subs[v] += cost;
        }
      }
      if (feasible) rec(i + 1);
      for (let e = 0; e < comp.length; e++) {
        const v = eligible[i]![e];
        const qty = comp[e];
        if (qty > 0) {
          const cost = lineCost[i].get(v)![qty];
          if (Number.isFinite(cost)) subs[v] -= cost;
        }
        picks[i][v] = 0;
      }
    }
  };
  rec(0);

  return { best, evaluated };
}

export function solve(input: SolveInput, now: Date = new Date()): SolveResult {
  const { items, quoteSet } = input;
  const positive = items.filter((it) => it.qty > 0);

  // Quotes are revalidated at solve time (not just at import): expired or
  // malformed sets must never produce a plan.
  const { errors: quoteErrors } = validateQuoteSet(input.quoteSet, now);
  if (quoteErrors.length > 0) {
    return { status: 'infeasible', reasons: quoteErrors.map((e) => `quotes invalid: ${e}`) };
  }

  const errors = validateBasics(input);
  if (errors.length > 0) return { status: 'infeasible', reasons: errors };

  if (positive.length === 0) {
    return {
      status: 'optimal',
      evaluated: 1,
      plan: { allocations: [], orders: [], itemsCents: 0, shippingCents: 0, totalCents: 0, vendorCount: 0 },
    };
  }
  if (positive.length > MAX_SKUS || quoteSet.vendors.length > MAX_VENDORS) {
    return {
      status: 'infeasible',
      reasons: [
        `Exact solver bound: at most ${MAX_SKUS} items and ${MAX_VENDORS} vendors (got ${positive.length} items, ${quoteSet.vendors.length} vendors)`,
      ],
    };
  }

  const prepared = prepare(input);
  if (!prepared) return { status: 'infeasible', reasons: ['could not prepare solver input'] };
  if (prepared.reasons.length > 0 && prepared.eligible.some((e) => !e || e.length === 0)) {
    return { status: 'infeasible', reasons: prepared.reasons };
  }
  if (prepared.combinations > MAX_COMBINATIONS) {
    return { status: 'boundExceeded', combinations: prepared.combinations, limit: MAX_COMBINATIONS };
  }

  const { best, evaluated } = evaluate(input, prepared);
  if (!best) {
    return {
      status: 'infeasible',
      reasons:
        prepared.reasons.length > 0
          ? prepared.reasons
          : ['No allocation satisfies the deadline, stock, and minimum-order constraints'],
    };
  }
  return { status: 'optimal', plan: best, evaluated };
}

function validateBasics(input: SolveInput): string[] {
  const errs: string[] = [];
  const seen = new Set<string>();
  for (const it of input.items) {
    if (!Number.isSafeInteger(it.qty) || it.qty < 0) errs.push(`${it.name}: quantity must be a whole number >= 0`);
    if (seen.has(it.skuId)) errs.push(`${it.name}: duplicate item ${it.skuId}`);
    seen.add(it.skuId);
  }
  if (!Number.isSafeInteger(input.deadlineDays) || input.deadlineDays < 0) {
    errs.push('deadline must be a whole number of days >= 0');
  }
  for (const v of input.quoteSet.vendors) {
    if (!Number.isSafeInteger(v.shippingCents) || v.shippingCents < 0) errs.push(`${v.name}: invalid shipping fee`);
    if (!Number.isSafeInteger(v.deliveryDays) || v.deliveryDays < 0) errs.push(`${v.name}: invalid delivery time`);
  }
  return errs;
}

/** Cheapest plan that sources the whole basket from a single vendor. */
export function singleVendorBaseline(input: SolveInput): { vendor: Vendor; order: VendorOrder } | null {
  const { items, deadlineDays, quoteSet } = input;
  const positive = items.filter((it) => it.qty > 0);
  if (positive.length === 0) return null;
  let best: { vendor: Vendor; order: VendorOrder } | null = null;
  for (const v of quoteSet.vendors) {
    if (v.deliveryDays > deadlineDays) continue;
    let itemsCents = 0;
    let ok = true;
    for (const it of positive) {
      const q = v.quotes[it.skuId];
      if (!q || q.stock < it.qty) {
        ok = false;
        break;
      }
      itemsCents += it.qty * unitPriceForQty(q, it.qty);
    }
    if (!ok) continue;
    const order = vendorOrderCost(itemsCents, v, true);
    if (!order) continue;
    if (!best || order.orderCents < best.order.orderCents) best = { vendor: v, order };
  }
  return best;
}
