// Adversarial regressions from the independent audit:
//  - forced "Use" must honor the asset and reallocate the remainder
//    optimally without overfilling;
//  - transfer routes are per (asset, destination) — destination changes
//    routing/cost, and a missing route is a real exclusion reason;
//  - hold expiry compares parsed UTC epochs, not ISO strings;
//  - the reserve path reconstructs the full fulfillment: exact coverage,
//    distinct assets, authoritative prices, recomputed baseline —
//    forged/incomplete/overfilled plans are rejected;
//  - SQLite handles close cleanly (Windows teardown / EBUSY) and a
//    file-backed DB persists across restarts without reseeding.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { allocate, evaluateInventory } from '../src/engine/allocate';
import { BorrowFirstStore } from '../src/engine/store';
import { defaultRequest, seedWorld, DEMO_NOW } from '../src/engine/fixtures';
import type { AllocationPlan, EquipmentRequest, World } from '../src/engine/types';

const seed = seedWorld();
const LOCATIONS = seed.locations;
const dirs: string[] = [];
const stores: BorrowFirstStore[] = [];

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'borrowfirst-'));
  dirs.push(dir);
  return join(dir, 'test.db');
}

function freshStore(path?: string) {
  const store = new BorrowFirstStore(path ?? tempDb());
  store.reset(seedWorld());
  stores.push(store);
  return store;
}

afterAll(() => {
  for (const s of stores) {
    try {
      s.close();
    } catch {
      // already closed
    }
  }
  dirs.forEach((d) => rmSync(d, { recursive: true, force: true }));
});

function worldOf(store: BorrowFirstStore): World {
  return store.loadWorld(LOCATIONS, DEMO_NOW);
}

function reservable(store: BorrowFirstStore): { request: EquipmentRequest; plan: AllocationPlan } {
  store.ownerConfirm('M-204', DEMO_NOW);
  const request = defaultRequest();
  return { request, plan: allocate(request, worldOf(store), DEMO_NOW) };
}

function requestWith(partial: Partial<EquipmentRequest>): EquipmentRequest {
  return { ...defaultRequest(), ...partial };
}

describe('forced "Use" includes (audit)', () => {
  it('honors a forced expensive asset for quantity 1', () => {
    const plan = allocate(requestWith({ quantity: 1 }), seedWorld(), DEMO_NOW, {
      includeAssetIds: ['M-102'],
    });
    expect(plan.transfers.map((t) => t.assetId)).toEqual(['M-102']);
    expect(plan.purchases).toHaveLength(0);
    expect(plan.totalCostCents).toBe(25000);
    expect(plan.shortage).toBe(0);
  });

  it('forced asset plus cheapest remainder: quantity 3 costs $280, not $490', () => {
    const plan = allocate(defaultRequest(), seedWorld(), DEMO_NOW, {
      includeAssetIds: ['M-102'],
    });
    expect(plan.transfers.map((t) => t.assetId).sort()).toEqual(['M-101', 'M-102', 'M-204']);
    expect(plan.purchases).toHaveLength(0);
    expect(plan.totalCostCents).toBe(28000);
  });

  it('never overfills: forced assets beyond the quantity are dropped with a warning', () => {
    const plan = allocate(requestWith({ quantity: 1 }), seedWorld(), DEMO_NOW, {
      includeAssetIds: ['M-101', 'M-102'],
    });
    const covered = plan.transfers.length + plan.purchases.reduce((s, p) => s + p.quantity, 0);
    expect(covered).toBe(1);
    expect(plan.warnings.join(' ')).toMatch(/exceed the requested quantity/);
  });

  it('warns when a forced asset is no longer eligible', () => {
    const plan = allocate(requestWith({ requiredPorts: ['USB-C'] }), seedWorld(), DEMO_NOW, {
      includeAssetIds: ['M-101'],
    });
    expect(plan.transfers.map((t) => t.assetId)).not.toContain('M-101');
    expect(plan.warnings.join(' ')).toMatch(/could not be included/);
  });
});

describe('destination-aware transfer routes (audit)', () => {
  it('Kitchener destination routes through local/cheaper options and changes the plan', () => {
    const plan = allocate(requestWith({ destinationLocationId: 'loc-kitchener' }), seedWorld(), DEMO_NOW);
    // Local Kitchener moves (M-204, M-306 at $10 each, same-day) plus the
    // Waterloo→Kitchener courier for M-101 — three transfers, no purchase.
    expect(plan.transfers.map((t) => t.assetId).sort()).toEqual(['M-101', 'M-204', 'M-306']);
    expect(plan.totalCostCents).toBe(8000);
    expect(plan.shortage).toBe(0);
    expect(plan.baseline?.costCents).toBe(67500);
  });

  it('Waterloo keeps the original routed costs ($255)', () => {
    const plan = allocate(defaultRequest(), seedWorld(), DEMO_NOW);
    expect(plan.totalCostCents).toBe(25500);
    expect(plan.transfers.map((t) => t.assetId).sort()).toEqual(['M-101', 'M-204']);
  });

  it('an asset with no route to the destination reports NO_TRANSFER_ROUTE', () => {
    const w = {
      ...seedWorld(),
      transferOptions: seed
        .transferOptions
        .filter((t) => !(t.assetId === 'M-101' && t.destinationLocationId === 'loc-waterloo')),
    };
    const e = evaluateInventory(defaultRequest(), w, DEMO_NOW).find((x) => x.asset.id === 'M-101');
    expect(e?.eligible).toBe(false);
    expect(e?.reasons.map((r) => r.code)).toContain('NO_TRANSFER_ROUTE');
  });
});

describe('hold expiry compares epochs, not ISO strings (audit)', () => {
  it('a live hold at 16:00-04:00 (20:00Z) is NOT swept at 18:00Z — it still blocks', () => {
    const store = freshStore();
    const { request, plan } = reservable(store);
    store.insertHold('M-101', 'req-hold', '2026-09-30T16:00:00-04:00', DEMO_NOW);
    const result = store.reserve(request, plan, LOCATIONS, DEMO_NOW, DEMO_NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failures.some((f) => f.code === 'ASSET_RESERVED')).toBe(true);
    }
  });

  it('an expired hold at 19:00+02:00 (17:00Z) IS swept at 18:00Z — reserve succeeds', () => {
    const store = freshStore();
    store.insertHold('M-101', 'req-old', '2026-09-30T19:00:00+02:00', DEMO_NOW);
    const { request, plan } = reservable(store);
    const result = store.reserve(request, plan, LOCATIONS, DEMO_NOW, DEMO_NOW);
    expect(result.ok).toBe(true);
    expect(
      worldOf(store).reservations.find((r) => r.id === 'hold-req-old-M-101')?.status,
    ).toBe('expired');
  });
});

describe('reserve rejects forged or incomplete plans (audit)', () => {
  it('rejects an empty plan for a positive quantity', () => {
    const store = freshStore();
    const { request, plan } = reservable(store);
    const forged = { ...plan, transfers: [], purchases: [], totalCostCents: 0, shortage: request.quantity };
    const result = store.reserve(request, forged, LOCATIONS, DEMO_NOW, DEMO_NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failures.some((f) => f.code === 'INCOMPLETE_PLAN')).toBe(true);
    }
    expect(worldOf(store).reservations).toHaveLength(0);
  });

  it('rejects a partial plan with shortage 1', () => {
    const store = freshStore();
    // Tomorrow deadline: no quote can deliver → plan covers 2 of 3.
    const request = requestWith({ requiredBy: '2026-10-01T21:00:00.000Z' });
    const plan = allocate(request, worldOf(store), DEMO_NOW);
    expect(plan.shortage).toBe(1);
    const result = store.reserve(request, plan, LOCATIONS, DEMO_NOW, DEMO_NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failures.some((f) => f.code === 'INCOMPLETE_PLAN')).toBe(true);
    }
  });

  it('rejects duplicate assets in one plan', () => {
    const store = freshStore();
    const { request, plan } = reservable(store);
    const forged = {
      ...plan,
      transfers: [plan.transfers[0], plan.transfers[0], plan.transfers[1]],
      purchases: [],
      totalCostCents: plan.transfers[0].costCents * 2 + plan.transfers[1].costCents,
    };
    const result = store.reserve(request, forged, LOCATIONS, DEMO_NOW, DEMO_NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failures.some((f) => f.code === 'PLAN_MISMATCH')).toBe(true);
    }
  });

  it('rejects a forged transfer price', () => {
    const store = freshStore();
    const { request, plan } = reservable(store);
    const forged = {
      ...plan,
      transfers: plan.transfers.map((l, i) => (i === 0 ? { ...l, costCents: 1 } : l)),
      totalCostCents: plan.totalCostCents - plan.transfers[0].costCents + 1,
    };
    const result = store.reserve(request, forged, LOCATIONS, DEMO_NOW, DEMO_NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failures.some((f) => f.code === 'TRANSFER_DRIFT')).toBe(true);
    }
  });

  it('rejects a plan whose total does not match its lines', () => {
    const store = freshStore();
    const { request, plan } = reservable(store);
    const forged = { ...plan, totalCostCents: plan.totalCostCents + 1 };
    const result = store.reserve(request, forged, LOCATIONS, DEMO_NOW, DEMO_NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failures.some((f) => f.code === 'PLAN_MISMATCH')).toBe(true);
    }
  });

  it('rejects an overfilled plan', () => {
    const store = freshStore();
    const { plan } = reservable(store);
    const smaller = { ...plan.request, quantity: 2 };
    const forged = { ...plan, request: smaller };
    const result = store.reserve(smaller, forged, LOCATIONS, DEMO_NOW, DEMO_NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failures.some((f) => f.code === 'OVERFILLED_PLAN')).toBe(true);
    }
  });
});

describe('baseline and drift revalidation at reserve (audit)', () => {
  it('rejects when the baseline quote expired after planning', () => {
    const store = freshStore();
    const { request, plan } = reservable(store);
    store.db
      .prepare(`UPDATE purchase_options SET expires_at = '2026-09-01T00:00:00.000Z'`)
      .run();
    const result = store.reserve(request, plan, LOCATIONS, DEMO_NOW, DEMO_NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failures.some((f) => f.code === 'BASELINE_STALE')).toBe(true);
    }
  });

  it('rejects when a baseline quote price drifted after planning', () => {
    const store = freshStore();
    const { request, plan } = reservable(store);
    store.db
      .prepare(`UPDATE purchase_options SET unit_cost_cents = 30000, version = version + 1 WHERE id = 'po-new'`)
      .run();
    const result = store.reserve(request, plan, LOCATIONS, DEMO_NOW, DEMO_NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // purchase line in the plan also uses po-new — either drift code rejects
      expect(
        result.failures.some((f) => ['BASELINE_STALE', 'QUOTE_DRIFT', 'STALE_QUOTE'].includes(f.code)),
      ).toBe(true);
    }
  });

  it('rejects when a transfer cost drifted after planning', () => {
    const store = freshStore();
    const { request, plan } = reservable(store);
    store.db
      .prepare(
        `UPDATE transfer_options SET cost_cents = cost_cents + 900 WHERE asset_id = 'M-101' AND destination_location_id = 'loc-waterloo'`,
      )
      .run();
    const result = store.reserve(request, plan, LOCATIONS, DEMO_NOW, DEMO_NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failures.some((f) => f.code === 'TRANSFER_DRIFT')).toBe(true);
    }
  });

  it('rejects a plan carrying a stale baseline number', () => {
    const store = freshStore();
    const { request, plan } = reservable(store);
    const forged = {
      ...plan,
      baseline: plan.baseline ? { ...plan.baseline, costCents: plan.baseline.costCents + 500 } : null,
    };
    const result = store.reserve(request, forged, LOCATIONS, DEMO_NOW, DEMO_NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failures.some((f) => f.code === 'BASELINE_STALE')).toBe(true);
    }
  });
});

describe('baseline replay honors reviewed quote exclusions (audit regression)', () => {
  it('a plan reviewed with po-refurb excluded reserves against the same $675 baseline', () => {
    const store = freshStore();
    store.ownerConfirm('M-204', DEMO_NOW);
    // Next-week deadline: refurb quote also delivers in time, so excluding
    // it changes the baseline ($675 all-new vs $590 refurb-cheapest).
    const request = requestWith({ requiredBy: '2026-10-09T21:00:00.000Z' });
    const plan = allocate(request, worldOf(store), DEMO_NOW, {
      excludeQuoteIds: ['po-refurb'],
    });
    expect(plan.baseline?.costCents).toBe(67500);
    expect(plan.excludedQuoteIds).toEqual(['po-refurb']);
    expect(plan.totalCostCents).toBe(4500);
    const result = store.reserve(request, plan, LOCATIONS, DEMO_NOW, DEMO_NOW);
    expect(result.ok).toBe(true);
  });

  it('a forged exclusion list no longer matches the recomputed baseline', () => {
    const store = freshStore();
    store.ownerConfirm('M-204', DEMO_NOW);
    const request = requestWith({ requiredBy: '2026-10-09T21:00:00.000Z' });
    // Reviewed WITHOUT exclusion → $590 baseline (refurb mix).
    const plan = allocate(request, worldOf(store), DEMO_NOW);
    expect(plan.baseline?.costCents).toBe(59000);
    // Forging exclusions would fake a $675 baseline — the recompute must
    // replay them and reject against the reviewed figure.
    const forged = { ...plan, excludedQuoteIds: ['po-refurb'] };
    const result = store.reserve(request, forged, LOCATIONS, DEMO_NOW, DEMO_NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failures.some((f) => f.code === 'BASELINE_STALE')).toBe(true);
    }
  });
});

describe('durable store lifecycle (audit)', () => {
  it('reservations and confirmations survive a restart; ensureSeeded does not wipe', () => {
    const path = tempDb();
    const s1 = new BorrowFirstStore(path);
    stores.push(s1);
    s1.ensureSeeded(seed);
    const { request, plan } = reservable(s1);
    const reserved = s1.reserve(request, plan, LOCATIONS, DEMO_NOW, DEMO_NOW);
    expect(reserved.ok).toBe(true);
    s1.close();

    // Second launch: same file, ensureSeeded must NOT reseed over data.
    const s2 = new BorrowFirstStore(path);
    stores.push(s2);
    s2.ensureSeeded(seed);
    const w = s2.loadWorld(LOCATIONS, DEMO_NOW);
    expect(w.reservations.filter((r) => r.status === 'confirmed')).toHaveLength(2);
    expect(w.assets.find((a) => a.id === 'M-204')?.ownerConfirmedAt).not.toBeNull();
    s2.close();

    // Closed handle → file is removable (no EBUSY on Windows teardown).
    expect(() => rmSync(path)).not.toThrow();
  });
});
