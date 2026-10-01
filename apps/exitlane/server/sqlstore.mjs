// server/sqlstore.mjs — node:sqlite store implementing the engine's store
// contract. Mutations run inside BEGIN IMMEDIATE transactions so concurrent
// HTTP requests can never observe a half-written packet or outcome.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DEFAULT_SEED, DEFAULT_CLOCK_ISO } from '../shared/seed.mjs';

export function createSqlStore(dbPath, seed = DEFAULT_SEED) {
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS event (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      epoch INTEGER NOT NULL,
      json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bookings (
      epoch INTEGER NOT NULL,
      booking_id TEXT NOT NULL,
      json TEXT NOT NULL,
      ord INTEGER NOT NULL,
      PRIMARY KEY (epoch, booking_id)
    );
    CREATE TABLE IF NOT EXISTS policies (
      epoch INTEGER NOT NULL,
      policy_id TEXT NOT NULL,
      json TEXT NOT NULL,
      ord INTEGER NOT NULL,
      PRIMARY KEY (epoch, policy_id)
    );
    CREATE TABLE IF NOT EXISTS providers (
      epoch INTEGER NOT NULL,
      provider_id TEXT NOT NULL,
      json TEXT NOT NULL,
      PRIMARY KEY (epoch, provider_id)
    );
    CREATE TABLE IF NOT EXISTS requests (
      epoch INTEGER NOT NULL,
      request_id TEXT NOT NULL,
      booking_id TEXT NOT NULL,
      json TEXT NOT NULL,
      PRIMARY KEY (epoch, request_id)
    );
    CREATE TABLE IF NOT EXISTS outcomes (
      epoch INTEGER NOT NULL,
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id TEXT NOT NULL,
      booking_id TEXT NOT NULL,
      json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      epoch INTEGER NOT NULL,
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      kind TEXT NOT NULL,
      booking_id TEXT,
      detail TEXT
    );
  `);

  const q = {
    metaGet: db.prepare('SELECT value FROM meta WHERE key = ?'),
    metaSet: db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
    epochRow: db.prepare("SELECT value FROM meta WHERE key = 'epoch'"),
    clockRow: db.prepare("SELECT value FROM meta WHERE key = 'clock_ms'"),
    event: db.prepare('SELECT json FROM event WHERE id = 1'),
    insEventRow: db.prepare('INSERT INTO event (id, epoch, json) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET epoch = excluded.epoch, json = excluded.json'),
    bookings: db.prepare('SELECT json FROM bookings WHERE epoch = ? ORDER BY ord'),
    booking: db.prepare('SELECT json, ord FROM bookings WHERE epoch = ? AND booking_id = ?'),
    insBooking: db.prepare('INSERT INTO bookings (epoch, booking_id, json, ord) VALUES (?,?,?,?) ON CONFLICT(epoch, booking_id) DO UPDATE SET json = excluded.json'),
    policy: db.prepare('SELECT json FROM policies WHERE epoch = ? AND policy_id = ?'),
    policies: db.prepare('SELECT json FROM policies WHERE epoch = ? ORDER BY ord'),
    insPolicy: db.prepare('INSERT INTO policies (epoch, policy_id, json, ord) VALUES (?,?,?,?)'),
    providers: db.prepare('SELECT provider_id, json FROM providers WHERE epoch = ?'),
    insProvider: db.prepare('INSERT INTO providers (epoch, provider_id, json) VALUES (?,?,?)'),
    request: db.prepare('SELECT json FROM requests WHERE epoch = ? AND request_id = ?'),
    requestByBooking: db.prepare('SELECT json FROM requests WHERE epoch = ? AND booking_id = ?'),
    requests: db.prepare('SELECT json FROM requests WHERE epoch = ?'),
    insRequest: db.prepare('INSERT INTO requests (epoch, request_id, booking_id, json) VALUES (?,?,?,?) ON CONFLICT(epoch, request_id) DO UPDATE SET json = excluded.json'),
    outcomes: db.prepare('SELECT json FROM outcomes WHERE epoch = ? ORDER BY seq'),
    outcomesFor: db.prepare('SELECT json FROM outcomes WHERE epoch = ? AND request_id = ? ORDER BY seq'),
    insOutcome: db.prepare('INSERT INTO outcomes (epoch, request_id, booking_id, json) VALUES (?,?,?,?)'),
    events: db.prepare('SELECT seq, ts, kind, booking_id, detail FROM events WHERE epoch = ? ORDER BY seq DESC LIMIT 200'),
    insEvent: db.prepare('INSERT INTO events (epoch, ts, kind, booking_id, detail) VALUES (?,?,?,?,?)'),
  };

  function epoch() {
    return Number(q.epochRow.get()?.value ?? 0);
  }

  function getClockMs() {
    return Number(q.clockRow.get()?.value ?? Date.parse(DEFAULT_CLOCK_ISO));
  }

  function addEvent(ev) {
    q.insEvent.run(epoch(), getClockMs(), ev.kind ?? 'event', ev.bookingId ?? null, ev.detail ?? null);
  }

  function seedAll(s) {
    const nextEpoch = epoch() + 1;
    q.metaSet.run('epoch', String(nextEpoch));
    q.metaSet.run('clock_ms', String(Date.parse(s.clockInstant ?? DEFAULT_CLOCK_ISO)));
    db.exec('DELETE FROM event; DELETE FROM bookings; DELETE FROM policies; DELETE FROM providers; DELETE FROM requests; DELETE FROM outcomes; DELETE FROM events;');
    q.insEventRow.run(nextEpoch, JSON.stringify(s.event));
    s.bookings.forEach((b, i) => q.insBooking.run(nextEpoch, b.bookingId, JSON.stringify(b), i));
    s.policies.forEach((p, i) => q.insPolicy.run(nextEpoch, p.policyId, JSON.stringify(p), i));
    for (const [pid, p] of Object.entries(s.providers)) q.insProvider.run(nextEpoch, pid, JSON.stringify(p));
    addEvent({
      kind: 'reset',
      detail: 'Sandbox reset to the labeled demo fixtures. Bookings, policies and provider outcomes are all samples.',
    });
  }

  if (!q.epochRow.get()) {
    db.exec('BEGIN IMMEDIATE');
    try {
      seedAll(seed);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }

  let depth = 0;
  const store = {
    transact(fn) {
      if (depth > 0) return fn();
      depth += 1;
      db.exec('BEGIN IMMEDIATE');
      try {
        const out = fn();
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      } finally {
        depth -= 1;
      }
    },
    epoch,
    getClockMs,
    setClockMs(ms) {
      q.metaSet.run('clock_ms', String(ms));
    },
    getEvent() {
      return JSON.parse(q.event.get().json);
    },
    setEvent(ev) {
      q.insEventRow.run(epoch(), JSON.stringify(ev));
    },
    listBookings() {
      return q.bookings.all(epoch()).map((r) => JSON.parse(r.json));
    },
    getBooking(bookingId) {
      const r = q.booking.get(epoch(), bookingId);
      return r ? JSON.parse(r.json) : undefined;
    },
    updateBooking(bookingId, patch) {
      const r = q.booking.get(epoch(), bookingId);
      if (r) q.insBooking.run(epoch(), bookingId, JSON.stringify({ ...JSON.parse(r.json), ...patch }), r.ord);
    },
    getPolicy(policyId) {
      const r = q.policy.get(epoch(), policyId);
      return r ? JSON.parse(r.json) : undefined;
    },
    listPolicies() {
      return q.policies.all(epoch()).map((r) => JSON.parse(r.json));
    },
    getProviders() {
      const out = {};
      for (const r of q.providers.all(epoch())) out[r.provider_id] = JSON.parse(r.json);
      return out;
    },
    getRequest(requestId) {
      const r = q.request.get(epoch(), requestId);
      return r ? JSON.parse(r.json) : undefined;
    },
    getRequestByBooking(bookingId) {
      const r = q.requestByBooking.get(epoch(), bookingId);
      return r ? JSON.parse(r.json) : undefined;
    },
    listRequests() {
      return q.requests.all(epoch()).map((r) => JSON.parse(r.json));
    },
    insertRequest(row) {
      q.insRequest.run(epoch(), row.requestId, row.bookingId, JSON.stringify(row));
    },
    updateRequest(requestId, patch) {
      const r = store.getRequest(requestId);
      if (r) q.insRequest.run(epoch(), requestId, r.bookingId, JSON.stringify({ ...r, ...patch }));
    },
    insertOutcome(row) {
      q.insOutcome.run(epoch(), row.requestId, row.bookingId, JSON.stringify(row));
    },
    listOutcomes() {
      return q.outcomes.all(epoch()).map((r) => JSON.parse(r.json));
    },
    listOutcomesForRequest(requestId) {
      return q.outcomesFor.all(epoch(), requestId).map((r) => JSON.parse(r.json));
    },
    addEvent,
    listEvents() {
      return q.events.all(epoch()).map((r) => ({ seq: r.seq, ts: r.ts, kind: r.kind, bookingId: r.booking_id, detail: r.detail }));
    },
    resetAll(newSeed = DEFAULT_SEED) {
      store.transact(() => seedAll(newSeed));
    },
    close() {
      db.close();
    },
  };
  return store;
}
