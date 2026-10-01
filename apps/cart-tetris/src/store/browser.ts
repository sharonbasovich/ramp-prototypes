import type { PersistedState, StoreAdapter } from './adapter';

const DB_NAME = 'cart-tetris';
const STORE = 'kv';
const KEY = 'state';
const LS_KEY = 'cart-tetris:state';

/**
 * Browser sandbox persistence: one IndexedDB object store holding a single
 * JSON document, written inside a readwrite transaction. IndexedDB is scoped
 * to this origin and this browser profile only — it does not sync, share, or
 * survive a profile wipe, which is exactly the honest sandbox boundary shown
 * in the UI. Falls back to localStorage when IndexedDB is unavailable.
 */
export function createBrowserStore(): StoreAdapter {
  const dbPromise = openDb().catch(() => null);
  const ls = {
    load: (): PersistedState | null => {
      try {
        const raw = localStorage.getItem(LS_KEY);
        return raw ? (JSON.parse(raw) as PersistedState) : null;
      } catch {
        return null;
      }
    },
    save: (s: PersistedState) => {
      localStorage.setItem(LS_KEY, JSON.stringify(s));
    },
    clear: () => localStorage.removeItem(LS_KEY),
  };

  return {
    mode: 'browser',
    healthy: false,
    async load() {
      const db = await dbPromise;
      if (!db) return ls.load();
      return new Promise((resolve) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(KEY);
        req.onsuccess = () => resolve((req.result as PersistedState | undefined) ?? null);
        req.onerror = () => resolve(ls.load());
      });
    },
    async save(state) {
      const db = await dbPromise;
      if (!db) return ls.save(state);
      return new Promise((resolve) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(state, KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve(ls.save(state));
      });
    },
    async clear() {
      const db = await dbPromise;
      if (!db) return ls.clear();
      return new Promise((resolve) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve(ls.clear());
      });
    },
  };
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
