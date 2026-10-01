import type { Plan, SolveInput, VendorOrder } from './types';
import { vendorOrderCost } from './optimize';

/**
 * Independent brute-force oracle used ONLY by tests to cross-check the main
 * solver. It assigns every unit of every SKU to a vendor one unit at a time
 * (v^q per SKU, product over SKUs) instead of enumerating compositions, so it
 * shares no enumeration code with the optimizer. Intended for small cases.
 */
export function oracleSolve(input: SolveInput): { plan: Plan; evaluated: number } | null {
  const { items, deadlineDays, quoteSet } = input;
  const vendors = quoteSet.vendors;
  const positive = items.filter((it) => it.qty > 0);
  let evaluated = 0;
  const found: { best: { key: string; plan: Plan } | null } = { best: null };

  interface Unit {
    skuIdx: number;
    unit: number;
  }
  const units: Unit[] = [];
  positive.forEach((it, i) => {
    for (let u = 0; u < it.qty; u++) units.push({ skuIdx: i, unit: u });
  });

  const assignment = new Array<number>(units.length).fill(0);

  const tryEval = (): void => {
    evaluated++;
    const subs = new Array<number>(vendors.length).fill(0);
    const counts = positive.map(() => new Array<number>(vendors.length).fill(0));
    for (let u = 0; u < units.length; u++) {
      const v = assignment[u];
      const it = positive[units[u].skuIdx];
      const q = vendors[v].quotes[it.skuId];
      if (!q) return;
      counts[units[u].skuIdx][v]++;
      if (counts[units[u].skuIdx][v] > q.stock) return;
    }
    // Flat-rate pricing of the final per-vendor quantity (same semantics as
    // the solver, computed independently here).
    positive.forEach((it, i) => {
      for (let v = 0; v < vendors.length; v++) {
        const qty = counts[i][v];
        if (qty === 0) continue;
        const q = vendors[v].quotes[it.skuId]!;
        let unit = q.unitCents;
        if (q.tiers) {
          let m = -1;
          for (const t of q.tiers) if (qty >= t.minQty && t.minQty > m) {
            m = t.minQty;
            unit = t.unitCents;
          }
        }
        subs[v] += qty * unit;
      }
    });
    for (let v = 0; v < vendors.length; v++) {
      if (vendors[v].deliveryDays > deadlineDays && counts.some((c) => c[v] > 0)) return;
      const mo = vendors[v].minOrderCents;
      if (subs[v] > 0 && mo != null && subs[v] < mo) return;
    }
    const orders: VendorOrder[] = [];
    let shipping = 0;
    let vendorCount = 0;
    vendors.forEach((v, i) => {
      const vo = vendorOrderCost(subs[i], v)!;
      orders.push(vo);
      if (vo.itemsCents > 0) {
        vendorCount++;
        shipping += vo.shippingCents;
      }
    });
    const itemsCents = subs.reduce((a, b) => a + b, 0);
    const total = itemsCents + shipping;
    // Same deterministic ordering as the solver: total, vendor count.
    const key = `${String(total).padStart(9, '0')}|${String(vendorCount).padStart(2, '0')}`;
    if (found.best === null || key < found.best.key) {
      const allocations = counts
        .flatMap((c, i) =>
          c
            .map((qty, v) => ({ it: positive[i], v, qty }))
            .filter((a) => a.qty > 0),
        )
        .map((a) => {
          const q = vendors[a.v].quotes[a.it.skuId]!;
          let unit = q.unitCents;
          if (q.tiers) {
            let m = -1;
            for (const t of q.tiers) if (a.qty >= t.minQty && t.minQty > m) {
              m = t.minQty;
              unit = t.unitCents;
            }
          }
          return {
            skuId: a.it.skuId,
            vendorId: vendors[a.v].id,
            qty: a.qty,
            unitCents: unit,
            lineCents: a.qty * unit,
          };
        });
      found.best = {
        key,
        plan: {
          allocations,
          orders,
          itemsCents,
          shippingCents: shipping,
          totalCents: total,
          vendorCount,
        },
      };
    }
  };

  const rec = (u: number): void => {
    if (u === units.length) {
      tryEval();
      return;
    }
    for (let v = 0; v < vendors.length; v++) {
      assignment[u] = v;
      rec(u + 1);
    }
  };
  rec(0);

  const b = found.best;
  return b ? { plan: b.plan, evaluated } : null;
}
