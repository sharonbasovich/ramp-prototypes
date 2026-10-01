import type { BasketItem, QuoteSet, SolveResult, Vendor, VendorOrder } from './engine/types';
import { planSignature } from './engine/signature';

interface Computed {
  result: SolveResult;
  baseline: { vendor: Vendor; order: VendorOrder } | null;
  sig: string;
  computedAt: string;
}

interface ExportInput {
  items: BasketItem[];
  deadline: number;
  quoteSet: QuoteSet;
  computed: Computed;
  approval: { signature: string; approvedAt: string };
}

const ASSUMPTIONS = [
  'Demo/sandbox purchase plan — no real order is placed and no payment is made.',
  'Prices are example pretax quotes in USD cents; no tax is modeled.',
  'Units may be split across vendors; each vendor order ships separately.',
  'Free-shipping threshold applies to the item subtotal and is inclusive.',
  'Empty vendor orders incur zero shipping.',
  'Quotes may expire or change; the plan is only valid for the signed inputs.',
];

export function buildExportJson({ items, deadline, quoteSet, computed, approval }: ExportInput) {
  const plan = computed.result.status === 'optimal' ? computed.result.plan : null;
  return {
    document: 'Cart Tetris purchase plan (sandbox export)',
    disclaimer: ASSUMPTIONS[0],
    assumptions: ASSUMPTIONS.slice(1),
    exportedAt: new Date().toISOString(),
    approvedAt: approval.approvedAt,
    planSignature: planSignature(items, deadline, quoteSet),
    deadlineDays: deadline,
    basket: items.filter((i) => i.qty > 0).map((i) => ({ skuId: i.skuId, name: i.name, qty: i.qty })),
    currency: quoteSet.currency,
    plan: plan
      ? {
          orders: plan.orders
            .filter((o) => o.itemsCents > 0)
            .map((o) => ({
              vendorId: o.vendorId,
              vendorName: quoteSet.vendors.find((v) => v.id === o.vendorId)?.name ?? o.vendorId,
              items: plan.allocations
                .filter((a) => a.vendorId === o.vendorId)
                .map((a) => ({
                  skuId: a.skuId,
                  name: items.find((i) => i.skuId === a.skuId)?.name ?? a.skuId,
                  qty: a.qty,
                  unitCents: a.unitCents,
                  lineCents: a.lineCents,
                })),
              itemsCents: o.itemsCents,
              shippingCents: o.shippingCents,
              orderCents: o.orderCents,
            })),
          itemsCents: plan.itemsCents,
          shippingCents: plan.shippingCents,
          totalCents: plan.totalCents,
        }
      : null,
    singleVendorBaseline: computed.baseline
      ? {
          vendorId: computed.baseline.vendor.id,
          vendorName: computed.baseline.vendor.name,
          itemsCents: computed.baseline.order.itemsCents,
          shippingCents: computed.baseline.order.shippingCents,
          orderCents: computed.baseline.order.orderCents,
          potentialSpendingReductionCents:
            plan != null ? computed.baseline.order.orderCents - plan.totalCents : null,
        }
      : null,
    provenance: {
      fixture: 'seed/imported demo quotes — not live pricing',
      quotedAt: quoteSet.quotedAt,
      validUntil: quoteSet.validUntil,
      quoteSet,
    },
  };
}

export function buildExportCsv({ items, deadline, quoteSet, computed, approval }: ExportInput): string {
  const plan = computed.result.status === 'optimal' ? computed.result.plan : null;
  const lines: string[] = [];
  lines.push('# Cart Tetris purchase plan — DEMO SANDBOX EXPORT, no real purchase');
  lines.push(`# exported_at,${new Date().toISOString()}`);
  lines.push(`# approved_at,${approval.approvedAt}`);
  lines.push(`# plan_signature,${planSignature(items, deadline, quoteSet)}`);
  lines.push(`# deadline_days,${deadline}`);
  lines.push('vendor,sku,item,qty,unit_cents,line_cents,vendor_items_cents,vendor_shipping_cents,vendor_order_cents');
  if (plan) {
    for (const o of plan.orders.filter((x) => x.itemsCents > 0)) {
      const vname = quoteSet.vendors.find((v) => v.id === o.vendorId)?.name ?? o.vendorId;
      for (const a of plan.allocations.filter((x) => x.vendorId === o.vendorId)) {
        const name = items.find((i) => i.skuId === a.skuId)?.name ?? a.skuId;
        lines.push(
          [vname, a.skuId, name, a.qty, a.unitCents, a.lineCents, o.itemsCents, o.shippingCents, o.orderCents].join(','),
        );
      }
    }
    lines.push(`,,,,,,,TOTAL,${plan.totalCents}`);
  }
  return lines.join('\n') + '\n';
}

export function download(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
