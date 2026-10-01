/**
 * Adapter layer: ServerAdapter talks to the node:sqlite backend on the same
 * origin; BrowserAdapter runs the identical engine over IndexedDB + Web Locks
 * in this tab. The UI shows which one is active, always.
 */
import type {
  Adapter, AppState, IngestResult, InvoiceFacts, PayResult, Verdict,
} from './types';
import { IdbStore } from './idb';
import { evaluateInvoice, normalizeFacts, outcomeLabel, payInvoice, sha256Hex } from '../engine/engine.mjs';
import { extractDocument } from '../engine/documents.mjs';

async function inflateBrowser(bytes: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate');
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(ds);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

export class ServerAdapter implements Adapter {
  readonly kind = 'server' as const;
  readonly modeLabel = 'SQLite backend sandbox — transactional ledger';
  readonly limitation = 'Same-origin API on this machine. Sample data only — no real payments.';

  async getState(): Promise<AppState> {
    const res = await fetch('/api/state');
    if (!res.ok) throw new Error(`state ${res.status}`);
    return res.json();
  }
  async reset(): Promise<AppState> {
    return postJson('/api/reset', {});
  }
  async ingestDocument(filename: string, bytes: Uint8Array): Promise<IngestResult> {
    return postJson('/api/documents', { filename, contentBase64: toBase64(bytes) });
  }
  async validate(facts: InvoiceFacts, actor: string): Promise<{ verdict: Verdict; at: string }> {
    return postJson('/api/validate', { facts, actor });
  }
  async pay(requestId: string, actor: string, facts: InvoiceFacts): Promise<PayResult> {
    return postJson('/api/pay', { requestId, actor, facts });
  }
}

export class BrowserAdapter implements Adapter {
  readonly kind = 'browser' as const;
  readonly modeLabel = 'Browser sandbox — this tab only';
  readonly limitation =
    'Ledger lives in this browser (IndexedDB). Same engine, but no server enforcement — a private window or another device has its own sandbox.';
  private store: IdbStore;

  private constructor(store: IdbStore) {
    this.store = store;
  }

  static async open(): Promise<BrowserAdapter> {
    return new BrowserAdapter(await IdbStore.open());
  }

  private async statePayload(): Promise<AppState> {
    const payments = (await this.store.listPayments()) as AppState['payments'];
    const attempts = (await this.store.listAttempts()) as AppState['attempts'];
    const byCurrency: Record<string, number> = {};
    for (const p of payments) byCurrency[p.currency] = (byCurrency[p.currency] || 0) + p.amountCents;
    return {
      mode: 'browser',
      payments,
      attempts: attempts.map((a, i) => ({ ...a, id: (a as { id?: number }).id ?? i + 1 })),
      stats: {
        paymentsRecorded: payments.length,
        duplicatesBlocked: attempts.filter((a) => a.result === 'Duplicate blocked').length,
        reviewHolds: attempts.filter((a) => a.result === 'Review required').length,
        paidByCurrency: byCurrency,
      },
    };
  }

  async getState(): Promise<AppState> {
    return this.statePayload();
  }

  async reset(): Promise<AppState> {
    await this.store.reset();
    return this.statePayload();
  }

  async ingestDocument(filename: string, bytes: Uint8Array): Promise<IngestResult> {
    const extracted = await extractDocument(bytes, filename, inflateBrowser);
    const docHash = bytes.length ? await sha256Hex(bytes) : '';
    return {
      filename,
      docHash,
      supported: extracted.supported,
      found: extracted.found,
      fields: extracted.supported ? normalizeFacts({ ...extracted.fields, factsSource: 'extracted' }) : null,
      textPreview: extracted.supported ? extracted.text.slice(0, 4000) : '',
    };
  }

  async validate(facts: InvoiceFacts, actor: string): Promise<{ verdict: Verdict; at: string }> {
    return this.store.transaction(async () => {
      const f = normalizeFacts(facts);
      const verdict = await evaluateInvoice(f, this.store);
      const at = (await this.store.nextTimestamp()) as string;
      await this.store.addAttempt({
        kind: 'validation', requestId: '', actor,
        supplier: f.supplier, invoiceNumber: f.invoiceNumber, currency: f.currency,
        amountCents: f.amountCents, period: f.period,
        result: outcomeLabel(verdict.status),
        note: 'Validation only — no payment requested', at,
      });
      return { verdict, at };
    });
  }

  async pay(requestId: string, actor: string, facts: InvoiceFacts): Promise<PayResult> {
    return payInvoice(this.store, { requestId, actor, facts }) as Promise<PayResult>;
  }
}

/** Probe /api/health; fall back to the in-browser sandbox honestly. */
export async function connect(): Promise<Adapter> {
  try {
    const res = await fetch('/api/health', { signal: AbortSignal.timeout(1500) });
    if (res.ok) {
      const body = await res.json();
      if (body?.ok && body?.mode === 'sqlite') return new ServerAdapter();
    }
  } catch {
    /* backend absent → browser sandbox */
  }
  return BrowserAdapter.open();
}
