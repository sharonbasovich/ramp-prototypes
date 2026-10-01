import type { Currency } from './types.js';

export function formatCents(cents: number, currency: Currency): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString('en-US');
  const rem = String(abs % 100).padStart(2, '0');
  const symbol = currency === 'USD' ? 'US$' : '$';
  return `${sign}${symbol}${dollars}.${rem}`;
}

export function assertFiniteCents(value: number, field: string): void {
  if (!Number.isInteger(value) || !Number.isFinite(value)) {
    throw new Error(`${field} must be an integer number of cents, got ${value}`);
  }
}
