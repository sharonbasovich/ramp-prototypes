import { describe, expect, it } from 'vitest';
import { solve } from '../src/engine/optimize';
import { parseQuoteImport } from '../src/engine/validate';
import type { QuoteSet, Vendor, VendorSkuQuote } from '../src/engine/types';
let seed = 12345; const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
const price = (q: VendorSkuQuote, k: number) => { let b = q.unitCents, m = -1; for (const t of q.tiers ?? []) if (k >= t.minQty && t.minQty > m) { m = t.minQty; b = t.unitCents; } return b; };
function brute(items: { skuId: string; qty: number }[], deadline: number, vs: Vendor[]): number | null {
  const ok = vs.filter((v) => v.deliveryDays <= deadline);
  let best: number | null = null; const alloc: number[][] = items.map(() => ok.map(() => 0));
  const rec = (s: number) => {
    if (s === items.length) {
      let tot = 0;
      for (let j = 0; j < ok.length; j++) {
        const v = ok[j]; let used = false, it = 0;
        items.forEach((x, i) => { const k = alloc[i][j]; if (k > 0) { used = true; it += k * price(v.quotes[x.skuId], k); } });
        if (!used) continue;
        if (v.minOrderCents != null && it < v.minOrderCents) return;
        tot += it + (v.freeShipThresholdCents != null && it >= v.freeShipThresholdCents ? 0 : v.shippingCents);
      }
      if (best === null || tot < best) best = tot; return;
    }
    const dist = (j: number, left: number) => {
      if (j === ok.length) { if (left === 0) rec(s + 1); return; }
      const q = ok[j].quotes[items[s].skuId]; const cap = q ? Math.min(q.stock, left) : 0;
      for (let k = 0; k <= cap; k++) { alloc[s][j] = k; dist(j + 1, left - k); } alloc[s][j] = 0;
    };
    dist(0, items[s].qty);
  };
  rec(0); return best;
}
describe('reviewer independent oracle (zero prices, minimums, tiers, deadlines)', () => {
  it('matches 600 random cases', () => {
    let mism = 0; const bad: string[] = [];
    for (let c = 0; c < 600; c++) {
      const skus = ['a', 'b', 'c'].slice(0, 1 + rnd(3));
      const vendors: Vendor[] = Array.from({ length: 2 + rnd(2) }, (_, j) => ({
        id: 'v' + j, name: 'V' + j, deliveryDays: 1 + rnd(4), shippingCents: rnd(3) * 300,
        freeShipThresholdCents: rnd(2) ? null : rnd(4) * 500, minOrderCents: rnd(3) ? null : rnd(4) * 400,
        quotes: Object.fromEntries(skus.filter(() => rnd(5) > 0).map((s) => [s, { skuId: s, unitCents: rnd(3) === 0 ? 0 : 50 * (1 + rnd(10)), stock: rnd(6), ...(rnd(4) === 0 ? { tiers: [{ minQty: 2 + rnd(2), unitCents: rnd(200) }] } : {}) }])),
      }));
      const items = skus.map((s) => ({ skuId: s, name: s, detail: 'x', qty: rnd(5) }));
      const deadline = 1 + rnd(4);
      const qs: QuoteSet = { currency: 'USD', quotedAt: '2026-09-01', validUntil: '2099-01-01', vendors };
      const r = solve({ items, deadlineDays: deadline, quoteSet: qs }, new Date('2026-10-01T00:00:00Z'));
      const exp = brute(items, deadline, vendors);
      const got = r.status === 'optimal' ? r.plan.totalCents : r.status === 'infeasible' ? null : 'bound';
      if (got !== exp) { mism++; if (bad.length < 5) bad.push(JSON.stringify({ exp, got, status: r.status, items, deadline, vendors })); }
      if (r.status === 'optimal') {
        const p = r.plan; expect(p.orders.reduce((s, o) => s + o.orderCents, 0)).toBe(p.totalCents);
        for (const a of p.allocations) { const v = vendors.find((x) => x.id === a.vendorId)!; expect(v.deliveryDays).toBeLessThanOrEqual(deadline); expect(a.qty).toBeLessThanOrEqual(v.quotes[a.skuId].stock); }
      }
    }
    if (bad.length) console.log(bad.join('\n'));
    expect(mism).toBe(0);
  });
  it('import never throws on junk', () => {
    const junk = ['', '{', 'null', '[]', '{"vendors":null}', '{"currency":"USD","vendors":[{}]}', 'a,b\n1,2', '\u0000\u0001', '{"currency":"USD","quotedAt":"x","validUntil":"y","vendors":[{"id":"__proto__","quotes":{"__proto__":{}}}]}', 'vendor,sku\n' + ',,,,,,,'.repeat(50)];
    for (const j of junk) { expect(() => parseQuoteImport(j)).not.toThrow(); const r = parseQuoteImport(j); expect(r.quoteSet === undefined || r.errors.length === 0).toBe(true); }
  });
});
