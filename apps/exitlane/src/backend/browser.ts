// Browser sandbox backend — same engine as the SQLite server, applied to an
// in-memory store persisted to localStorage. Honest scope: single tab on
// this origin only. It demonstrates the full deterministic state machine;
// it does not prove server-side concurrency and says so on screen.

import { createMemStore } from '../../shared/memstore.mjs';
import * as engine from '../../shared/engine.mjs';
import { buildSeed } from '../../shared/seed.mjs';
import { serverBackend } from './server.ts';
import type { BackendApi, OpResponse, Snapshot } from '../types.ts';

const LS_KEY = 'exitlane:v1';

interface LockManagerLite {
  request(name: string, cb: () => unknown): Promise<unknown>;
}

function createBrowserBackend(): BackendApi {
  const store = createMemStore();
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) store.restore(raw);
  } catch {
    /* corrupt or unavailable storage — start fresh */
  }

  // Engine ops return {ok:false, status, code, detail} on failure; the UI
  // contract is {ok:false, error:{code,detail}} — normalize once here.
  const norm = <T>(op: unknown): OpResponse<T> => {
    const o = op as { ok: boolean; result?: T; code?: string; detail?: string };
    if (o.ok) return { ok: true, result: o.result as T };
    return { ok: false, error: { code: o.code ?? 'error', detail: o.detail ?? 'failed' } };
  };

  const persist = () => {
    try {
      localStorage.setItem(LS_KEY, store.serialize());
    } catch {
      /* storage unavailable — session-local only */
    }
  };

  const run = <T>(fn: () => T): Promise<T> => {
    const locks = (navigator as { locks?: LockManagerLite }).locks;
    if (locks?.request) {
      return locks.request('exitlane-tab', () => {
        const out = fn();
        persist();
        return out;
      }) as Promise<T>;
    }
    const out = fn();
    persist();
    return Promise.resolve(out);
  };

  return {
    mode: 'browser',
    state() {
      return run(() => engine.snapshot(store) as Snapshot);
    },
    reset(config?: unknown) {
      return run(() => {
        const built = buildSeed(config);
        if (!built.ok) throw new Error(built.error);
        return engine.reset(store, built.seed) as Snapshot;
      });
    },
    setClock(instant) {
      return run(() => norm(engine.setClock(store, instant)));
    },
    cancelEvent() {
      return run(() => norm(engine.cancelEvent(store)));
    },
    preparePacket() {
      return run(() => norm(engine.preparePacket(store)));
    },
    approvePacket() {
      return run(() => norm(engine.approvePacket(store)));
    },
    executePacket() {
      return run(() => norm(engine.executePacket(store)));
    },
    executeRequest(requestId) {
      return run(() => norm(engine.executeRequest(store, requestId)));
    },
    markRefundReceived(requestId) {
      return run(() => norm(engine.markRefundReceived(store, requestId)));
    },
    editBookingAmounts(bookingId, patch) {
      return run(() => norm(engine.editBookingAmounts(store, bookingId, patch)));
    },
    exportPacket() {
      return run(() => engine.exportPacket(store, 'Browser sandbox — this tab only'));
    },
  };
}

export async function connectBackend(): Promise<BackendApi> {
  try {
    const res = await fetch('/api/health', { signal: AbortSignal.timeout(2500) });
    if (res.ok) {
      const data = await res.json();
      if (data?.engine === 'sqlite') return serverBackend();
    }
  } catch {
    /* fall through to browser sandbox */
  }
  return createBrowserBackend();
}
