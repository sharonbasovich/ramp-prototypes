import type { BackendApi, OpResponse, Snapshot } from '../types.ts';

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
    async reset(config?: unknown) {
      const r = await call<Snapshot>('/api/reset', config ? { config } : {});
      if (!r.ok) throw new Error(r.error.detail);
      return r.result;
    },
    setClock(instant) {
      return call('/api/clock', { instant });
    },
    cancelEvent() {
      return call('/api/event/cancel', {});
    },
    preparePacket() {
      return call('/api/packet/prepare', {});
    },
    approvePacket() {
      return call('/api/packet/approve', {});
    },
    executePacket() {
      return call('/api/packet/execute', {});
    },
    executeRequest(requestId) {
      return call(`/api/requests/${encodeURIComponent(requestId)}/execute`, {});
    },
    markRefundReceived(requestId) {
      return call(`/api/requests/${encodeURIComponent(requestId)}/refund-received`, {});
    },
    editBookingAmounts(bookingId, patch) {
      return call('/api/bookings/amounts', { bookingId, ...patch });
    },
    async exportPacket() {
      const r = await call<unknown>('/api/packet/export');
      if (!r.ok) throw new Error(r.error.detail);
      return r.result;
    },
  };
}
