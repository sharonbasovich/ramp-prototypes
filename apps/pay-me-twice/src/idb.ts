/**
 * IndexedDB store implementing the same async store contract as server/db.mjs.
 * Atomicity in the browser sandbox comes from a Web Lock plus a single
 * readwrite IDB transaction per pay() call. Honest limit: this is one origin's
 * storage — it demonstrates the state machine, not cross-device enforcement.
 */
import { buildSeed } from '../engine/seed.mjs';
import { fixtureTimestamp } from '../engine/engine.mjs';

const DB_NAME = 'pay-me-twice-sandbox';
const STORES = ['payments', 'requests', 'attempts', 'meta'] as const;

interface Seed {
  payment: Record<string, unknown> & { paymentUid: string };
  attempts: Array<Record<string, unknown>>;
  requests: Array<Record<string, unknown>>;
  clockSeq: number;
  paymentSeq: number;
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export class IdbStore {
  private db: IDBDatabase;
  private tx: IDBTransaction | null = null;
  private seed: Seed;

  private constructor(db: IDBDatabase, seed: Seed) {
    this.db = db;
    this.seed = seed;
  }

  static async open(): Promise<IdbStore> {
    const seed = (await buildSeed()) as Seed;
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open(DB_NAME, 1);
      open.onupgradeneeded = () => {
        const d = open.result;
        const payments = d.createObjectStore('payments', { keyPath: 'paymentUid' });
        payments.createIndex('identity', ['supplierNorm', 'invoiceNorm', 'currency'], { unique: true });
        payments.createIndex('docHash', 'docHash', { unique: false });
        d.createObjectStore('requests', { keyPath: 'requestId' });
        d.createObjectStore('attempts', { keyPath: 'id', autoIncrement: true });
        d.createObjectStore('meta', { keyPath: 'k' });
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const store = new IdbStore(db, seed);
    const seeded = await store.getMeta('seeded');
    if (!seeded) await store.reset();
    return store;
  }

  private os(name: string): IDBObjectStore {
    if (this.tx) return this.tx.objectStore(name);
    throw new Error('outside transaction');
  }

  private async nonTx<T>(name: string, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const tx = this.db.transaction(name, 'readonly');
    return req(fn(tx.objectStore(name)));
  }

  private async getMeta(k: string): Promise<string | null> {
    const store = this.tx ? this.os('meta') : this.db.transaction('meta', 'readonly').objectStore('meta');
    const r = (await req(store.get(k))) as { v: string } | undefined;
    return r ? r.v : null;
  }

  private async setMeta(k: string, v: string): Promise<void> {
    await req(this.os('meta').put({ k, v }));
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      const tx = this.db.transaction([...STORES], 'readwrite');
      this.tx = tx;
      try {
        const out = await fn();
        await new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
        });
        return out;
      } finally {
        this.tx = null;
      }
    };
    if (typeof navigator !== 'undefined' && navigator.locks) {
      return navigator.locks.request('pay-me-twice-ledger', run) as Promise<T>;
    }
    return run();
  }

  async getRequest(requestId: string) {
    const r = await req(this.os('requests').get(requestId));
    return (r as Record<string, unknown> | undefined) ?? null;
  }

  async saveRequest(rec: Record<string, unknown>) {
    await req(this.os('requests').put(rec));
  }

  async paymentWithDocHash(hash: string) {
    if (!hash) return null;
    const rows = (await req(this.os('payments').index('docHash').getAll(hash))) as Array<Record<string, unknown>>;
    return rows[0] ?? null;
  }

  async paymentWithIdentity(supplierNorm: string, invoiceNorm: string, currency: string) {
    const r = await req(this.os('payments').index('identity').get([supplierNorm, invoiceNorm, currency]));
    return (r as Record<string, unknown> | undefined) ?? null;
  }

  async paymentsForSupplier(supplierNorm: string, currency: string) {
    const all = (await req(this.os('payments').getAll())) as Array<Record<string, unknown>>;
    return all.filter((p) => p.supplierNorm === supplierNorm && p.currency === currency);
  }

  async nextPaymentUid() {
    const n = Number((await this.getMeta('payment_seq')) || '0') + 1;
    await this.setMeta('payment_seq', String(n));
    return `PAY-${String(n).padStart(4, '0')}`;
  }

  async nextTimestamp() {
    const seq = Number((await this.getMeta('clock_seq')) || '0');
    await this.setMeta('clock_seq', String(seq + 1));
    return fixtureTimestamp(seq);
  }

  async insertPayment(rec: Record<string, unknown>): Promise<boolean> {
    const paidAt = fixtureTimestamp(Number((await this.getMeta('clock_seq')) || '0'));
    try {
      await req(this.os('payments').add({ ...rec, paidAt }));
      return true;
    } catch (e) {
      if (e instanceof DOMException && e.name === 'ConstraintError') return false;
      throw e;
    }
  }

  async addAttempt(a: Record<string, unknown>) {
    await req(this.os('attempts').add(a));
  }

  async listAttempts() {
    return this.nonTx('attempts', (s) => s.getAll()) as Promise<unknown[]>;
  }

  async listPayments() {
    return this.nonTx('payments', (s) => s.getAll()) as Promise<unknown[]>;
  }

  async reset() {
    await this.transaction(async () => {
      for (const name of STORES) await req(this.os(name).clear());
      const s = this.seed;
      await req(this.os('payments').add(s.payment));
      for (const a of s.attempts) await req(this.os('attempts').add(a));
      for (const r of s.requests) await req(this.os('requests').add(r));
      await this.setMeta('clock_seq', String(s.clockSeq));
      await this.setMeta('payment_seq', String(s.paymentSeq));
      await this.setMeta('seeded', '1');
    });
  }
}
