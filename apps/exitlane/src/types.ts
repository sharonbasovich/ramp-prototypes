export type RequestStatus =
  | 'prepared'
  | 'approved'
  | 'stale'
  | 'executed'
  | 'failed'
  | 'excluded';

export interface PolicyTier {
  tierId: string;
  boundary: 'before' | 'at_or_after' | 'always';
  cutoffInstant?: string | null;
  label?: string;
  fee: { kind: 'fixed'; amountMinor: number } | { kind: 'percent'; percent: number };
}

export interface PolicyInfo {
  policyId: string;
  version: string;
  supported: boolean;
  summary: string;
  sourceRef: string;
  checkInInstant: string | null;
  tiers: PolicyTier[];
}

export interface Assessment {
  status: 'assessed' | 'manual_review' | 'invalid';
  reason: string | null;
  detail: string;
  tierId?: string;
  tierLabel?: string;
  boundary?: string;
  cutoffInstant?: string | null;
  feeMinor?: number;
  refundMinor?: number;
  extraPaymentMinor?: number;
  futureChargesAvoidedMinor?: number;
  netBenefitMinor?: number;
  policyId?: string;
  policyVersion?: string;
  policySummary?: string;
  sourceRef?: string;
  fingerprint?: string;
}

export interface CancellationRequest {
  requestId: string;
  bookingId: string;
  status: RequestStatus;
  reason: string | null;
  fingerprint: string;
  assessedInstant: string;
  approvedFingerprint: string | null;
  approvedInstant: string | null;
  approvedRefundMinor: number | null;
  approvedExtraMinor: number | null;
  approvedAvoidedMinor: number | null;
  approvedNetMinor: number | null;
  staleReason: string | null;
  idempotencyKey: string;
  refundReceivedMinor: number | null;
}

export interface ProviderOutcome {
  requestId: string;
  bookingId: string;
  providerId: string;
  attempt: number;
  outcome: 'confirmed' | 'failed';
  code: string;
  ref: string | null;
  detail: string;
  simulated: boolean;
  idempotencyKey: string;
  recordedInstant: string;
}

export interface BookingRow {
  bookingId: string;
  service: string;
  provider: string;
  providerId: string;
  serviceLabel: string;
  serviceInstant: string;
  committedMinor: number;
  paidMinor: number;
  unpaidMinor: number;
  currency: string;
  confirmationRef: string;
  version: number;
  status: 'active' | 'canceled' | 'cancel_confirmed';
  canceledInstant?: string | null;
  policyId: string;
  policy: PolicyInfo | null;
  assessment: Assessment;
  request: CancellationRequest | null;
  outcomes: ProviderOutcome[];
  approvalStale: boolean;
}

export interface EventInfo {
  eventId: string;
  name: string;
  startInstant: string;
  bookedInstant: string;
  displayTz: string;
  status: 'active' | 'canceled';
  canceledInstant: string | null;
}

export interface TimelineNode {
  key: string;
  instant: string;
  label: string;
  sub?: string;
  state: 'done' | 'now' | 'future';
}

export interface Totals {
  /** Remaining potential — only still-active assessed bookings. */
  estimatedRefundableMinor: number;
  estimatedFutureChargesAvoidedMinor: number;
  estimatedExtraChargesMinor: number;
  netEstimatedBenefitMinor: number;
  /** Executed requests: the approved refund now due (simulated). */
  confirmedRefundsDueMinor: number;
  receivedRefundsMinor: number;
  /** Sum of approvedRefundMinor over approved/executed/failed requests. */
  packetRefundableMinor: number;
  confirmedCancellations: number;
  failedCancellations: number;
  queuedCancellations: number;
  outcomeCount: number;
  note: string;
}

export interface EventRow {
  seq: number;
  ts: number;
  kind: string;
  bookingId: string | null;
  detail: string | null;
}

export interface Snapshot {
  epoch: number;
  clock: { instant: string; tz: string };
  event: EventInfo;
  bookings: BookingRow[];
  requests: CancellationRequest[];
  outcomes: ProviderOutcome[];
  totals: Totals;
  timeline: TimelineNode[];
  events: EventRow[];
}

export type OpResponse<T = unknown> =
  | { ok: true; result: T }
  | { ok: false; error: { code: string; detail: string } };

export interface BackendApi {
  mode: 'sqlite' | 'browser';
  state(): Promise<Snapshot>;
  reset(config?: unknown): Promise<Snapshot>;
  setClock(instant: string): Promise<OpResponse<{ clockInstant: string; staleBookings: string[] }>>;
  cancelEvent(): Promise<OpResponse>;
  preparePacket(): Promise<OpResponse>;
  approvePacket(): Promise<OpResponse>;
  executePacket(): Promise<OpResponse>;
  executeRequest(requestId: string): Promise<OpResponse>;
  markRefundReceived(requestId: string): Promise<OpResponse>;
  editBookingAmounts(
    bookingId: string,
    patch: { committedMinor?: number; paidMinor?: number; unpaidMinor?: number },
  ): Promise<OpResponse>;
  exportPacket(): Promise<unknown>;
}
