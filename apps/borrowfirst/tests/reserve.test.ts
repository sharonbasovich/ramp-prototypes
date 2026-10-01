// SQLite transactional-reservation cases: B04–B07 from the adversarial
// matrix, plus version/quote revalidation (B06, B08 server-side). These run
// against the real BorrowFirstStore on a file-backed node:sqlite database —
// including two worker threads racing the same asset.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { afterAll, describe, expect, it } from 'vitest';
import { BorrowFirstStore } from '../src/engine/store';
import { allocate } from '../src/engine/allocate';
import { defaultRequest, seedWorld, DEMO_NOW } from '../src/engine/fixtures';
import type { EquipmentRequest } from '../src/engine/types';

const dirs: string[] = [];
const stores: BorrowFirstStore[] = [];
function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'borrowfirst-'));
  dirs.push(dir);
  return join(dir, 'test.db');
}
afterAll(() => {
  // Close every handle before removing dirs — on Windows an open file
  // fails teardown with EBUSY even when all assertions passed.
  for (const s of stores) {
    try {
      s.close();
    } catch {
      // already closed
    }
  }
  dirs.forEach((d) => rmSync(d, { recursive: true, force: true }));
});

const seed = seedWorld();
const LOCATIONS = seed.locations;

function freshStore(path?: string) {
  const store = new BorrowFirstStore(path ?? tempDb());
  stores.push(store);
  store.reset(seed);
  return store;
}

function worldOf(store: BorrowFirstStore) {
  return store.loadWorld(LOCATIONS, DEMO_NOW);
}

// Build a confirmed-able plan: owner-confirm M-204 first so the plan is not
// conditional.
function readyPlan(store: BorrowFirstStore, request?: EquipmentRequest) {
  store.ownerConfirm('M-204', DEMO_NOW);
  const req = request ?? defaultRequest();
  const plan = allocate(req, worldOf(store), DEMO_NOW);
  return { request: req, plan };
}

describe('B05 — losing a mid-flight asset rejects the whole plan', () => {
  it('no partial reservation is left behind', () => {
    const store = freshStore();
    const { request, plan } = readyPlan(store);
    // Another client reserves M-101 before our plan is submitted.
    const other = store.reserve(
      { ...request, id: 'req-other', quantity: 1 },
      allocate({ ...request, id: 'req-other', quantity: 1 }, worldOf(store), DEMO_NOW),
      LOCATIONS,
      DEMO_NOW,
      DEMO_NOW,
    );
    expect(other.ok).toBe(true);
    // Our stale plan still selects M-101 — it must be rejected wholesale.
    const result = store.reserve(request, plan, LOCATIONS, DEMO_NOW, DEMO_NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failures.some((f) => f.code === 'ASSET_RESERVED')).toBe(true);
    }
    const w = worldOf(store);
    // M-204 must NOT be reserved for the rejected plan.
    expect(w.reservations.filter((r) => r.requestId === request.id)).toHaveLength(0);
    expect(
      w.reservations.filter((r) => r.status === 'confirmed').map((r) => r.assetId),
    ).toEqual(['M-101']);
  });
});

describe('B04 — two clients race the same asset', () => {
  it('exactly one reservation commits (sequential conflict)', () => {
    const store = freshStore();
    const { request, plan } = readyPlan(store);
    const first = store.reserve(request, plan, LOCATIONS, DEMO_NOW, DEMO_NOW);
    expect(first.ok).toBe(true);
    const second = store.reserve({ ...request, id: 'req-rival' }, plan, LOCATIONS, DEMO_NOW, DEMO_NOW);
    expect(second.ok).toBe(false);
    const active = worldOf(store).reservations.filter((r) => r.status === 'confirmed');
    expect(active).toHaveLength(2); // M-101 + M-204 from the winner only
    expect(new Set(active.map((r) => r.requestId)).size).toBe(1);
  });

  it('exactly one reservation commits (concurrent worker threads)', async () => {
    const path = tempDb();
    const setup = freshStore(path);
    // Seed one cheap plan targeting only M-101 so both workers collide.
    const req: EquipmentRequest = { ...defaultRequest(), id: 'req-single', quantity: 1 };
    const plan = allocate(req, worldOf(setup), DEMO_NOW);
    expect(plan.transfers.map((t) => t.assetId)).toEqual(['M-101']);
    const workerSrc = `
      const { parentPort, workerData } = require('node:worker_threads');
      (async () => {
        const { BorrowFirstStore } = await import(${JSON.stringify(
          'file://' + join(process.cwd(), 'server-dist/store.js'),
        )});
        const { seedWorld, DEMO_NOW } = await import(${JSON.stringify(
          'file://' + join(process.cwd(), 'server-dist/fixtures.js'),
        )});
        const seed = seedWorld();
        const store = new BorrowFirstStore(workerData.dbPath);
        const result = store.reserve(workerData.request, workerData.plan, seed.locations, DEMO_NOW, DEMO_NOW);
        store.close();
        parentPort.postMessage(result);
      })();
    `;
    const results = await Promise.all(
      ['req-A', 'req-B'].map(
        (id) =>
          new Promise<{ ok: boolean }>((resolve, reject) => {
            const worker = new Worker(workerSrc, {
              eval: true,
              workerData: { dbPath: path, request: { ...req, id }, plan },
            });
            worker.on('message', resolve);
            worker.on('error', reject);
          }),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const final = new BorrowFirstStore(path); // inspect without reseeding
    stores.push(final);
    const active = final
      .loadWorld(LOCATIONS, DEMO_NOW)
      .reservations.filter((r) => r.status === 'confirmed');
    expect(active).toHaveLength(1);
    expect(active[0].assetId).toBe('M-101');
  });
});

describe('B06 — inventory drift after review invalidates the plan', () => {
  it('asset damaged post-review rejects the stale allocation', () => {
    const store = freshStore();
    const { request, plan } = readyPlan(store);
    store.markDamaged('M-204');
    const result = store.reserve(request, plan, LOCATIONS, DEMO_NOW, DEMO_NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failures.some((f) => f.code === 'STALE_ASSET' || f.code === 'ASSET_INCOMPATIBLE')).toBe(true);
    }
    expect(worldOf(store).reservations).toHaveLength(0);
  });
});

describe('B07 — expired holds stop blocking', () => {
  it('a hold in the past does not block a later reservation', () => {
    const store = freshStore();
    store.insertHold('M-101', 'req-old', '2026-09-30T17:00:00.000Z', DEMO_NOW); // already expired
    const { request, plan } = readyPlan(store);
    const result = store.reserve(request, plan, LOCATIONS, DEMO_NOW, DEMO_NOW);
    expect(result.ok).toBe(true);
  });

  it('a live hold placed after planning blocks the reserve', () => {
    const store = freshStore();
    const { request, plan } = readyPlan(store); // plan includes M-101
    expect(plan.transfers.map((t) => t.assetId)).toContain('M-101');
    store.insertHold('M-101', 'req-hold', '2026-12-31T00:00:00.000Z', DEMO_NOW); // far future
    const blocked = store.reserve(request, plan, LOCATIONS, DEMO_NOW, DEMO_NOW);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.failures.some((f) => f.code === 'ASSET_RESERVED')).toBe(true);
    }
  });
});

describe('B11 (store) — conditional assets cannot be reserved', () => {
  it('reserve rejects when owner confirmation is still pending', () => {
    const store = freshStore(); // M-204 NOT confirmed
    const request = defaultRequest();
    const plan = allocate(request, worldOf(store), DEMO_NOW);
    const result = store.reserve(request, plan, LOCATIONS, DEMO_NOW, DEMO_NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failures.some((f) => f.code === 'UNCONFIRMED_ASSET')).toBe(true);
    }
  });
});
