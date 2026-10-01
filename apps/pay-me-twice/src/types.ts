export interface LineItem {
  description: string;
  qty: number;
  rateCents: number;
  amountCents: number;
}

export type FactsSource = 'seed' | 'extracted' | 'manual' | 'generated';

export interface InvoiceFacts {
  supplier: string;
  invoiceNumber: string;
  currency: string;
  amountCents: number | null;
  period: string; // 'YYYY-MM' or ''
  items: LineItem[];
  factsSource: FactsSource;
  docSupported: boolean;
  docHash: string;
  filename: string;
}

export interface EvidenceRow {
  label: string;
  value: string;
}

export type VerdictStatus = 'clear' | 'duplicate' | 'review' | 'unsupported' | 'invalid';

export interface Verdict {
  status: VerdictStatus;
  title: string;
  detail: string;
  evidence: EvidenceRow[];
  payable: boolean;
  matchedPaymentUid?: string;
}

export type PayOutcome = 'recorded' | 'duplicate' | 'review' | 'unsupported' | 'invalid' | 'replayed';

export interface PayResult {
  outcome: PayOutcome;
  verdict: Verdict;
  paymentUid: string | null;
  at?: string;
  detail?: string;
}

export interface PaymentRow {
  paymentUid: string;
  requestId: string;
  supplier: string;
  supplierNorm: string;
  invoiceNumber: string;
  invoiceNorm: string;
  currency: string;
  amountCents: number;
  period: string;
  actor: string;
  paidAt: string;
  filename: string;
  docHash: string;
}

export interface AttemptRow {
  id: number;
  kind: string;
  requestId: string;
  actor: string;
  supplier: string;
  invoiceNumber: string;
  currency: string;
  amountCents: number | null;
  period: string;
  result: string;
  note: string;
  at: string;
}

export interface AppState {
  mode: string;
  payments: PaymentRow[];
  attempts: AttemptRow[];
  stats: {
    paymentsRecorded: number;
    duplicatesBlocked: number;
    reviewHolds: number;
    paidByCurrency: Record<string, number>;
  };
}

export interface IngestResult {
  filename: string;
  docHash: string;
  supported: boolean;
  found: string[];
  fields: Partial<InvoiceFacts> | null;
  textPreview: string;
}

export interface Adapter {
  readonly kind: 'server' | 'browser';
  readonly modeLabel: string;
  readonly limitation: string;
  getState(): Promise<AppState>;
  reset(): Promise<AppState>;
  ingestDocument(filename: string, bytes: Uint8Array): Promise<IngestResult>;
  validate(facts: InvoiceFacts, actor: string): Promise<{ verdict: Verdict; at: string }>;
  pay(requestId: string, actor: string, facts: InvoiceFacts): Promise<PayResult>;
}
