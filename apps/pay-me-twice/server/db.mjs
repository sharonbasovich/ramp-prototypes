/**
 * node:sqlite-backed store for Pay Me Twice.
 * Implements the async store contract used by engine/engine.mjs:
 * transaction(fn) + the read/write helpers, all serialized by SQLite.
 * Uniqueness on payments(supplier_norm, invoice_norm, currency) and on
 * requests(request_id) is the final defense against races and retries.
 */
import { createRequire } from 'node:module';
import { buildSeed } from '../engine/seed.mjs';
import { fixtureTimestamp } from '../engine/engine.mjs';

// node:sqlite via createRequire: Vite's import analysis (vitest) doesn't know
// this builtin, but the runtime does. Loaded once per process.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_uid TEXT NOT NULL UNIQUE,
  request_id TEXT NOT NULL UNIQUE,
  supplier TEXT NOT NULL,
  supplier_norm TEXT NOT NULL,
  invoice_number TEXT NOT NULL,
  invoice_norm TEXT NOT NULL,
  currency TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  period TEXT NOT NULL DEFAULT '',
  items_signature TEXT NOT NULL DEFAULT '',
  doc_hash TEXT NOT NULL DEFAULT '',
  filename TEXT NOT NULL DEFAULT '',
  actor TEXT NOT NULL DEFAULT '',
  paid_at TEXT NOT NULL,
  UNIQUE (supplier_norm, invoice_norm, currency)
);
CREATE TABLE IF NOT EXISTS requests (
  request_id TEXT PRIMARY KEY,
  outcome TEXT NOT NULL,
  verdict_json TEXT NOT NULL,
  payment_uid TEXT,
  actor TEXT NOT NULL DEFAULT '',
  at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  request_id TEXT NOT NULL DEFAULT '',
  actor TEXT NOT NULL DEFAULT '',
  supplier TEXT NOT NULL DEFAULT '',
  invoice_number TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT '',
  amount_cents INTEGER,
  period TEXT NOT NULL DEFAULT '',
  result TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
`;

function rowToPayment(r) {
  return {
    paymentUid: r.payment_uid,
    requestId: r.request_id,
    supplier: r.supplier,
    supplierNorm: r.supplier_norm,
    invoiceNumber: r.invoice_number,
    invoiceNorm: r.invoice_norm,
    currency: r.currency,
    amountCents: r.amount_cents,
    period: r.period,
    itemsSignature: r.items_signature,
    docHash: r.doc_hash,
    filename: r.filename,
    actor: r.actor,
    paidAt: r.paid_at,
  };
}

export class SqliteStore {
  constructor(dbPath, seed) {
    this.seed = seed;
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec(SCHEMA);
    if (!this.getMeta('seeded')) this.#applySeed();
  }

  #applySeed() {
    const s = this.seed;
    const insP = this.db.prepare(`INSERT INTO payments
      (payment_uid, request_id, supplier, supplier_norm, invoice_number, invoice_norm,
       currency, amount_cents, period, items_signature, doc_hash, filename, actor, paid_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const insA = this.db.prepare(`INSERT INTO attempts
      (kind, request_id, actor, supplier, invoice_number, currency, amount_cents, period, result, note, at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    const insR = this.db.prepare(`INSERT INTO requests
      (request_id, outcome, verdict_json, payment_uid, actor, at) VALUES (?,?,?,?,?,?)`);
    this.db.exec('BEGIN');
    try {
      insP.run(s.payment.paymentUid, s.payment.requestId, s.payment.supplier, s.payment.supplierNorm,
        s.payment.invoiceNumber, s.payment.invoiceNorm, s.payment.currency, s.payment.amountCents,
        s.payment.period, s.payment.itemsSignature, s.payment.docHash, s.payment.filename,
        s.payment.actor, s.payment.paidAt);
      for (const a of s.attempts) {
        insA.run(a.kind, a.requestId, a.actor, a.supplier, a.invoiceNumber, a.currency,
          a.amountCents, a.period, a.result, a.note, a.at);
      }
      for (const r of s.requests) {
        insR.run(r.requestId, r.outcome, JSON.stringify(r.verdict), r.paymentUid, r.actor, r.at);
      }
      this.setMeta('clock_seq', String(s.clockSeq));
      this.setMeta('payment_seq', String(s.paymentSeq));
      this.setMeta('seeded', '1');
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  getMeta(k) {
    const r = this.db.prepare('SELECT v FROM meta WHERE k = ?').get(k);
    return r ? r.v : null;
  }
  setMeta(k, v) {
    this.db.prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, v);
  }

  async transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const out = await fn();
      this.db.exec('COMMIT');
      return out;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  async getRequest(requestId) {
    const r = this.db.prepare('SELECT * FROM requests WHERE request_id = ?').get(requestId);
    if (!r) return null;
    return {
      requestId: r.request_id, outcome: r.outcome,
      verdict: JSON.parse(r.verdict_json), paymentUid: r.payment_uid,
      actor: r.actor, at: r.at,
    };
  }

  async saveRequest(rec) {
    this.db.prepare(`INSERT INTO requests (request_id, outcome, verdict_json, payment_uid, actor, at)
      VALUES (?,?,?,?,?,?)`).run(rec.requestId, rec.outcome, JSON.stringify(rec.verdict), rec.paymentUid, rec.actor, rec.at);
  }

  async paymentWithDocHash(hash) {
    const r = this.db.prepare("SELECT * FROM payments WHERE doc_hash = ? AND doc_hash != '' LIMIT 1").get(hash);
    return r ? rowToPayment(r) : null;
  }

  async paymentWithIdentity(supplierNorm, invoiceNorm, currency) {
    const r = this.db.prepare(
      'SELECT * FROM payments WHERE supplier_norm = ? AND invoice_norm = ? AND currency = ? LIMIT 1'
    ).get(supplierNorm, invoiceNorm, currency);
    return r ? rowToPayment(r) : null;
  }

  async paymentsForSupplier(supplierNorm, currency) {
    return this.db.prepare(
      'SELECT * FROM payments WHERE supplier_norm = ? AND currency = ? ORDER BY id'
    ).all(supplierNorm, currency).map(rowToPayment);
  }

  async nextPaymentUid() {
    const n = Number(this.getMeta('payment_seq') || '0') + 1;
    this.setMeta('payment_seq', String(n));
    return `PAY-${String(n).padStart(4, '0')}`;
  }

  async nextTimestamp() {
    const seq = Number(this.getMeta('clock_seq') || '0');
    this.setMeta('clock_seq', String(seq + 1));
    return fixtureTimestamp(seq);
  }

  async insertPayment(rec) {
    const paidAt = fixtureTimestamp(Number(this.getMeta('clock_seq') || '0'));
    try {
      this.db.prepare(`INSERT INTO payments
        (payment_uid, request_id, supplier, supplier_norm, invoice_number, invoice_norm,
         currency, amount_cents, period, items_signature, doc_hash, filename, actor, paid_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(rec.paymentUid, rec.requestId, rec.supplier, rec.supplierNorm, rec.invoiceNumber,
          rec.invoiceNorm, rec.currency, rec.amountCents, rec.period, rec.itemsSignature,
          rec.docHash, rec.filename, rec.actor, paidAt);
      return true;
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) return false;
      throw e;
    }
  }

  async addAttempt(a) {
    this.db.prepare(`INSERT INTO attempts
      (kind, request_id, actor, supplier, invoice_number, currency, amount_cents, period, result, note, at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(a.kind, a.requestId || '', a.actor || '', a.supplier || '', a.invoiceNumber || '',
        a.currency || '', a.amountCents ?? null, a.period || '', a.result, a.note || '', a.at);
  }

  async listAttempts() {
    return this.db.prepare('SELECT * FROM attempts ORDER BY id').all().map((r) => ({
      id: r.id, kind: r.kind, requestId: r.request_id, actor: r.actor,
      supplier: r.supplier, invoiceNumber: r.invoice_number, currency: r.currency,
      amountCents: r.amount_cents, period: r.period, result: r.result, note: r.note, at: r.at,
    }));
  }

  async listPayments() {
    return this.db.prepare('SELECT * FROM payments ORDER BY id').all().map(rowToPayment);
  }

  async reset() {
    this.db.exec('BEGIN');
    try {
      this.db.exec('DELETE FROM payments; DELETE FROM requests; DELETE FROM attempts; DELETE FROM meta;');
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    this.#applySeed();
  }

  close() { this.db.close(); }
}

export async function createStore(dbPath) {
  return new SqliteStore(dbPath, await buildSeed());
}
