// BorrowFirst allocation engine. Pure functions shared by the SQLite
// server, the browser sandbox adapter, and the test suite.
//
// Compatibility is computed from actual requirements (size, ports,
// condition, availability, arrival deadline) — never from asset names.
// The assignment search is exact over the small fixture inventory: every
// feasible subset size is priced, so the returned plan is the minimum-cost
// feasible plan, not a heuristic.

import type {
  AllocationPlan,
  Asset,
  AssetEvaluation,
  EquipmentRequest,
  PurchaseLine,
  PurchaseOption,
  Reservation,
  ReserveFailure,
  TransferLine,
  TransferOption,
  World,
} from './types.js';
import { labelArrival, labelDeadline } from './dates.js';

function t(iso: string): number {
  return Date.parse(iso);
}

function assetIsBlocked(assetId: string, reservations: Reservation[], now: string): boolean {
  const n = t(now);
  return reservations.some(
    (r) =>
      r.assetId === assetId &&
      ((r.status === 'held' && r.expiresAt !== null && t(r.expiresAt) > n) ||
        r.status === 'confirmed'),
  );
}

export function evaluateAsset(
  request: EquipmentRequest,
  asset: Asset,
  transfer: TransferOption | null,
  reservations: Reservation[],
  now: string,
): AssetEvaluation {
  const reasons: AssetEvaluation['reasons'] = [];
  if (asset.category !== request.category) {
    reasons.push({
      code: 'CATEGORY_MISMATCH',
      detail: `Category ${asset.category} does not match requested ${request.category}`,
    });
  }
  if (asset.condition !== 'functional') {
    reasons.push({ code: 'DAMAGED', detail: 'Condition is damaged, not functional' });
  }
  if (asset.availability !== 'available') {
    reasons.push({
      code: 'UNAVAILABLE',
      detail: `Availability is "${asset.availability.replace('_', ' ')}"`,
    });
  }
  if (assetIsBlocked(asset.id, reservations, now)) {
    reasons.push({
      code: 'ALREADY_RESERVED',
      detail: 'An active hold or reservation covers this asset',
    });
  }
  const missingPorts = request.requiredPorts.filter((p) => !asset.specs.ports.includes(p));
  if (missingPorts.length > 0) {
    reasons.push({
      code: 'MISSING_PORT',
      detail: `Missing required port${missingPorts.length > 1 ? 's' : ''}: ${missingPorts.join(', ')}`,
    });
  }
  if (asset.specs.sizeInches < request.minSizeInches) {
    reasons.push({
      code: 'BELOW_MIN_SIZE',
      detail: `${asset.specs.sizeInches}" is below the ${request.minSizeInches}" minimum`,
    });
  }
  if (transfer === null) {
    reasons.push({ code: 'NO_TRANSFER_ROUTE', detail: 'No transfer option exists for this asset' });
  } else {
    if (transfer.currency !== request.currency) {
      reasons.push({
        code: 'CURRENCY_MISMATCH',
        detail: `Transfer priced in ${transfer.currency}, request is ${request.currency} — excluded, no conversion provided`,
      });
    }
    if (t(transfer.earliestArrival) > t(request.requiredBy)) {
      reasons.push({
        code: 'ARRIVES_AFTER_DEADLINE',
        detail: `Earliest arrival ${labelArrival(transfer.earliestArrival, now)} is after required-by ${labelDeadline(request.requiredBy)}`,
      });
    }
  }

  const hardFailure = reasons.length > 0;
  const conditional =
    !hardFailure && asset.ownerConfirmationRequired && asset.ownerConfirmedAt === null;
  if (conditional) {
    reasons.push({
      code: 'OWNER_CONFIRMATION_REQUIRED',
      detail: `Owner ${asset.ownerName} has not confirmed availability`,
    });
  }
  if (reasons.length === 0) {
    reasons.push({ code: 'OK', detail: 'Meets every requirement and can arrive in time' });
  }
  return { asset, transfer, eligible: !hardFailure, conditional, reasons };
}

export function evaluateInventory(
  request: EquipmentRequest,
  world: World,
  now: string,
): AssetEvaluation[] {
  // A transfer route only applies to the request's destination — assets
  // with no route to it get NO_TRANSFER_ROUTE instead of a silent match.
  const transferByAsset = new Map(
    world.transferOptions
      .filter((o) => o.destinationLocationId === request.destinationLocationId)
      .map((o) => [o.assetId, o]),
  );
  return world.assets.map((asset) =>
    evaluateAsset(request, asset, transferByAsset.get(asset.id) ?? null, world.reservations, now),
  );
}

interface QuoteEvaluation {
  option: PurchaseOption;
  valid: boolean;
  reasons: string[];
}

export function evaluateQuotes(
  request: EquipmentRequest,
  world: World,
  now: string,
): QuoteEvaluation[] {
  return world.purchaseOptions
    .filter((o) => o.category === request.category)
    .map((option) => {
      const reasons: string[] = [];
      if (option.currency !== request.currency) {
        reasons.push(
          `Quote priced in ${option.currency}, request is ${request.currency} — excluded, no conversion provided`,
        );
      }
      if (t(option.expiresAt) <= t(now)) {
        reasons.push(`Quote expired at ${labelDeadline(option.expiresAt)}`);
      }
      if (t(option.deliveryInstant) > t(request.requiredBy)) {
        reasons.push(
          `Delivery ${labelDeadline(option.deliveryInstant)} is after required-by ${labelDeadline(request.requiredBy)}`,
        );
      }
      const missingPorts = request.requiredPorts.filter((p) => !option.specs.ports.includes(p));
      if (missingPorts.length > 0) {
        reasons.push(`Does not provide required port(s): ${missingPorts.join(', ')}`);
      }
      if (option.specs.sizeInches < request.minSizeInches) {
        reasons.push(
          `Offered ${option.specs.sizeInches}" is below the ${request.minSizeInches}" minimum`,
        );
      }
      return { option, valid: reasons.length === 0, reasons };
    });
}

function purchaseLine(option: PurchaseOption, quantity: number): PurchaseLine {
  const lineCostCents = option.unitCostCents * quantity + (quantity > 0 ? option.flatShippingCents : 0);
  return {
    optionId: option.id,
    label: option.label,
    quantity,
    unitCostCents: option.unitCostCents,
    shippingCents: quantity > 0 ? option.flatShippingCents : 0,
    lineCostCents,
    currency: option.currency,
    deliveryInstant: option.deliveryInstant,
    provenance: option.provenance,
  };
}

// Exact minimum-cost purchase of `units` from the given valid options.
// Small dynamic program — options are few, quantities are small.
function cheapestPurchase(units: number, options: PurchaseOption[]): PurchaseLine[] | null {
  if (units === 0) return [];
  const INF = Number.POSITIVE_INFINITY;
  // dp[i][j] = min cost to buy j units using options[0..i)
  const dp: number[][] = Array.from({ length: options.length + 1 }, () =>
    new Array<number>(units + 1).fill(INF),
  );
  const pick: number[][] = Array.from({ length: options.length + 1 }, () =>
    new Array<number>(units + 1).fill(-1),
  );
  dp[0][0] = 0;
  for (let i = 0; i < options.length; i++) {
    const o = options[i];
    for (let j = 0; j <= units; j++) {
      if (dp[i][j] === INF) continue;
      const cap = Math.min(o.maxQuantity, units - j);
      for (let x = 0; x <= cap; x++) {
        const cost = dp[i][j] + o.unitCostCents * x + (x > 0 ? o.flatShippingCents : 0);
        if (cost < dp[i + 1][j + x]) {
          dp[i + 1][j + x] = cost;
          pick[i + 1][j + x] = x;
        }
      }
    }
  }
  if (dp[options.length][units] === INF) return null;
  const counts: number[] = new Array(options.length).fill(0);
  let j = units;
  for (let i = options.length; i >= 1; i--) {
    const x = pick[i][j];
    counts[i - 1] = x;
    j -= x;
  }
  return options
    .map((o, i) => purchaseLine(o, counts[i]))
    .filter((l) => l.quantity > 0);
}

function lineCost(lines: PurchaseLine[]): number {
  return lines.reduce((sum, l) => sum + l.lineCostCents, 0);
}

export interface AllocateOptions {
  excludeAssetIds?: string[];
  includeAssetIds?: string[];
  excludeQuoteIds?: string[];
}

export function allocate(
  request: EquipmentRequest,
  world: World,
  now: string,
  opts: AllocateOptions = {},
): AllocationPlan {
  const exclude = new Set(opts.excludeAssetIds ?? []);
  const include = new Set(opts.includeAssetIds ?? []);
  const evaluations = evaluateInventory(request, world, now);

  const eligible = evaluations.filter(
    (e) => e.eligible && e.transfer !== null && !exclude.has(e.asset.id),
  );
  // Cheapest first; asset id breaks ties so results are deterministic.
  const byCost = (a: (typeof eligible)[number], b: (typeof eligible)[number]) =>
    a.transfer!.costCents - b.transfer!.costCents || a.asset.id.localeCompare(b.asset.id);
  // Forced ("Use") assets are always in the plan — capped at the requested
  // quantity so the plan never over-fills, with anything unhonored warned.
  const forcedAll = eligible.filter((e) => include.has(e.asset.id)).sort(byCost);
  const forced = forcedAll.slice(0, request.quantity);
  const droppedForced = forcedAll.slice(request.quantity);
  const unhonoredForced = [...include].filter(
    (id) => !forcedAll.some((f) => f.asset.id === id),
  );
  const pool = eligible.filter((e) => !include.has(e.asset.id)).sort(byCost);

  const quoteEvals = evaluateQuotes(request, world, now);
  const quoteExcluded = new Set(opts.excludeQuoteIds ?? []);
  const validQuotes = quoteEvals
    .filter((q) => q.valid && !quoteExcluded.has(q.option.id))
    .map((q) => q.option);
  const quoteNotes = quoteEvals
    .filter((q) => !q.valid)
    .map((q) => `${q.option.label}: ${q.reasons.join('; ')}`);

  const baselineLines = cheapestPurchase(request.quantity, validQuotes);
  const baseline =
    baselineLines !== null ? { purchases: baselineLines, costCents: lineCost(baselineLines) } : null;
  const baselineNote =
    baseline === null
      ? validQuotes.length === 0
        ? `No valid all-new purchase can meet this request (${quoteNotes.join(' · ') || 'no quotes in this currency'})`
        : `Quotes cannot cover the full quantity of ${request.quantity}`
      : null;

  // Exact search: forced assets are pinned in; for every extra count of
  // pool transfers, take the cheapest extras plus the cheapest purchase
  // plan for the remaining quantity.
  const bestByK: { transfers: typeof pool; purchases: PurchaseLine[] | null; cost: number }[] = [];
  const maxExtra = Math.min(request.quantity - forced.length, pool.length);
  for (let extra = 0; extra <= maxExtra; extra++) {
    const chosen = [...forced, ...pool.slice(0, extra)];
    const remaining = request.quantity - chosen.length;
    const purchases = cheapestPurchase(remaining, validQuotes);
    const cost =
      chosen.reduce((s, e) => s + e.transfer!.costCents, 0) +
      (purchases === null ? 0 : lineCost(purchases));
    bestByK.push({ transfers: chosen, purchases, cost });
  }

  // Feasible splits only (purchase side can fulfill the remainder); prefer
  // lowest cost, then more internal reuse, then deterministic id order.
  const feasible = bestByK.filter((b) => b.purchases !== null);
  let chosenSplit: (typeof bestByK)[number];
  if (feasible.length > 0) {
    feasible.sort((a, b) => a.cost - b.cost || b.transfers.length - a.transfers.length);
    chosenSplit = feasible[0];
  } else {
    // Partial coverage: keep as many transfers as possible, no valid quote.
    const chosen = [...forced, ...pool.slice(0, maxExtra)];
    chosenSplit = {
      transfers: chosen,
      purchases: null,
      cost: chosen.reduce((s, e) => s + e.transfer!.costCents, 0),
    };
  }

  const transfers: TransferLine[] = chosenSplit.transfers.map((e) => ({
    assetId: e.asset.id,
    assetName: e.asset.name,
    locationId: e.asset.locationId,
    costCents: e.transfer!.costCents,
    currency: e.transfer!.currency,
    earliestArrival: e.transfer!.earliestArrival,
    conditional: e.conditional,
  }));
  const purchases = chosenSplit.purchases ?? [];
  const covered = transfers.length + purchases.reduce((s, l) => s + l.quantity, 0);
  const shortage = request.quantity - covered;
  const totalCostCents =
    transfers.reduce((s, l) => s + l.costCents, 0) + lineCost(purchases);
  const conditional = transfers.some((l) => l.conditional);

  const warnings: string[] = [];
  const errors: string[] = [];
  if (droppedForced.length > 0) {
    warnings.push(
      `Forced items exceed the requested quantity — not included: ${droppedForced.map((e) => e.asset.id).join(', ')}`,
    );
  }
  if (unhonoredForced.length > 0) {
    warnings.push(
      `Forced item(s) no longer eligible and could not be included: ${unhonoredForced.join(', ')}`,
    );
  }
  if (conditional) {
    warnings.push('Owner confirmation is required before this plan can be reserved.');
  }
  if (shortage > 0) {
    warnings.push(
      `Shortage: ${shortage} unit${shortage === 1 ? '' : 's'} cannot be fulfilled by the deadline${validQuotes.length === 0 ? ' — no valid purchase quote' : ''}.`,
    );
  }
  for (const note of quoteNotes) warnings.push(note);

  const status: AllocationPlan['status'] =
    covered === 0
      ? 'infeasible'
      : shortage > 0
        ? 'partial'
        : conditional
          ? 'conditional'
          : 'ok';

  const potentialAvoidedCents =
    baseline !== null && shortage === 0 ? baseline.costCents - totalCostCents : null;

  const assetVersions: Record<string, number> = {};
  for (const l of transfers) {
    const a = world.assets.find((x) => x.id === l.assetId);
    if (a) assetVersions[l.assetId] = a.version;
  }
  const quoteVersions: Record<string, number> = {};
  for (const l of purchases) {
    const o = world.purchaseOptions.find((x) => x.id === l.optionId);
    if (o) quoteVersions[l.optionId] = o.version;
  }

  return {
    request,
    status,
    currency: request.currency,
    transfers,
    purchases,
    shortage,
    totalCostCents,
    baseline,
    baselineNote,
    potentialAvoidedCents,
    conditional,
    evaluations,
    assetVersions,
    quoteVersions,
    excludedQuoteIds: [...quoteExcluded],
    warnings,
    errors,
  };
}

// Structural + authoritative revalidation of a submitted plan. The server
// cannot trust client-computed lines: every transfer is compared against
// the current route for (asset, request destination), every purchase line
// against the current quote row, coverage must equal the requested
// quantity exactly, the total must be the sum of authoritative lines, and
// the all-new baseline is recomputed so expired/drifted quotes cannot
// back a stale savings claim.
export function validatePlanIntegrity(
  plan: AllocationPlan,
  world: World,
  now: string,
): ReserveFailure[] {
  const failures: ReserveFailure[] = [];
  const req = plan.request;
  if (
    !req ||
    !Number.isInteger(req.quantity) ||
    req.quantity < 1 ||
    typeof req.destinationLocationId !== 'string' ||
    !req.destinationLocationId ||
    typeof req.requiredBy !== 'string' ||
    Number.isNaN(Date.parse(req.requiredBy)) ||
    typeof req.currency !== 'string' ||
    !req.currency
  ) {
    return [
      {
        code: 'PLAN_MISMATCH',
        detail: 'Plan request is malformed — quantity, destination, deadline and currency are required',
      },
    ];
  }

  const purchaseUnits = plan.purchases.reduce((s, l) => s + l.quantity, 0);
  const covered = plan.transfers.length + purchaseUnits;
  if (covered !== req.quantity) {
    failures.push({
      code: covered < req.quantity ? 'INCOMPLETE_PLAN' : 'OVERFILLED_PLAN',
      detail:
        covered < req.quantity
          ? `Plan covers ${covered} of ${req.quantity} requested units — incomplete plans cannot be reserved`
          : `Plan covers ${covered} units for a request of ${req.quantity} — overfilled plans cannot be reserved`,
    });
  }

  const ids = plan.transfers.map((l) => l.assetId);
  if (new Set(ids).size !== ids.length) {
    failures.push({ code: 'PLAN_MISMATCH', detail: 'Plan lists the same asset more than once' });
  }

  const routeByKey = new Map(
    world.transferOptions.map((o) => [`${o.assetId}→${o.destinationLocationId}`, o]),
  );
  for (const l of plan.transfers) {
    const asset = world.assets.find((a) => a.id === l.assetId);
    if (!asset) {
      failures.push({ code: 'PLAN_MISMATCH', detail: `${l.assetId}: unknown asset` });
      continue;
    }
    if (l.locationId !== asset.locationId) {
      failures.push({
        code: 'PLAN_MISMATCH',
        detail: `${l.assetId}: plan lists location ${l.locationId}, asset is at ${asset.locationId}`,
      });
    }
    const opt = routeByKey.get(`${l.assetId}→${req.destinationLocationId}`);
    if (!opt) {
      failures.push({
        code: 'PLAN_MISMATCH',
        detail: `${l.assetId}: no transfer route to ${req.destinationLocationId} exists`,
      });
      continue;
    }
    if (
      l.costCents !== opt.costCents ||
      l.currency !== opt.currency ||
      l.earliestArrival !== opt.earliestArrival
    ) {
      failures.push({
        code: 'TRANSFER_DRIFT',
        detail: `${l.assetId}: transfer terms changed since review (planned ${l.costCents} ${l.currency}, now ${opt.costCents} ${opt.currency})`,
      });
    }
  }

  const poById = new Map(world.purchaseOptions.map((o) => [o.id, o]));
  for (const l of plan.purchases) {
    const opt = poById.get(l.optionId);
    if (!opt) {
      failures.push({
        code: 'PLAN_MISMATCH',
        detail: `${l.label}: unknown purchase option ${l.optionId}`,
      });
      continue;
    }
    if (!Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity > opt.maxQuantity) {
      failures.push({
        code: 'PLAN_MISMATCH',
        detail: `${l.label}: quantity ${l.quantity} is outside the allowed 1–${opt.maxQuantity}`,
      });
      continue;
    }
    const expectedCost = l.quantity * opt.unitCostCents + opt.flatShippingCents;
    if (
      l.unitCostCents !== opt.unitCostCents ||
      l.shippingCents !== opt.flatShippingCents ||
      l.currency !== opt.currency ||
      l.lineCostCents !== expectedCost
    ) {
      failures.push({
        code: 'QUOTE_DRIFT',
        detail: `${l.label}: quoted terms do not match the current offer (planned ${l.unitCostCents}/unit, authoritative ${opt.unitCostCents}/unit)`,
      });
    }
  }

  const recomputedTotal =
    plan.transfers.reduce((s, l) => s + l.costCents, 0) +
    plan.purchases.reduce((s, l) => s + l.lineCostCents, 0);
  if (plan.totalCostCents !== recomputedTotal) {
    failures.push({
      code: 'PLAN_MISMATCH',
      detail: `Plan total ${plan.totalCostCents} does not equal the sum of its lines (${recomputedTotal})`,
    });
  }

  // Baseline revalidation: the all-new comparison must still be backed by
  // currently valid quotes at the prices shown at review time — replaying
  // the same quote exclusions the reviewed plan was computed under.
  if (plan.baseline !== null && plan.baseline !== undefined) {
    const quoteEvals = evaluateQuotes(req, world, now);
    const planExcluded = new Set(plan.excludedQuoteIds ?? []);
    const validQuotes = quoteEvals
      .filter((q) => q.valid && !planExcluded.has(q.option.id))
      .map((q) => q.option);
    const currentLines = cheapestPurchase(req.quantity, validQuotes);
    const currentCost = currentLines === null ? null : lineCost(currentLines);
    if (currentCost === null) {
      failures.push({
        code: 'BASELINE_STALE',
        detail:
          'The quotes backing the all-new baseline are no longer valid — the savings comparison cannot be confirmed',
      });
    } else if (currentCost !== plan.baseline.costCents) {
      failures.push({
        code: 'BASELINE_STALE',
        detail: `All-new baseline drifted since review (${plan.baseline.costCents} → ${currentCost}) — recalculate before reserving`,
      });
    }
  }

  return failures;
}

// Revalidation run inside the SQLite transaction (and inside the sandbox
// write lock) immediately before reservations are written. Integrity is
// checked first — a forged or incomplete plan is rejected before any
// asset-level detail is trusted. Any drift between the reviewed plan and
// current inventory rejects the whole plan — never a partial reservation.
export function validateReservation(
  plan: AllocationPlan,
  world: World,
  now: string,
): ReserveFailure[] {
  const integrity = validatePlanIntegrity(plan, world, now);
  if (integrity.length > 0) return integrity;
  const failures: ReserveFailure[] = [];
  const evaluations = evaluateInventory(plan.request, world, now);
  const evalById = new Map(evaluations.map((e) => [e.asset.id, e]));

  for (const line of plan.transfers) {
    const e = evalById.get(line.assetId);
    const current = world.assets.find((a) => a.id === line.assetId);
    if (!current) {
      failures.push({ code: 'STALE_ASSET', detail: `${line.assetName} no longer exists` });
      continue;
    }
    if (plan.assetVersions[line.assetId] !== undefined && current.version !== plan.assetVersions[line.assetId]) {
      failures.push({
        code: 'STALE_ASSET',
        detail: `${line.assetName} changed since the plan was reviewed (version ${plan.assetVersions[line.assetId]} → ${current.version})`,
      });
      continue;
    }
    if (!e || !e.eligible) {
      const why = e?.reasons.map((r) => r.detail).join('; ') ?? 'unknown';
      const reserved = e?.reasons.some((r) => r.code === 'ALREADY_RESERVED');
      const incompatible = e?.reasons.some((r) =>
        ['MISSING_PORT', 'BELOW_MIN_SIZE', 'DAMAGED', 'CATEGORY_MISMATCH', 'ARRIVES_AFTER_DEADLINE', 'CURRENCY_MISMATCH'].includes(r.code),
      );
      failures.push({
        code: reserved ? 'ASSET_RESERVED' : incompatible ? 'ASSET_INCOMPATIBLE' : 'ASSET_UNAVAILABLE',
        detail: `${line.assetName}: ${why}`,
      });
      continue;
    }
    if (e.conditional) {
      failures.push({
        code: 'UNCONFIRMED_ASSET',
        detail: `${line.assetName} still requires owner confirmation`,
      });
    }
  }

  const quoteEvals = evaluateQuotes(plan.request, world, now);
  const quoteById = new Map(quoteEvals.map((q) => [q.option.id, q]));
  for (const line of plan.purchases) {
    const q = quoteById.get(line.optionId);
    const current = world.purchaseOptions.find((o) => o.id === line.optionId);
    if (!current) {
      failures.push({ code: 'STALE_QUOTE', detail: `${line.label} is no longer available` });
      continue;
    }
    if (plan.quoteVersions[line.optionId] !== undefined && current.version !== plan.quoteVersions[line.optionId]) {
      failures.push({
        code: 'STALE_QUOTE',
        detail: `${line.label} changed since the plan was reviewed`,
      });
      continue;
    }
    if (!q || !q.valid) {
      const expired = t(current.expiresAt) <= t(now);
      failures.push({
        code: expired ? 'QUOTE_EXPIRED' : 'PLAN_MISMATCH',
        detail: `${line.label}: ${q ? q.reasons.join('; ') : 'unavailable'}`,
      });
    }
  }

  const currencies = new Set<string>([
    plan.request.currency,
    ...plan.transfers.map((l) => l.currency),
    ...plan.purchases.map((l) => l.currency),
  ]);
  if (currencies.size > 1) {
    failures.push({
      code: 'CURRENCY_MISMATCH',
      detail: `Plan mixes currencies (${[...currencies].join(', ')}) — refusing to aggregate`,
    });
  }
  return failures;
}
