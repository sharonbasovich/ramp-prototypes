// Shared domain types for BorrowFirst. Money is integer cents with an
// explicit currency; instants are ISO strings with offsets.

export type Currency = 'CAD' | 'USD';
export type Category = 'monitor';

export interface Location {
  id: string;
  name: string;
}

export interface MonitorSpecs {
  sizeInches: number;
  ports: string[];
}

export type AssetCondition = 'functional' | 'damaged';
export type AssetAvailability = 'available' | 'in_use' | 'retired';

export interface Asset {
  id: string;
  name: string;
  category: Category;
  specs: MonitorSpecs;
  locationId: string;
  ownerName: string;
  condition: AssetCondition;
  availability: AssetAvailability;
  ownerConfirmationRequired: boolean;
  ownerConfirmedAt: string | null;
  source: 'fixture' | 'imported';
  version: number;
}

export interface TransferOption {
  assetId: string;
  costCents: number;
  currency: Currency;
  earliestArrival: string;
}

export interface PurchaseOption {
  id: string;
  label: string;
  category: Category;
  specs: MonitorSpecs;
  unitCostCents: number;
  flatShippingCents: number;
  maxQuantity: number;
  currency: Currency;
  deliveryInstant: string;
  provenance: string;
  expiresAt: string;
  version: number;
}

export interface EquipmentRequest {
  id: string;
  category: Category;
  quantity: number;
  minSizeInches: number;
  requiredPorts: string[];
  destinationLocationId: string;
  requiredBy: string;
  currency: Currency;
}

export type ReservationStatus = 'held' | 'confirmed' | 'released' | 'expired';

export interface Reservation {
  id: string;
  assetId: string;
  requestId: string;
  status: ReservationStatus;
  expiresAt: string | null;
  createdAt: string;
}

export interface World {
  locations: Location[];
  assets: Asset[];
  transferOptions: TransferOption[];
  purchaseOptions: PurchaseOption[];
  reservations: Reservation[];
  demoNow: string;
}

export type ReasonCode =
  | 'CATEGORY_MISMATCH'
  | 'DAMAGED'
  | 'UNAVAILABLE'
  | 'ALREADY_RESERVED'
  | 'MISSING_PORT'
  | 'BELOW_MIN_SIZE'
  | 'NO_TRANSFER_ROUTE'
  | 'ARRIVES_AFTER_DEADLINE'
  | 'CURRENCY_MISMATCH'
  | 'OWNER_CONFIRMATION_REQUIRED'
  | 'OK';

export interface AssetEvaluation {
  asset: Asset;
  transfer: TransferOption | null;
  eligible: boolean;
  conditional: boolean;
  reasons: { code: ReasonCode; detail: string }[];
}

export interface TransferLine {
  assetId: string;
  assetName: string;
  locationId: string;
  costCents: number;
  currency: Currency;
  earliestArrival: string;
  conditional: boolean;
}

export interface PurchaseLine {
  optionId: string;
  label: string;
  quantity: number;
  unitCostCents: number;
  shippingCents: number;
  lineCostCents: number;
  currency: Currency;
  deliveryInstant: string;
  provenance: string;
}

export type PlanStatus = 'ok' | 'conditional' | 'partial' | 'infeasible';

export interface AllocationPlan {
  request: EquipmentRequest;
  status: PlanStatus;
  currency: Currency;
  transfers: TransferLine[];
  purchases: PurchaseLine[];
  shortage: number;
  totalCostCents: number;
  baseline: { purchases: PurchaseLine[]; costCents: number } | null;
  baselineNote: string | null;
  potentialAvoidedCents: number | null;
  conditional: boolean;
  evaluations: AssetEvaluation[];
  assetVersions: Record<string, number>;
  quoteVersions: Record<string, number>;
  warnings: string[];
  errors: string[];
}

export type ReserveErrorCode =
  | 'STALE_ASSET'
  | 'ASSET_UNAVAILABLE'
  | 'ASSET_RESERVED'
  | 'ASSET_INCOMPATIBLE'
  | 'UNCONFIRMED_ASSET'
  | 'QUOTE_EXPIRED'
  | 'STALE_QUOTE'
  | 'PLAN_MISMATCH'
  | 'CURRENCY_MISMATCH';

export interface ReserveFailure {
  code: ReserveErrorCode;
  detail: string;
}
