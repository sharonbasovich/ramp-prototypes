// SQLite-backed store for the BorrowFirst full-stack sandbox. Uses
// node:sqlite (Node 22) — no native addons. Reservation writes run inside
// a single BEGIN IMMEDIATE transaction that revalidates the whole plan
// before inserting; a partial unique index on active reservations is the
// hard backstop even if two writers race.

import { DatabaseSync } from 'node:sqlite';
import { validateReservation } from './allocate.js';
import { seedWorld } from './fixtures.js';
import type {
  AllocationPlan,
  Asset,
  EquipmentRequest,
  PurchaseOption,
  Reservation,
  ReserveFailure,
  TransferOption,
  World,
} from './types.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  size_inches REAL NOT NULL,
  ports TEXT NOT NULL,
  location_id TEXT NOT NULL,
  owner_name TEXT NOT NULL,
  condition TEXT NOT NULL,
  availability TEXT NOT NULL,
  owner_confirm_required INTEGER NOT NULL,
  owner_confirmed_at TEXT,
  source TEXT NOT NULL DEFAULT 'fixture',
  version INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS transfer_options (
  asset_id TEXT PRIMARY KEY REFERENCES assets(id),
  cost_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  earliest_arrival TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS purchase_options (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  category TEXT NOT NULL,
  size_inches REAL NOT NULL,
  ports TEXT NOT NULL,
  unit_cost_cents INTEGER NOT NULL,
  flat_shipping_cents INTEGER NOT NULL,
  max_quantity INTEGER NOT NULL,
  currency TEXT NOT NULL,
  delivery_instant TEXT NOT NULL,
  provenance TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  version INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS reservations (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES assets(id),
  request_id TEXT NOT NULL,
  status TEXT NOT NULL,
  expires_at TEXT,
  created_at TEXT NOT NULL
);
-- Hard guarantee: one active reservation per asset, enforced by SQLite
-- even if revalidation and insert raced.
CREATE UNIQUE INDEX IF NOT EXISTS one_active_reservation_per_asset
  ON reservations(asset_id) WHERE status IN ('held', 'confirmed');
`;

export interface ReserveOk {
  ok: true;
  reservations: Reservation[];
}
export interface ReserveConflict {
  ok: false;
  failures: ReserveFailure[];
}
export type ReserveResult = ReserveOk | ReserveConflict;

export class BorrowFirstStore {
  readonly db: DatabaseSync;

  constructor(path: string = ':memory:') {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA busy_timeout = 150;');
    // Schema/journal setup can briefly contend with another writer on a
    // shared file database — retry instead of surfacing a transient busy.
    let lastErr: unknown;
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        this.db.exec('PRAGMA journal_mode = WAL;');
        this.db.exec(SCHEMA);
        return;
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes('BUSY') && !msg.includes('locked')) throw err;
        const wait = 25 * (attempt + 1);
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait);
      }
    }
    throw lastErr;
  }

  reset(world: World = seedWorld()): void {
    this.db.exec('BEGIN');
    try {
      for (const table of ['reservations', 'transfer_options', 'purchase_options', 'assets']) {
        this.db.exec(`DELETE FROM ${table}`);
      }
      const insAsset = this.db.prepare(
        `INSERT INTO assets (id, name, category, size_inches, ports, location_id, owner_name, condition, availability, owner_confirm_required, owner_confirmed_at, source, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const a of world.assets) {
        insAsset.run(
          a.id, a.name, a.category, a.specs.sizeInches, JSON.stringify(a.specs.ports),
          a.locationId, a.ownerName, a.condition, a.availability,
          a.ownerConfirmationRequired ? 1 : 0, a.ownerConfirmedAt, a.source, a.version,
        );
      }
      const insTransfer = this.db.prepare(
        `INSERT INTO transfer_options (asset_id, cost_cents, currency, earliest_arrival) VALUES (?, ?, ?, ?)`,
      );
      for (const t of world.transferOptions) {
        insTransfer.run(t.assetId, t.costCents, t.currency, t.earliestArrival);
      }
      const insPo = this.db.prepare(
        `INSERT INTO purchase_options (id, label, category, size_inches, ports, unit_cost_cents, flat_shipping_cents, max_quantity, currency, delivery_instant, provenance, expires_at, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const p of world.purchaseOptions) {
        insPo.run(
          p.id, p.label, p.category, p.specs.sizeInches, JSON.stringify(p.specs.ports),
          p.unitCostCents, p.flatShippingCents, p.maxQuantity, p.currency,
          p.deliveryInstant, p.provenance, p.expiresAt, p.version,
        );
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  loadWorld(locations: World['locations'], demoNow: string): World {
    const assets = this.db
      .prepare('SELECT * FROM assets ORDER BY rowid')
      .all() as unknown as Record<string, unknown>[];
    const transferOptions = this.db
      .prepare('SELECT * FROM transfer_options')
      .all() as unknown as Record<string, unknown>[];
    const purchaseOptions = this.db
      .prepare('SELECT * FROM purchase_options ORDER BY id')
      .all() as unknown as Record<string, unknown>[];
    const reservations = this.db
      .prepare('SELECT * FROM reservations ORDER BY created_at, id')
      .all() as unknown as Record<string, unknown>[];
    return {
      demoNow,
      locations,
      assets: assets.map(rowToAsset),
      transferOptions: transferOptions.map(rowToTransfer),
      purchaseOptions: purchaseOptions.map(rowToPurchase),
      reservations: reservations.map(rowToReservation),
    };
  }

  ownerConfirm(assetId: string, at: string): boolean {
    const res = this.db
      .prepare(`UPDATE assets SET owner_confirmed_at = ?, version = version + 1 WHERE id = ?`)
      .run(at, assetId);
    return Number(res.changes) > 0;
  }

  markDamaged(assetId: string): void {
    this.db
      .prepare(`UPDATE assets SET condition = 'damaged', version = version + 1 WHERE id = ?`)
      .run(assetId);
  }

  insertHold(assetId: string, requestId: string, expiresAt: string, now: string): Reservation {
    const id = `hold-${requestId}-${assetId}`;
    this.db
      .prepare(`INSERT INTO reservations (id, asset_id, request_id, status, expires_at, created_at) VALUES (?, ?, ?, 'held', ?, ?)`)
      .run(id, assetId, requestId, expiresAt, now);
    return { id, assetId, requestId, status: 'held', expiresAt, createdAt: now };
  }

  importRows(assets: Asset[], transfers: TransferOption[]): void {
    const insAsset = this.db.prepare(
      `INSERT INTO assets (id, name, category, size_inches, ports, location_id, owner_name, condition, availability, owner_confirm_required, owner_confirmed_at, source, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'imported', 1)`,
    );
    const insTransfer = this.db.prepare(
      `INSERT INTO transfer_options (asset_id, cost_cents, currency, earliest_arrival) VALUES (?, ?, ?, ?)`,
    );
    this.db.exec('BEGIN');
    try {
      for (const a of assets) {
        insAsset.run(
          a.id, a.name, a.category, a.specs.sizeInches, JSON.stringify(a.specs.ports),
          a.locationId, a.ownerName, a.condition, a.availability,
          a.ownerConfirmationRequired ? 1 : 0,
        );
      }
      for (const t of transfers) insTransfer.run(t.assetId, t.costCents, t.currency, t.earliestArrival);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  // Transactional reservation: revalidate the reviewed plan against live
  // inventory inside BEGIN IMMEDIATE, then insert all asset reservations
  // together. Any stale, conflicting, or conditional line rejects the whole
  // plan — the caller recalculates instead of keeping a partial hold.
  reserve(
    request: EquipmentRequest,
    plan: AllocationPlan,
    locations: World['locations'],
    demoNow: string,
    now: string,
  ): ReserveResult {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      // Sweep expired holds inside the transaction so the partial unique
      // index only ever holds genuinely active rows.
      this.db
        .prepare(
          `UPDATE reservations SET status = 'expired' WHERE status = 'held' AND expires_at IS NOT NULL AND expires_at <= ?`,
        )
        .run(now);
      const world = this.loadWorld(locations, demoNow);
      const failures = validateReservation(plan, world, now);
      if (failures.length > 0) {
        this.db.exec('ROLLBACK');
        return { ok: false, failures };
      }
      const reservations: Reservation[] = [];
      const ins = this.db.prepare(
        `INSERT INTO reservations (id, asset_id, request_id, status, expires_at, created_at) VALUES (?, ?, ?, 'confirmed', NULL, ?)`,
      );
      for (const line of plan.transfers) {
        const id = `rsv-${request.id}-${line.assetId}`;
        ins.run(id, line.assetId, request.id, now);
        reservations.push({
          id,
          assetId: line.assetId,
          requestId: request.id,
          status: 'confirmed',
          expiresAt: null,
          createdAt: now,
        });
      }
      this.db.exec('COMMIT');
      return { ok: true, reservations };
    } catch (err) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // already rolled back
      }
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('UNIQUE') || msg.includes('SQLITE_BUSY')) {
        return {
          ok: false,
          failures: [
            {
              code: 'ASSET_RESERVED',
              detail: 'Another request reserved an asset in this plan first — recalculate',
            },
          ],
        };
      }
      throw err;
    }
  }
}

function rowToAsset(r: Record<string, unknown>): Asset {
  return {
    id: String(r.id),
    name: String(r.name),
    category: r.category as Asset['category'],
    specs: { sizeInches: Number(r.size_inches), ports: JSON.parse(String(r.ports)) },
    locationId: String(r.location_id),
    ownerName: String(r.owner_name),
    condition: r.condition as Asset['condition'],
    availability: r.availability as Asset['availability'],
    ownerConfirmationRequired: Number(r.owner_confirm_required) === 1,
    ownerConfirmedAt: (r.owner_confirmed_at as string | null) ?? null,
    source: (r.source as Asset['source']) ?? 'fixture',
    version: Number(r.version),
  };
}

function rowToTransfer(r: Record<string, unknown>): TransferOption {
  return {
    assetId: String(r.asset_id),
    costCents: Number(r.cost_cents),
    currency: r.currency as TransferOption['currency'],
    earliestArrival: String(r.earliest_arrival),
  };
}

function rowToPurchase(r: Record<string, unknown>): PurchaseOption {
  return {
    id: String(r.id),
    label: String(r.label),
    category: r.category as PurchaseOption['category'],
    specs: { sizeInches: Number(r.size_inches), ports: JSON.parse(String(r.ports)) },
    unitCostCents: Number(r.unit_cost_cents),
    flatShippingCents: Number(r.flat_shipping_cents),
    maxQuantity: Number(r.max_quantity),
    currency: r.currency as PurchaseOption['currency'],
    deliveryInstant: String(r.delivery_instant),
    provenance: String(r.provenance),
    expiresAt: String(r.expires_at),
    version: Number(r.version),
  };
}

function rowToReservation(r: Record<string, unknown>): Reservation {
  return {
    id: String(r.id),
    assetId: String(r.asset_id),
    requestId: String(r.request_id),
    status: r.status as Reservation['status'],
    expiresAt: (r.expires_at as string | null) ?? null,
    createdAt: String(r.created_at),
  };
}
