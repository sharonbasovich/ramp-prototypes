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
  load(): World {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Persisted;
        if (parsed.world && Array.isArray(parsed.world.assets)) return parsed.world;
      }
    } catch {
      // corrupted state falls through to reseed
    }
    const world = seedWorld();
    this.persist(world);
    return world;
  }

  private persist(world: World): void {
    try {
      localStorage.setItem(KEY, JSON.stringify({ world }));
    } catch {
      // storage full/blocked — keep running in memory for this session
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

  // Same revalidation as the SQLite transaction, serialized by a Web Lock
  // when available so overlapping writes in this browser cannot interleave.
  async reserve(
    request: EquipmentRequest,
    plan: AllocationPlan,
  ): Promise<{ ok: boolean; reservations: Reservation[]; failures: import('../engine/types').ReserveFailure[]; world: World }> {
    const doReserve = () => {
      const world = this.load();
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
