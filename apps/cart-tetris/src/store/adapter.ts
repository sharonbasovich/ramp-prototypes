import type { BasketItem, QuoteSet } from '../engine/types';

export interface PersistedState {
  items: BasketItem[];
  deadlineDays: number;
  quoteSet: QuoteSet;
  approval: { signature: string; approvedAt: string } | null;
}

export type StoreMode = 'server' | 'browser';

export interface StoreAdapter {
  mode: StoreMode;
  /** True when a real /api/health round-trip succeeded. */
  healthy: boolean;
  load(): Promise<PersistedState | null>;
  save(state: PersistedState): Promise<void>;
  clear(): Promise<void>;
}

export const MODE_LABEL: Record<StoreMode, string> = {
  server: 'SQLite server sandbox',
  browser: 'Browser sandbox',
};
