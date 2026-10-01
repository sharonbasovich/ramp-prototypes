import type { BackendApi, OpResponse, RequestResult, SeedConfig, Snapshot } from './types.ts';

async function call<T>(path: string, body?: unknown): Promise<OpResponse<T>> {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) return { ok: false, error: data.error };
  return { ok: true, result: data.result as T };
}

export function serverBackend(): BackendApi {
  return {
    mode: 'sqlite',
    async state() {
      const r = await call<Snapshot>('/api/state');
      if (!r.ok) throw new Error(r.error.detail);
      return r.result;
    },
    async reset(config?: SeedConfig) {
      const r = await call<Snapshot>('/api/reset', config ? { config } : {});
      if (!r.ok) throw new Error(r.error.detail);
      return r.result;
    },
    configure(cfg) {
      return call('/api/config', cfg);
    },
    setCatalogPrice(itemId, priceMinor) {
      return call('/api/catalog/price', { itemId, priceMinor });
    },
    placeRequest(req) {
      return call<RequestResult>('/api/requests', req);
    },
    act(requestId, action, epoch) {
      return call<RequestResult>(`/api/requests/${encodeURIComponent(requestId)}/${action}`, { epoch });
    },
  };
}
