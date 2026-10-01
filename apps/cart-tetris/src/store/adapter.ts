import type { BasketItem, QuoteSet } from '../engine/types';
import type { Approval } from '../approval';

export interface PersistedState {
  items: BasketItem[];
  deadlineDays: number;
  quoteSet: QuoteSet;
  approval: Approval | null;
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
