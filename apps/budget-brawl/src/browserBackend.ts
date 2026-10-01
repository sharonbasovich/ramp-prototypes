// Browser sandbox backend — same engine as the SQLite server, applied to an
// in-memory store persisted to localStorage. Honest scope: single tab on this
// origin only. It demonstrates the state machine; it cannot enforce budgets
// across clients or prove server-side concurrency.

import { createMemStore } from '../shared/memstore.mjs';
import * as engine from '../shared/engine.mjs';
import { buildSeed } from '../shared/seed.mjs';
import { serverBackend } from './serverBackend.ts';
import type { BackendApi, OpResponse, RequestResult, SeedConfig } from './types.ts';

const LS_KEY = 'budget-brawl:v1';

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

  const persist = () => {
    try {
      localStorage.setItem(LS_KEY, store.serialize());
    } catch {
      /* storage unavailable — session-local only */
    }
  };

  // Serialize mutations within this tab via Web Locks when available;
  // engine ops are synchronous so the critical section is atomic.
  const run = <T>(fn: () => T): Promise<T> => {
    const locks = (navigator as { locks?: LockManagerLite }).locks;
    if (locks?.request) {
      return locks.request('budget-brawl-tab', () => {
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
      return run(() => {
        engine.sweepExpired(store, Date.now());
        return engine.snapshot(store);
      });
    },
    reset(config?: SeedConfig) {
      return run(() => {
        const built = buildSeed(config);
        if (!built.ok) throw new Error(built.error);
        return engine.reset(store, built.seed);
      });
    },
    configure(cfg) {
      return run(() => engine.configure(store, cfg));
    },
    setCatalogPrice(itemId, priceMinor) {
      return run(() => engine.setCatalogPrice(store, itemId, priceMinor));
    },
    placeRequest(req) {
      return run(
        () => engine.placeRequest(store, req, Date.now()),
      ) as Promise<OpResponse<RequestResult>>;
    },
    act(requestId, action) {
      return run(() => {
        const op =
          action === 'approve'
            ? engine.approveRequest
            : action === 'reject'
              ? engine.rejectRequest
              : action === 'commit'
                ? engine.commitRequest
                : engine.cancelRequest;
        return op(store, requestId, Date.now());
      }) as Promise<OpResponse<RequestResult>>;
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
