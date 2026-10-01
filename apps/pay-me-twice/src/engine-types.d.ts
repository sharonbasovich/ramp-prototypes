declare module '*engine/engine.mjs' {
  import type {
    InvoiceFacts, Verdict, PayResult, LineItem, FactsSource,
  } from '../src/types';

  export const CURRENCIES: string[];
  export const DEFAULT_CURRENCY: string;
  export const FIXTURE_BASE_MS: number;
  export const MONTH_NAMES: string[];

  export function normalizeSupplier(v: unknown): string;
  export function normalizeInvoiceNumber(v: unknown): string;
  export function normalizeCurrency(v: unknown): string;
  export function factsSourceAfterEdit(source: FactsSource | string): FactsSource;
  export function normalizeFacts(f: Partial<InvoiceFacts>): InvoiceFacts;
  export function validateFacts(f: InvoiceFacts): string[];
  export function itemsSignature(items: LineItem[]): string;
  export function sha256Hex(data: string | Uint8Array): Promise<string>;
  export function displayPeriod(period: string): string;
  export function monthToPeriod(label: string): string;
  export function formatCents(cents: number, currency?: string): string;
  export function fixtureTimestamp(attemptSeq: number): string;
  export function outcomeLabel(outcome: string): string;
  export function evaluateInvoice(facts: Partial<InvoiceFacts>, store: unknown): Promise<Verdict>;
  export function payInvoice(
    store: unknown,
    args: { requestId: string; actor: string; facts: Partial<InvoiceFacts> }
  ): Promise<PayResult>;
}

declare module '*engine/documents.mjs' {
  import type { InvoiceFacts } from '../src/types';

  export const BASE_INVOICE: InvoiceFacts & {
    issueDate: string;
    dueDate: string;
    supplierAddress: string;
    billTo: string;
  };
  export const SCENARIOS: Array<{ id: string; label: string; hint: string }>;
  export function periodLabel(period: string): string;
  export function renderCanonicalDoc(f: Partial<InvoiceFacts>): string;
  export function renderAltLayoutDoc(f: Partial<InvoiceFacts>): string;
  export function renderChangedRefDoc(f: Partial<InvoiceFacts>): string;
  export function unreadableBytes(): Uint8Array;
  export function buildScenarioDocument(
    scenarioId: string,
    currentFacts: Partial<InvoiceFacts>
  ): { filename: string; bytes: Uint8Array; facts: InvoiceFacts; note: string };
  export function extractFields(text: string): {
    fields: Partial<InvoiceFacts>;
    found: string[];
  };
  export function pdfText(
    bytes: Uint8Array,
    inflate?: (b: Uint8Array) => Promise<Uint8Array>
  ): Promise<string>;
  export function extractDocument(
    bytes: Uint8Array | ArrayBuffer,
    filename: string,
    inflate?: (b: Uint8Array) => Promise<Uint8Array>
  ): Promise<{
    supported: boolean;
    text: string;
    fields: Partial<InvoiceFacts>;
    found: string[];
    filename: string;
  }>;
}

declare module '*engine/seed.mjs' {
  export function buildSeed(): Promise<{
    payment: Record<string, unknown>;
    attempts: Array<Record<string, unknown>>;
    requests: Array<Record<string, unknown>>;
    clockSeq: number;
    paymentSeq: number;
  }>;
}
