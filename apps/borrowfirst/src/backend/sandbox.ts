// Browser-sandbox store: the same world model and the same engine, with
// localStorage persistence on this origin and Web Locks serialization for
// writes. Honest scope: single browser, single origin — no server, no
// cross-device sync, no multi-user atomicity guarantees.

import { validateReservation } from '../engine/allocate';
import { seedWorld, DEMO_NOW } from '../engine/fixtures';
import type {
  AllocationPlan,
  Asset,
  EquipmentRequest,
  Reservation,
  TransferOption,
  World,
} from '../engine/types';

const KEY = 'borrowfirst.sandbox.v1';
const LOCK = 'borrowfirst-sandbox-write';

interface Persisted {
  version: number;
  world: World;
}

// Bumped whenever the world shape changes — stale payloads are reseeded
// rather than half-understood.
const PERSIST_VERSION = 2;

function isUsablePersisted(parsed: unknown): parsed is Persisted {
  const p = parsed as Persisted;
  return (
    !!p &&
    p.version === PERSIST_VERSION &&
    !!p.world &&
    Array.isArray(p.world.assets) &&
    Array.isArray(p.world.transferOptions) &&
    // Routes without a destination were written by a pre-route schema and
    // would silently match nothing — treat the payload as unusable.
    p.world.transferOptions.every((t) => typeof t.destinationLocationId === 'string')
  );
}

export class SandboxStore {
  // In-memory world used ONLY when localStorage is genuinely broken
  // (throws on read/write). With working storage every load() re-reads so
  // separate tabs/instances stay consistent through the shared store —
  // instance memory never masks another writer's state.
  private memoryWorld: World | null = null;
  private storageBroken = false;

  load(): World {
    if (!this.storageBroken) {
      try {
        const raw = localStorage.getItem(KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (isUsablePersisted(parsed)) return structuredClone(parsed.world);
          // Missing/legacy/corrupt payload — reseed honestly below.
        }
      } catch {
        this.storageBroken = true;
      }
    }
    if (this.memoryWorld) return structuredClone(this.memoryWorld);
    const world = seedWorld();
    this.persist(world);
    return world;
  }

  private persist(world: World): void {
    if (!this.storageBroken) {
      try {
        localStorage.setItem(KEY, JSON.stringify({ version: PERSIST_VERSION, world }));
        this.memoryWorld = null;
        return;
      } catch {
        this.storageBroken = true;
      }
    }
    this.memoryWorld = structuredClone(world);
  }

  reset(): World {
    const world = seedWorld();
    this.persist(world);
    return world;
  }

  ownerConfirm(assetId: string): World {
    const world = this.load();
    const asset = world.assets.find((a) => a.id === assetId);
    if (asset) {
      asset.ownerConfirmedAt = DEMO_NOW;
      asset.version += 1;
      this.persist(world);
    }
    return world;
  }

  addAssets(assets: Asset[], transfers: TransferOption[]): void {
    const world = this.load();
    world.assets.push(...assets);
    world.transferOptions.push(...transfers);
    this.persist(world);
  }

  // Sweep expired holds before evaluating — same rule as the server,
  // but the comparison is Date-parsed instants (offsets handled).
  private sweepExpiredHolds(world: World): void {
    const n = Date.parse(world.demoNow);
    for (const r of world.reservations) {
      if (r.status === 'held' && r.expiresAt !== null && Date.parse(r.expiresAt) <= n) {
        r.status = 'expired';
      }
    }
  }

  // Same revalidation as the SQLite transaction, serialized by a Web Lock
  // when available so overlapping writes in this browser cannot interleave.
  async reserve(
    request: EquipmentRequest,
    plan: AllocationPlan,
  ): Promise<{ ok: boolean; reservations: Reservation[]; failures: import('../engine/types').ReserveFailure[]; world: World }> {
    const doReserve = () => {
      const world = this.load();
      this.sweepExpiredHolds(world);
      const failures = validateReservation(plan, world, DEMO_NOW);
      if (failures.length > 0) return { ok: false as const, reservations: [], failures, world };
      const created: Reservation[] = plan.transfers.map((l) => ({
        id: `rsv-${request.id}-${l.assetId}`,
        assetId: l.assetId,
        requestId: request.id,
        status: 'confirmed' as const,
        expiresAt: null,
        createdAt: DEMO_NOW,
      }));
      world.reservations.push(...created);
      this.persist(world);
      return { ok: true as const, reservations: created, failures: [], world };
    };

    const locks =
      typeof navigator !== 'undefined' && 'locks' in navigator ? navigator.locks : undefined;
    if (locks) {
      return locks.request(LOCK, doReserve) as Promise<ReturnType<typeof doReserve>>;
    }
    return Promise.resolve(doReserve());
  }
}
