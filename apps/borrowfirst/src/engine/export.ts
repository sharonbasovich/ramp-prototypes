// Builds the exportable allocation document — the same JSON the UI
// downloads and the same rows rendered in the export CSV. Always carries
// the active mode label and the demo-data disclosure.

import { formatCents } from './money.js';
import type { AllocationPlan, Reservation, World } from './types.js';

export interface ExportDocument {
  app: 'borrowfirst';
  generatedAt: string;
  mode: 'SQLite server sandbox' | 'Browser sandbox';
  disclosure: string;
  request: {
    id: string;
    quantity: number;
    category: string;
    minSizeInches: number;
    requiredPorts: string[];
    destination: string;
    requiredBy: string;
    currency: string;
  };
  baselineCostCents: number | null;
  proposedCostCents: number;
  potentialAvoidedCents: number | null;
  transfers: {
    assetId: string;
    assetName: string;
    fromLocation: string;
    toLocation: string;
    costCents: number;
    earliestArrival: string;
    reservationId: string | null;
  }[];
  purchases: {
    optionId: string;
    label: string;
    quantity: number;
    unitCostCents: number;
    lineCostCents: number;
    deliveryInstant: string;
    provenance: string;
  }[];
  shortage: number;
  excludedAssets: { assetId: string; assetName: string; reasons: string[] }[];
}

export function buildExport(
  plan: AllocationPlan,
  world: World,
  reservations: Reservation[],
  mode: 'sqlite' | 'sandbox',
  generatedAt: string,
): ExportDocument {
  const locationName = (id: string) =>
    world.locations.find((l) => l.id === id)?.name ?? id;
  return {
    app: 'borrowfirst',
    generatedAt,
    mode: mode === 'sqlite' ? 'SQLite server sandbox' : 'Browser sandbox',
    disclosure:
      'Example inventory and example quotes — demo data only. No real purchases, transfers, or payments were made.',
    request: {
      id: plan.request.id,
      quantity: plan.request.quantity,
      category: plan.request.category,
      minSizeInches: plan.request.minSizeInches,
      requiredPorts: plan.request.requiredPorts,
      destination: locationName(plan.request.destinationLocationId),
      requiredBy: plan.request.requiredBy,
      currency: plan.request.currency,
    },
    baselineCostCents: plan.baseline?.costCents ?? null,
    proposedCostCents: plan.totalCostCents,
    potentialAvoidedCents: plan.potentialAvoidedCents,
    transfers: plan.transfers.map((t) => ({
      assetId: t.assetId,
      assetName: t.assetName,
      fromLocation: locationName(t.locationId),
      toLocation: locationName(plan.request.destinationLocationId),
      costCents: t.costCents,
      earliestArrival: t.earliestArrival,
      reservationId: reservations.find((r) => r.assetId === t.assetId)?.id ?? null,
    })),
    purchases: plan.purchases.map((p) => ({
      optionId: p.optionId,
      label: p.label,
      quantity: p.quantity,
      unitCostCents: p.unitCostCents,
      lineCostCents: p.lineCostCents,
      deliveryInstant: p.deliveryInstant,
      provenance: p.provenance,
    })),
    shortage: plan.shortage,
    excludedAssets: plan.evaluations
      .filter((e) => !e.eligible)
      .map((e) => ({
        assetId: e.asset.id,
        assetName: e.asset.name,
        reasons: e.reasons.map((r) => r.detail),
      })),
  };
}

export function exportToCsv(doc: ExportDocument): string {
  const lines = [
    '# BorrowFirst allocation export — ' + doc.mode,
    '# ' + doc.disclosure,
    'kind,id,label,quantity,unit_cost,line_cost,arrival_or_delivery,detail',
  ];
  const fmt = (cents: number) => formatCents(cents, doc.request.currency as 'CAD' | 'USD');
  for (const t of doc.transfers) {
    lines.push(
      `transfer,${t.assetId},${csvCell(t.assetName)},1,${fmt(t.costCents)},${fmt(t.costCents)},${t.earliestArrival},${csvCell(`${t.fromLocation} → ${t.toLocation}${t.reservationId ? ` · reservation ${t.reservationId}` : ''}`)}`,
    );
  }
  for (const p of doc.purchases) {
    lines.push(
      `purchase,${p.optionId},${csvCell(p.label)},${p.quantity},${fmt(p.unitCostCents)},${fmt(p.lineCostCents)},${p.deliveryInstant},${csvCell(p.provenance)}`,
    );
  }
  for (const e of doc.excludedAssets) {
    lines.push(`excluded,${e.assetId},${csvCell(e.assetName)},,,,,${csvCell(e.reasons.join('; '))}`);
  }
  lines.push(
    `summary,baseline_all_new,,, ,${doc.baselineCostCents === null ? 'n/a' : fmt(doc.baselineCostCents)},,${doc.baselineCostCents === null ? 'no feasible all-new baseline' : ''}`,
  );
  lines.push(`summary,proposed_plan,,, ,${fmt(doc.proposedCostCents)},,`);
  if (doc.potentialAvoidedCents !== null) {
    lines.push(`summary,potential_spending_avoided,,, ,${fmt(doc.potentialAvoidedCents)},,`);
  }
  if (doc.shortage > 0) {
    lines.push(`summary,unfulfilled_shortage,${doc.shortage} unit(s),,,,,`);
  }
  return lines.join('\n') + '\n';
}

function csvCell(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
