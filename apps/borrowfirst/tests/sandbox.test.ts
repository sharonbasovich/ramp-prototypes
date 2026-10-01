// Browser-sandbox adapter tests (B13, B14) plus export document checks.
// localStorage is shimmed so the real SandboxStore code path runs in Node.

import { beforeEach, describe, expect, it } from 'vitest';
import { allocate } from '../src/engine/allocate';
import { defaultRequest, seedWorld, DEMO_NOW } from '../src/engine/fixtures';
import { buildExport, exportToCsv } from '../src/engine/export';
import { SandboxStore } from '../src/backend/sandbox';
import { createBackend } from '../src/backend/client';

class LocalStorageShim {
  private map = new Map<string, string>();
  getItem(k: string) { return this.map.get(k) ?? null; }
  setItem(k: string, v: string) { this.map.set(k, v); }
  removeItem(k: string) { this.map.delete(k); }
  clear() { this.map.clear(); }
}

class BlockedStorageShim {
  getItem() { return null; }
  setItem() { throw new Error('QuotaExceededError'); }
  removeItem() { throw new Error('QuotaExceededError'); }
  clear() { throw new Error('QuotaExceededError'); }
}

beforeEach(() => {
  (globalThis as Record<string, unknown>).localStorage = new LocalStorageShim();
});

describe('B13 — browser sandbox scope is honest', () => {
  it('falls back to sandbox without an API and labels itself clearly', async () => {
    // No fetch mock → health check fails → sandbox.
    const backend = await createBackend();
    expect(backend.mode).toBe('sandbox');
    expect(backend.modeLabel).toBe('Browser sandbox');
    expect(backend.modeDetail).toMatch(/no server|single browser|localStorage/i);
    expect(backend.modeDetail).not.toMatch(/multi-user atomicity guaranteed/i);
  });
});

describe('B14 — reset and export fidelity in sandbox', () => {
  it('reset restores fixtures exactly', async () => {
    const store = new SandboxStore();
    const w0 = store.load();
    store.ownerConfirm('M-204');
    const w1 = store.reset();
    expect(w1).toEqual(w0);
    expect(w1.reservations).toHaveLength(0);
    expect(w1.assets.find((a) => a.id === 'M-204')?.ownerConfirmedAt).toBeNull();
  });

  it('export matches the displayed plan: costs, purchases, mode, exclusions', () => {
    const store = new SandboxStore();
    const world = store.load();
    const request = defaultRequest();
    const plan = allocate(request, world, DEMO_NOW);
    const doc = buildExport(plan, world, [], 'sandbox', DEMO_NOW);
    expect(doc.mode).toBe('Browser sandbox');
    expect(doc.baselineCostCents).toBe(67500);
    expect(doc.proposedCostCents).toBe(25500);
    expect(doc.potentialAvoidedCents).toBe(42000);
    expect(doc.transfers.map((t) => t.assetId).sort()).toEqual(['M-101', 'M-204']);
    expect(doc.purchases).toHaveLength(1);
    expect(doc.purchases[0].quantity).toBe(1);
    expect(doc.disclosure).toMatch(/demo data/i);
    // excluded assets carry their reasons
    const m306 = doc.excludedAssets.find((e) => e.assetId === 'M-306');
    expect(m306?.reasons.join(' ')).toMatch(/after required-by|Too late|arrival/i);
    const csv = exportToCsv(doc);
    expect(csv).toContain('Browser sandbox');
    expect(csv).toContain('M-101');
    expect(csv).toContain('potential_spending_avoided');
  });

  it('sandbox reserve validates like the server and conflicts honestly', async () => {
    const store = new SandboxStore();
    const world = store.load();
    store.ownerConfirm('M-204');
    const w = store.load();
    const request = defaultRequest();
    const plan = allocate(request, w, DEMO_NOW);
    const ok = await store.reserve(request, plan);
    expect(ok.ok).toBe(true);
    expect(ok.reservations).toHaveLength(2);
    // second reserve of the same plan must conflict
    const again = await store.reserve({ ...request, id: 'req-2' }, plan);
    expect(again.ok).toBe(false);
    expect(again.failures.some((f) => f.code === 'ASSET_RESERVED')).toBe(true);
  });

  it('blocked storage keeps instance memory: confirm → reserve → export all work', async () => {
    (globalThis as Record<string, unknown>).localStorage = new BlockedStorageShim();
    const store = new SandboxStore();
    store.load();
    store.ownerConfirm('M-204');
    const w = store.load();
    // Without the in-memory fallback this would silently reseed to v1/null.
    expect(w.assets.find((a) => a.id === 'M-204')?.ownerConfirmedAt).not.toBeNull();
    const request = defaultRequest();
    const plan = allocate(request, w, DEMO_NOW);
    const ok = await store.reserve(request, plan);
    expect(ok.ok).toBe(true);
    expect(ok.reservations).toHaveLength(2);
    // Reservations persist within the instance too — a second load sees them.
    const after = store.load();
    expect(after.reservations.filter((r) => r.status === 'confirmed')).toHaveLength(2);
    const doc = buildExport(plan, after, ok.reservations, 'sandbox', DEMO_NOW);
    expect(doc.transfers.every((t) => t.reservationId !== null)).toBe(true);
    const csv = exportToCsv(doc);
    expect(csv).toContain('rsv-');
  });
});
