import type { PersistedState, StoreAdapter } from './adapter';

/**
 * Server-backed sandbox: the Node server persists state in node:sqlite and is
 * only advertised after a genuine /api/health round-trip succeeds. When the
 * fetch fails the caller falls back to the browser adapter; the UI never
 * claims this mode without a live health check.
 */
export function createServerStore(): StoreAdapter {
  return {
    mode: 'server',
    healthy: true,
    async load() {
      const res = await fetch('./api/state', { headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`/api/state ${res.status}`);
      return (await res.json()) as PersistedState | null;
    },
    async save(state) {
      const res = await fetch('./api/state', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(state),
      });
      if (!res.ok) throw new Error(`/api/state ${res.status}`);
    },
    async clear() {
      await fetch('./api/state', { method: 'DELETE' });
    },
  };
}

export async function probeServer(): Promise<boolean> {
  try {
    const res = await fetch('./api/health', { headers: { accept: 'application/json' } });
    if (!res.ok) return false;
    const body = (await res.json()) as { ok?: boolean; store?: string };
    return body.ok === true && body.store === 'sqlite';
  } catch {
    return false;
  }
}
