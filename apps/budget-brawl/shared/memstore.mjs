// shared/memstore.mjs — in-memory store implementing the engine's store
// contract. Used by the single-tab browser sandbox; the adapter persists the
// serialized state to localStorage after each transaction.
//
// IMPORTANT: this store is honest about scope. A JS object in one tab gives
// atomicity for sequential UI actions only — it does NOT prove cross-client
// or cross-tab enforcement. That claim belongs to the SQLite backend.

import { DEFAULT_SEED } from './seed.mjs';

const HOLD_STATUSES = new Set(['reserved', 'awaiting_approval']);

export function createMemStore(seed = DEFAULT_SEED) {
  const state = {
    epoch: 1,
    seq: 0,
    wallet: { ...seed.wallet },
    catalog: seed.catalog.map((c) => ({ ...c })),
    agents: seed.agents.map((a) => ({ agentId: a.agentId, name: a.name, lane: a.lane })),
    permissions: Object.fromEntries(seed.agents.map((a) => [a.agentId, [...a.items]])),
    requests: [],
    purchases: [],
    events: [],
  };

  const store = {
    transact(fn) {
      return fn();
    },
    epoch() {
      return state.epoch;
    },
    getWallet() {
      return { ...state.wallet };
    },
    setWallet(patch) {
      Object.assign(state.wallet, patch);
    },
    getItem(itemId) {
      const it = state.catalog.find((c) => c.itemId === itemId);
      return it ? { ...it } : undefined;
    },
    listCatalog() {
      return state.catalog.map((c) => ({ ...c }));
    },
    setItemPrice(itemId, priceMinor) {
      const it = state.catalog.find((c) => c.itemId === itemId);
      if (it) it.priceMinor = priceMinor;
    },
    getAgent(agentId) {
      const a = state.agents.find((x) => x.agentId === agentId);
      return a ? { ...a } : undefined;
    },
    listAgents() {
      return state.agents.map((a) => ({ ...a }));
    },
    listPermissions(agentId) {
      return [...(state.permissions[agentId] ?? [])];
    },
    getRequest(requestId) {
      const r = state.requests.find((x) => x.requestId === requestId);
      return r ? { ...r } : undefined;
    },
    insertRequest(row) {
      state.seq += 1;
      state.requests.push({ ...row, seq: state.seq });
    },
    updateRequest(requestId, patch) {
      const r = state.requests.find((x) => x.requestId === requestId);
      if (r) Object.assign(r, patch);
    },
    insertPurchase(row) {
      if (state.purchases.some((p) => p.requestId === row.requestId)) return;
      state.seq += 1;
      state.purchases.push({ ...row, seq: state.seq });
    },
    sumSpent() {
      return state.purchases.reduce((s, p) => s + p.amountMinor, 0);
    },
    sumHeld() {
      return state.requests
        .filter((r) => r.fundsHeld && HOLD_STATUSES.has(r.status))
        .reduce((s, r) => s + r.amountMinor, 0);
    },
    addEvent(ev) {
      state.seq += 1;
      state.events.push({ seq: state.seq, ts: Date.now(), ...ev });
    },
    listEvents() {
      return [...state.events].sort((a, b) => b.seq - a.seq).slice(0, 200);
    },
    listRequests() {
      return [...state.requests].sort((a, b) => b.seq - a.seq).map((r) => ({ ...r }));
    },
    listPurchases() {
      return [...state.purchases].sort((a, b) => b.seq - a.seq).map((p) => ({ ...p }));
    },
    resetAll(newSeed = DEFAULT_SEED) {
      state.epoch += 1;
      state.seq = 0;
      state.wallet = { ...newSeed.wallet };
      state.catalog = newSeed.catalog.map((c) => ({ ...c }));
      state.agents = newSeed.agents.map((a) => ({ agentId: a.agentId, name: a.name, lane: a.lane }));
      state.permissions = Object.fromEntries(newSeed.agents.map((a) => [a.agentId, [...a.items]]));
      state.requests = [];
      state.purchases = [];
      state.events = [];
      state.seq += 1;
      state.events.push({ seq: state.seq, ts: Date.now(), kind: 'reset', detail: `Sandbox reset to ${(newSeed.wallet.budgetMinor / 100).toFixed(2)} sample budget.` });
    },
    serialize() {
      return JSON.stringify(state);
    },
    restore(json) {
      const parsed = JSON.parse(json);
      Object.assign(state, parsed);
    },
  };
  return store;
}
