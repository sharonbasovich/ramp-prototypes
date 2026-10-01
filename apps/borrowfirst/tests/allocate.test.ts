// Engine-level adversarial cases from SPEC-BORROW-EXIT.md (B01–B03, B06,
// B08–B12). These exercise the production allocate/validate functions, not
// a copy of the logic.

import { describe, expect, it } from 'vitest';
import { allocate, evaluateInventory } from '../src/engine/allocate';
import { defaultRequest, seedWorld, DEMO_NOW } from '../src/engine/fixtures';
import type { Asset, EquipmentRequest, PurchaseOption, TransferOption, World } from '../src/engine/types';

function worldWith(partial: Partial<World>): World {
  return { ...seedWorld(), ...partial };
}

function requestWith(partial: Partial<EquipmentRequest>): EquipmentRequest {
  return { ...defaultRequest(), ...partial };
}

describe('B01 — headline demo numbers', () => {
  it('three monitors Friday: baseline $675, mixed plan $255, potential $420', () => {
    const world = seedWorld();
    const plan = allocate(defaultRequest(), world, DEMO_NOW);
    expect(plan.baseline?.costCents).toBe(67500);
    expect(plan.totalCostCents).toBe(25500);
    expect(plan.potentialAvoidedCents).toBe(42000);
    // two transfers + exactly one purchase unit — never three purchases
    expect(plan.transfers).toHaveLength(2);
    expect(plan.purchases.reduce((s, p) => s + p.quantity, 0)).toBe(1);
    expect(plan.status).toBe('conditional'); // M-204 still needs owner confirmation
    const ids = plan.transfers.map((t) => t.assetId);
    expect(new Set(ids).size).toBe(ids.length); // distinct assets
  });

  it('deadline tomorrow makes the remote spare infeasible and updates the plan', () => {
    const world = seedWorld();
    const req = requestWith({ requiredBy: '2026-10-01T21:00:00.000Z' });
    const plan = allocate(req, world, DEMO_NOW);
    const m204 = plan.evaluations.find((e) => e.asset.id === 'M-204');
    expect(m204?.eligible).toBe(false);
    expect(m204?.reasons.map((r) => r.code)).toContain('ARRIVES_AFTER_DEADLINE');
    // No valid purchase can arrive by tomorrow → partial internal plan, no baseline
    expect(plan.baseline).toBeNull();
    expect(plan.potentialAvoidedCents).toBeNull();
    expect(plan.transfers.map((t) => t.assetId).sort()).toEqual(['M-101', 'M-102']);
    expect(plan.shortage).toBe(1);
  });
});

describe('B02 — visually identical spare missing USB-C PD', () => {
  it('name match does not override specs', () => {
    const world = seedWorld();
    const req = requestWith({ requiredPorts: ['USB-C'] });
    const plan = allocate(req, world, DEMO_NOW);
    // No fixture monitor has USB-C — all spares excluded with a port reason
    for (const e of plan.evaluations) {
      expect(e.eligible).toBe(false);
      expect(e.reasons.some((r) => r.code === 'MISSING_PORT')).toBe(true);
    }
    // the new-monitor quote does offer USB-C, so an all-new plan is feasible
    expect(plan.transfers).toHaveLength(0);
    expect(plan.purchases.reduce((s, p) => s + p.quantity, 0)).toBe(3);
    expect(plan.totalCostCents).toBe(67500);
    expect(plan.potentialAvoidedCents).toBe(0);
  });
});

describe('B03 — remote spare arriving one minute late', () => {
  it('is excluded even though it is free', () => {
    const world = seedWorld();
    const late: Asset = {
      id: 'M-999', name: 'Monitor M-999', category: 'monitor',
      specs: { sizeInches: 24, ports: ['HDMI'] }, locationId: 'loc-toronto',
      ownerName: 'IT pool · Toronto', condition: 'functional', availability: 'available',
      ownerConfirmationRequired: false, ownerConfirmedAt: null, source: 'fixture', version: 1,
    };
    const t: TransferOption = {
      assetId: 'M-999', destinationLocationId: 'loc-waterloo', costCents: 0, currency: 'CAD',
      earliestArrival: '2026-10-02T21:01:00.000Z', // one minute after Friday 17:00
    };
    const w = worldWith({ assets: [...world.assets, late], transferOptions: [...world.transferOptions, t] });
    const plan = allocate(defaultRequest(), w, DEMO_NOW);
    const e = plan.evaluations.find((x) => x.asset.id === 'M-999');
    expect(e?.eligible).toBe(false);
    expect(e?.reasons.some((r) => r.code === 'ARRIVES_AFTER_DEADLINE')).toBe(true);
    expect(plan.transfers.map((x) => x.assetId)).not.toContain('M-999');
  });
});

describe('B08 — expired quote invalidates baseline and savings', () => {
  it('no savings claim without a current quote', () => {
    const world = seedWorld();
    const expired = world.purchaseOptions.map((o) => ({
      ...o,
      expiresAt: '2026-09-29T00:00:00.000Z', // before demo now
    }));
    const plan = allocate(defaultRequest(), worldWith({ purchaseOptions: expired }), DEMO_NOW);
    expect(plan.baseline).toBeNull();
    expect(plan.potentialAvoidedCents).toBeNull();
    expect(plan.warnings.some((w) => /expired/.test(w))).toBe(true);
    // all three spares still cover the request internally — no purchase
    expect(plan.shortage).toBe(0);
    expect(plan.transfers).toHaveLength(3);
    expect(plan.status).toBe('conditional');
  });
});

describe('B09 — five needed, two assets + three purchases', () => {
  it('returns an exact mixed plan with distinct assets', () => {
    const world = seedWorld();
    // Only M-101 and M-102 can arrive in time for this fixture variant,
    // and both transfers are cheap enough to beat buying new:
    const transfers = world.transferOptions.map((t) => {
      if (t.assetId === 'M-204') return { ...t, earliestArrival: '2026-10-06T13:00:00.000Z' };
      if (t.assetId === 'M-102') return { ...t, costCents: 1000 };
      return t;
    });
    const w = worldWith({ transferOptions: transfers });
    const req = requestWith({ quantity: 5 });
    const plan = allocate(req, w, DEMO_NOW);
    expect(plan.transfers.map((t) => t.assetId).sort()).toEqual(['M-101', 'M-102']);
    expect(plan.purchases.reduce((s, p) => s + p.quantity, 0)).toBe(3);
    expect(plan.shortage).toBe(0);
    const ids = plan.transfers.map((t) => t.assetId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(plan.totalCostCents).toBe(1500 + 1000 + 3 * 22500);
    expect(plan.baseline?.costCents).toBe(5 * 22500);
  });
});

describe('B10 — mixed currency never aggregates silently', () => {
  it('USD purchase vs CAD request is rejected, not compared', () => {
    const world = seedWorld();
    const usdQuote: PurchaseOption = {
      ...world.purchaseOptions[0],
      id: 'po-usd',
      currency: 'USD',
      unitCostCents: 100, // absurdly cheap — must still not be picked
    };
    const w = worldWith({
      purchaseOptions: [usdQuote], // only quote is USD
    });
    const plan = allocate(defaultRequest(), w, DEMO_NOW);
    expect(plan.baseline).toBeNull();
    expect(plan.potentialAvoidedCents).toBeNull();
    expect(plan.purchases).toHaveLength(0);
    expect(plan.warnings.join(' ')).toMatch(/USD/);
    // the USD quote is excluded; internal transfers cover all three
    expect(plan.shortage).toBe(0);
    expect(plan.transfers).toHaveLength(3);
  });
});

describe('B11 — unconfirmed owner availability is conditional', () => {
  it('flagged in the plan and kept out of confirmed reservations', () => {
    const world = seedWorld();
    const plan = allocate(defaultRequest(), world, DEMO_NOW);
    const m204 = plan.transfers.find((t) => t.assetId === 'M-204');
    expect(m204?.conditional).toBe(true);
    expect(plan.status).toBe('conditional');
    expect(plan.warnings.join(' ')).toMatch(/[Oo]wner confirmation/);
  });
});

describe('B12 — infeasible all-new baseline, feasible internal plan', () => {
  it('shows the internal plan without a numeric reduction', () => {
    const world = seedWorld();
    const req = requestWith({ requiredBy: '2026-10-01T21:00:00.000Z', quantity: 2 });
    const plan = allocate(req, world, DEMO_NOW);
    expect(plan.baseline).toBeNull(); // no quote arrives tomorrow
    expect(plan.transfers).toHaveLength(2); // M-101 + M-102 cover both
    expect(plan.shortage).toBe(0);
    expect(plan.potentialAvoidedCents).toBeNull();
    expect(plan.status).toBe('ok');
  });
});

describe('spec-driven compatibility (contract correction)', () => {
  it('a larger monitor is not inherently incompatible — M-204 (27") qualifies for a 24" request', () => {
    const world = seedWorld();
    const evals = evaluateInventory(defaultRequest(), world, DEMO_NOW);
    const m204 = evals.find((e) => e.asset.id === 'M-204');
    expect(m204?.eligible).toBe(true); // conditional only due to owner confirmation
    expect(m204?.reasons.map((r) => r.code)).toEqual(['OWNER_CONFIRMATION_REQUIRED']);
  });

  it('M-112 (32", damaged) is excluded for its real reason, not size', () => {
    const world = seedWorld();
    const evals = evaluateInventory(defaultRequest(), world, DEMO_NOW);
    const m112 = evals.find((e) => e.asset.id === 'M-112');
    expect(m112?.eligible).toBe(false);
    expect(m112?.reasons.map((r) => r.code)).toContain('DAMAGED');
  });
});
