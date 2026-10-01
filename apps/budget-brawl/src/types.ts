export type RequestStatus =
  | 'reserved'
  | 'awaiting_approval'
  | 'awaiting_funds'
  | 'committed'
  | 'cancelled'
  | 'denied'
  | 'expired';

export interface CatalogItem {
  itemId: string;
  name: string;
  priceMinor: number;
  category: string;
}

export interface AgentInfo {
  agentId: string;
  name: string;
  lane: string;
  permissions: string[];
}

export interface RequestRow {
  requestId: string;
  agentId: string;
  itemId: string;
  itemName: string;
  qty: number;
  amountMinor: number;
  status: RequestStatus;
  reason: string | null;
  fundsHeld: boolean;
  purchaseId: string | null;
  detail: string;
  quoteExpiresAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface PurchaseRow {
  purchaseId: string;
  requestId: string;
  agentId: string;
  itemId: string;
  qty: number;
  amountMinor: number;
  createdAt: number;
}

export interface EventRow {
  seq: number;
  ts: number;
  kind: string;
  requestId: string | null;
  agentId: string | null;
  itemId: string | null;
  amountMinor: number | null;
  status: string | null;
  detail: string | null;
}

export interface Totals {
  budgetMinor: number;
  spentMinor: number;
  reservedMinor: number;
  availableMinor: number;
}

export interface Snapshot {
  epoch: number;
  wallet: {
    budgetMinor: number;
    approvalThresholdMinor: number;
    quoteTtlMs: number;
  };
  totals: Totals;
  invariant: { rule: string; holds: boolean };
  catalog: CatalogItem[];
  agents: AgentInfo[];
  requests: RequestRow[];
  purchases: PurchaseRow[];
  events: EventRow[];
  impact: { preventedCount: number; preventedAmountMinor: number; note: string };
}

export interface RequestResult {
  requestId: string;
  agentId: string;
  itemId: string;
  itemName: string;
  qty: number;
  amountMinor: number;
  claimedPriceMinor: number | null;
  priceOverridden: boolean;
  approvalRequired: boolean;
  status: RequestStatus;
  reason: string | null;
  fundsHeld: boolean;
  purchaseId: string | null;
  detail: string;
  replayed: boolean;
  totals: Totals;
}

export interface SeedAgent {
  agentId: string;
  name: string;
  lane: string;
  items: string[];
}

export interface SeedConfig {
  wallet?: { budgetMinor?: number; approvalThresholdMinor?: number; quoteTtlMs?: number };
  catalog?: { itemId: string; name: string; priceMinor: number; category?: string }[];
  agents?: SeedAgent[];
}

export type OpResponse<T = unknown> =
  | { ok: true; result: T }
  | { ok: false; error: { code: string; detail: string } };

export interface BackendApi {
  mode: 'sqlite' | 'browser';
  state(): Promise<Snapshot>;
  reset(config?: SeedConfig): Promise<Snapshot>;
  configure(cfg: {
    budgetMinor?: number;
    approvalThresholdMinor?: number;
    quoteTtlMs?: number;
  }): Promise<OpResponse>;
  setCatalogPrice(itemId: string, priceMinor: number): Promise<OpResponse>;
  placeRequest(req: {
    requestId: string;
    agentId: string;
    itemId: string;
    qty: number;
    claimedPriceMinor?: number;
  }): Promise<OpResponse<RequestResult>>;
  act(
    requestId: string,
    action: 'approve' | 'reject' | 'commit' | 'cancel',
  ): Promise<OpResponse<RequestResult>>;
}
