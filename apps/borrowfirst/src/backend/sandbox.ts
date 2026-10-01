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
  world: World;
}

export class SandboxStore {
  // In-memory fallback for when localStorage is blocked or throws —
  // state then lives only for this instance's lifetime, never reseeding
  // silently between calls.
  private memoryWorld: World | null = null;

  load(): World {
    // Always hand out a copy — callers mutate the world then pass it to
    // persist(); returning memoryWorld itself would corrupt the cache.
    if (this.memoryWorld) return structuredClone(this.memoryWorld);
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Persisted;
        if (parsed.world && Array.isArray(parsed.world.assets)) {
          this.memoryWorld = parsed.world;
          return structuredClone(this.memoryWorld);
        }
      }
    } catch {
      // storage unavailable — fall back to instance memory below
    }
    const world = seedWorld();
    this.persist(world);
    return world;
  }

  private persist(world: World): void {
    this.memoryWorld = structuredClone(world);
    try {
      localStorage.setItem(KEY, JSON.stringify({ world }));
    } catch {
      // storage full/blocked — instance memory still holds the state
    }
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
