// server/sqlstore.mjs — node:sqlite store implementing the engine's store
// contract. Mutations run inside BEGIN IMMEDIATE transactions so concurrent
// HTTP requests can never observe or write a state that violates
// spent + held <= budget.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DEFAULT_SEED } from '../shared/seed.mjs';

const HOLD_STATUSES = "('reserved','awaiting_approval')";

export function createSqlStore(dbPath, seed = DEFAULT_SEED) {
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS wallet (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      epoch INTEGER NOT NULL DEFAULT 1,
      budget_minor INTEGER NOT NULL,
      approval_threshold_minor INTEGER NOT NULL,
      quote_ttl_ms INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS catalog (
      item_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      price_minor INTEGER NOT NULL,
      category TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agents (
      agent_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      lane TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agent_permissions (
      agent_id TEXT NOT NULL REFERENCES agents(agent_id),
      item_id TEXT NOT NULL,
      PRIMARY KEY (agent_id, item_id)
    );
    CREATE TABLE IF NOT EXISTS requests (
      request_id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      qty INTEGER NOT NULL,
      amount_minor INTEGER NOT NULL,
      quoted_price_minor INTEGER NOT NULL,
      quote_expires_at INTEGER,
      claimed_price_minor INTEGER,
      price_overridden INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      reason TEXT,
      funds_held INTEGER NOT NULL DEFAULT 0,
      purchase_id TEXT,
      detail TEXT,
      epoch INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS purchases (
      purchase_id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL UNIQUE,
      agent_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      qty INTEGER NOT NULL,
      amount_minor INTEGER NOT NULL,
      epoch INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      kind TEXT NOT NULL,
      request_id TEXT,
      agent_id TEXT,
      item_id TEXT,
      amount_minor INTEGER,
      status TEXT,
      detail TEXT,
      epoch INTEGER NOT NULL
    );
  `);

  const q = {
    wallet: db.prepare('SELECT epoch, budget_minor, approval_threshold_minor, quote_ttl_ms FROM wallet WHERE id = 1'),
    item: db.prepare('SELECT item_id, name, price_minor, category FROM catalog WHERE item_id = ?'),
    catalog: db.prepare('SELECT item_id, name, price_minor, category FROM catalog ORDER BY item_id'),
    agents: db.prepare('SELECT agent_id, name, lane FROM agents ORDER BY rowid'),
    perms: db.prepare('SELECT item_id FROM agent_permissions WHERE agent_id = ?'),
    request: db.prepare('SELECT * FROM requests WHERE request_id = ? AND epoch = ?'),
    requests: db.prepare('SELECT * FROM requests WHERE epoch = ? ORDER BY created_at DESC, request_id DESC'),
    purchases: db.prepare('SELECT * FROM purchases WHERE epoch = ? ORDER BY created_at DESC'),
    events: db.prepare('SELECT * FROM events WHERE epoch = ? ORDER BY seq DESC LIMIT 200'),
    spent: db.prepare('SELECT COALESCE(SUM(amount_minor),0) AS s FROM purchases WHERE epoch = ?'),
    held: db.prepare(`SELECT COALESCE(SUM(amount_minor),0) AS s FROM requests WHERE epoch = ? AND funds_held = 1 AND status IN ${HOLD_STATUSES}`),
    insRequest: db.prepare(`INSERT INTO requests
      (request_id, agent_id, item_id, qty, amount_minor, quoted_price_minor, quote_expires_at,
       claimed_price_minor, price_overridden, status, reason, funds_held, purchase_id, detail,
       epoch, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`),
    updRequest: db.prepare('UPDATE requests SET status = ?, reason = ?, funds_held = ?, purchase_id = ?, detail = ?, updated_at = ? WHERE request_id = ? AND epoch = ?'),
    insPurchase: db.prepare(`INSERT INTO purchases
      (purchase_id, request_id, agent_id, item_id, qty, amount_minor, epoch, created_at)
      VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT (request_id) DO NOTHING`),
    insEvent: db.prepare(`INSERT INTO events
      (ts, kind, request_id, agent_id, item_id, amount_minor, status, detail, epoch)
      VALUES (?,?,?,?,?,?,?,?,?)`),
    setWallet: db.prepare('UPDATE wallet SET budget_minor = ?, approval_threshold_minor = ?, quote_ttl_ms = ? WHERE id = 1'),
    setPrice: db.prepare('UPDATE catalog SET price_minor = ? WHERE item_id = ?'),
    insAgent: db.prepare('INSERT INTO agents (agent_id, name, lane) VALUES (?,?,?)'),
    insPerm: db.prepare('INSERT INTO agent_permissions (agent_id, item_id) VALUES (?,?)'),
    insItem: db.prepare('INSERT INTO catalog (item_id, name, price_minor, category) VALUES (?,?,?,?)'),
    insWallet: db.prepare('INSERT INTO wallet (id, epoch, budget_minor, approval_threshold_minor, quote_ttl_ms) VALUES (1,?,?,?,?)'),
    epochRow: db.prepare('SELECT epoch FROM wallet WHERE id = 1'),
  };

  function seedAll(s) {
    const epoch = (q.epochRow.get()?.epoch ?? 0) + 1;
    db.exec('DELETE FROM events; DELETE FROM purchases; DELETE FROM requests; DELETE FROM agent_permissions; DELETE FROM agents; DELETE FROM catalog; DELETE FROM wallet;');
    q.insWallet.run(epoch, s.wallet.budgetMinor, s.wallet.approvalThresholdMinor, s.wallet.quoteTtlMs);
    for (const c of s.catalog) q.insItem.run(c.itemId, c.name, c.priceMinor, c.category);
    for (const a of s.agents) {
      q.insAgent.run(a.agentId, a.name, a.lane);
      for (const it of a.items) q.insPerm.run(a.agentId, it);
    }
    q.insEvent.run(Date.now(), 'reset', null, null, null, null, null,
      `Sandbox reset to $${(s.wallet.budgetMinor / 100).toFixed(2)} sample budget.`, epoch);
    return epoch;
  }

  // Initialize wallet if empty.
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

  function rowToRequest(r) {
    if (!r) return undefined;
    return {
      requestId: r.request_id,
      agentId: r.agent_id,
      itemId: r.item_id,
      qty: r.qty,
      amountMinor: r.amount_minor,
      quotedPriceMinor: r.quoted_price_minor,
      quoteExpiresAt: r.quote_expires_at,
      claimedPriceMinor: r.claimed_price_minor,
      priceOverridden: r.price_overridden,
      status: r.status,
      reason: r.reason,
      fundsHeld: r.funds_held,
      purchaseId: r.purchase_id,
      detail: r.detail,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  let depth = 0;
  const store = {
    transact(fn) {
      // Nested calls reuse the outer transaction.
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
    epoch() {
      return q.epochRow.get()?.epoch ?? 1;
    },
    getWallet() {
      const w = q.wallet.get();
      return {
        epoch: w.epoch,
        budgetMinor: w.budget_minor,
        approvalThresholdMinor: w.approval_threshold_minor,
        quoteTtlMs: w.quote_ttl_ms,
      };
    },
    setWallet(patch) {
      const w = store.getWallet();
      q.setWallet.run(
        patch.budgetMinor ?? w.budgetMinor,
        patch.approvalThresholdMinor ?? w.approvalThresholdMinor,
        patch.quoteTtlMs ?? w.quoteTtlMs
      );
    },
    getItem(itemId) {
      const r = q.item.get(itemId);
      return r ? { itemId: r.item_id, name: r.name, priceMinor: r.price_minor, category: r.category } : undefined;
    },
    listCatalog() {
      return q.catalog.all().map((r) => ({ itemId: r.item_id, name: r.name, priceMinor: r.price_minor, category: r.category }));
    },
    setItemPrice(itemId, priceMinor) {
      q.setPrice.run(priceMinor, itemId);
    },
    getAgent(agentId) {
      const r = db.prepare('SELECT agent_id, name, lane FROM agents WHERE agent_id = ?').get(agentId);
      return r ? { agentId: r.agent_id, name: r.name, lane: r.lane } : undefined;
    },
    listAgents() {
      return q.agents.all().map((r) => ({ agentId: r.agent_id, name: r.name, lane: r.lane }));
    },
    listPermissions(agentId) {
      return q.perms.all(agentId).map((r) => r.item_id);
    },
    getRequest(requestId) {
      return rowToRequest(q.request.get(requestId, store.epoch()));
    },
    insertRequest(row) {
      q.insRequest.run(
        row.requestId, row.agentId, row.itemId, row.qty, row.amountMinor,
        row.quotedPriceMinor, row.quoteExpiresAt ?? null, row.claimedPriceMinor ?? null,
        row.priceOverridden ?? 0, row.status, row.reason ?? null, row.fundsHeld ?? 0,
        row.purchaseId ?? null, row.detail ?? null, store.epoch(), row.createdAt, row.updatedAt
      );
    },
    updateRequest(requestId, patch) {
      const cur = q.request.get(requestId, store.epoch());
      if (!cur) return;
      q.updRequest.run(
        patch.status ?? cur.status,
        patch.reason === undefined ? cur.reason : patch.reason,
        patch.fundsHeld ?? cur.funds_held,
        patch.purchaseId === undefined ? cur.purchase_id : patch.purchaseId,
        patch.detail ?? cur.detail,
        patch.updatedAt ?? Date.now(),
        requestId,
        store.epoch()
      );
    },
    insertPurchase(row) {
      q.insPurchase.run(row.purchaseId, row.requestId, row.agentId, row.itemId, row.qty, row.amountMinor, store.epoch(), row.createdAt);
    },
    sumSpent() {
      return q.spent.get(store.epoch()).s;
    },
    sumHeld() {
      return q.held.get(store.epoch()).s;
    },
    addEvent(ev) {
      q.insEvent.run(Date.now(), ev.kind ?? 'event', ev.requestId ?? null, ev.agentId ?? null,
        ev.itemId ?? null, ev.amountMinor ?? null, ev.status ?? null, ev.detail ?? null, store.epoch());
    },
    listEvents() {
      return q.events.all(store.epoch()).map((r) => ({
        seq: r.seq, ts: r.ts, kind: r.kind, requestId: r.request_id, agentId: r.agent_id,
        itemId: r.item_id, amountMinor: r.amount_minor, status: r.status, detail: r.detail,
      }));
    },
    listRequests() {
      return q.requests.all(store.epoch()).map(rowToRequest);
    },
    listPurchases() {
      return q.purchases.all(store.epoch()).map((r) => ({
        purchaseId: r.purchase_id, requestId: r.request_id, agentId: r.agent_id,
        itemId: r.item_id, qty: r.qty, amountMinor: r.amount_minor, createdAt: r.created_at,
      }));
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
