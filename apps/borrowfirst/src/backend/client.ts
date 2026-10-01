// Backend client for BorrowFirst. Two interchangeable adapters:
//   - SQLite mode: the Node server on this origin holds state in
//     node:sqlite; reservations are transactionally validated.
//   - Browser sandbox: the same engine runs entirely in this tab with
//     localStorage persistence and Web Locks serialization — real logic,
//     honestly labeled as single-browser.
// The mode is only called "SQLite server sandbox" after /api/health
// genuinely succeeds; otherwise the app falls back to the browser sandbox
// and says so.

import type { AllocationPlan, EquipmentRequest, ReserveFailure, Reservation, World } from '../engine/types';
import { parseAssetCsv } from '../engine/csv';
import { SandboxStore } from './sandbox';

export interface ReserveResponse {
  ok: boolean;
  reservations: Reservation[];
  failures: ReserveFailure[];
  world: World;
}

export interface Backend {
  mode: 'sqlite' | 'sandbox';
  modeLabel: string;
  modeDetail: string;
  loadState(): Promise<World>;
  reset(): Promise<World>;
  ownerConfirm(assetId: string): Promise<World>;
  reserve(request: EquipmentRequest, plan: AllocationPlan): Promise<ReserveResponse>;
  importCsv(text: string): Promise<{ added: number; errors: string[]; world: World }>;
}

const API = '/api';

class SqliteBackend implements Backend {
  mode = 'sqlite' as const;
  modeLabel = 'SQLite server sandbox';
  modeDetail = 'Reservations are validated and committed in one node:sqlite transaction on this machine. Still demo data — no real purchases.';

  private async call(path: string, init?: RequestInit): Promise<Response> {
    const res = await fetch(`${API}${path}`, init);
    const body = await res.json().catch(() => ({}));
    if (!res.ok && res.status !== 409) {
      throw new Error(body.error ?? `${path} failed (${res.status})`);
    }
    return new Response(JSON.stringify(body), { status: res.status });
  }

  async loadState(): Promise<World> {
    const res = await this.call('/state');
    return (await res.json()).world;
  }
  async reset(): Promise<World> {
    const res = await this.call('/reset', { method: 'POST' });
    return (await res.json()).world;
  }
  async ownerConfirm(assetId: string): Promise<World> {
    const res = await this.call('/owner-confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ assetId }),
    });
    return (await res.json()).world;
  }
  async reserve(request: EquipmentRequest, plan: AllocationPlan): Promise<ReserveResponse> {
    const res = await this.call('/reserve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ request, plan }),
    });
    const body = await res.json();
    return {
      ok: res.status === 200,
      reservations: body.reservations ?? [],
      failures: body.failures ?? [],
      world: body.world,
    };
  }
  async importCsv(text: string) {
    const res = await this.call('/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ csv: text }),
    });
    return res.json();
  }
}

class SandboxBackend implements Backend {
  mode = 'sandbox' as const;
  modeLabel = 'Browser sandbox';
  modeDetail =
    'Runs fully in this browser with the same engine. Persistence is localStorage on this origin; Web Locks serialize writes within this browser, but there is no server and no cross-device or multi-user atomicity.';

  private store = new SandboxStore();

  async loadState(): Promise<World> {
    return this.store.load();
  }
  async reset(): Promise<World> {
    return this.store.reset();
  }
  async ownerConfirm(assetId: string): Promise<World> {
    return this.store.ownerConfirm(assetId);
  }
  async reserve(request: EquipmentRequest, plan: AllocationPlan): Promise<ReserveResponse> {
    return this.store.reserve(request, plan);
  }
  async importCsv(text: string) {
    const world = this.store.load();
    const parsed = parseAssetCsv(text, world);
    if (parsed.assets.length > 0) {
      this.store.addAssets(parsed.assets, parsed.transfers);
    }
    return { added: parsed.assets.length, errors: parsed.errors, world: this.store.load() };
  }
}

export async function createBackend(): Promise<Backend> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(`${API}/health`, { signal: controller.signal, cache: 'no-store' });
    clearTimeout(timer);
    const body = await res.json().catch(() => null);
    if (res.ok && body?.ok && body.backend === 'sqlite') {
      return new SqliteBackend();
    }
  } catch {
    // fall through to sandbox
  }
  return new SandboxBackend();
}
