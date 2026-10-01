// shared/memstore.mjs — in-memory store implementing the engine's store
// contract. Used by the single-tab browser sandbox; the adapter persists the
// serialized state to localStorage after each transaction.
//
// IMPORTANT: this store is honest about scope. A JS object in one tab gives
// atomicity for sequential UI actions only — it does NOT provide cross-tab
// or cross-client coordination. That claim belongs to the SQLite backend.

import { DEFAULT_SEED, DEFAULT_CLOCK_ISO } from './seed.mjs';

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

export function createMemStore(seed = DEFAULT_SEED) {
  const state = { epoch: 0, seq: 0 };
  loadInto(state, seed);

  function loadInto(s, newSeed) {
    s.epoch += 1;
    s.seq = 0;
    s.clockMs = Date.parse(newSeed.clockInstant ?? DEFAULT_CLOCK_ISO);
    s.event = clone(newSeed.event);
    s.bookings = clone(newSeed.bookings);
    s.policies = clone(newSeed.policies);
    s.providers = clone(newSeed.providers);
    s.requests = [];
    s.outcomes = [];
    s.events = [];
    addEvent(s, {
      kind: 'reset',
      detail: 'Sandbox reset to the labeled demo fixtures. Bookings, policies and provider outcomes are all samples.',
    });
  }

  function addEvent(s, ev) {
    s.seq += 1;
    s.events.push({ seq: s.seq, ts: s.clockMs, ...ev });
  }

  const store = {
    transact(fn) {
      return fn();
    },
    epoch() {
      return state.epoch;
    },
    getClockMs() {
      return state.clockMs;
    },
    setClockMs(ms) {
      state.clockMs = ms;
    },
    getEvent() {
      return clone(state.event);
    },
    setEvent(ev) {
      state.event = clone(ev);
    },
    listBookings() {
      return state.bookings.map((b) => clone(b));
    },
    getBooking(bookingId) {
      const b = state.bookings.find((x) => x.bookingId === bookingId);
      return b ? clone(b) : undefined;
    },
    updateBooking(bookingId, patch) {
      const b = state.bookings.find((x) => x.bookingId === bookingId);
      if (b) Object.assign(b, patch);
    },
    getPolicy(policyId) {
      const p = state.policies.find((x) => x.policyId === policyId);
      return p ? clone(p) : undefined;
    },
    listPolicies() {
      return state.policies.map((p) => clone(p));
    },
    getProviders() {
      return clone(state.providers);
    },
    getRequest(requestId) {
      const r = state.requests.find((x) => x.requestId === requestId);
      return r ? clone(r) : undefined;
    },
    getRequestByBooking(bookingId) {
      const r = state.requests.find((x) => x.bookingId === bookingId);
      return r ? clone(r) : undefined;
    },
    listRequests() {
      return state.requests.map((r) => clone(r));
    },
    insertRequest(row) {
      state.seq += 1;
      state.requests.push({ ...row, seq: state.seq });
    },
    updateRequest(requestId, patch) {
      const r = state.requests.find((x) => x.requestId === requestId);
      if (r) Object.assign(r, patch);
    },
    insertOutcome(row) {
      state.seq += 1;
      state.outcomes.push({ ...row, seq: state.seq });
    },
    listOutcomes() {
      return state.outcomes.map((o) => clone(o));
    },
    listOutcomesForRequest(requestId) {
      return state.outcomes.filter((o) => o.requestId === requestId).map((o) => clone(o));
    },
    addEvent(ev) {
      addEvent(state, ev);
    },
    listEvents() {
      return [...state.events].sort((a, b) => b.seq - a.seq).slice(0, 200);
    },
    resetAll(newSeed = DEFAULT_SEED) {
      loadInto(state, newSeed);
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
