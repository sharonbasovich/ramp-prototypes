// UI helpers shared by the three scenario tabs.

/** Parse a user's editable major-unit amount ("980.00" / "1,000") into
 *  minor units for an explicit currency. Strict: en-US format, no signs. */
export function parseAmountInput(currency: string, text: string): { ok: true; minor: bigint } | { ok: false; reason: string } {
  const t = text.trim();
  if (!/^(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/.test(t)) {
    return { ok: false, reason: `not a valid amount: ${text}` };
  }
  const exp = { USD: 2, CAD: 2, EUR: 2, GBP: 2, JPY: 0, KWD: 3 }[currency];
  if (exp === undefined) return { ok: false, reason: `unsupported currency ${currency}` };
  const cleaned = t.replace(/,/g, '');
  const dot = cleaned.indexOf('.');
  const intDigits = dot >= 0 ? cleaned.slice(0, dot) : cleaned;
  const frac = dot >= 0 ? cleaned.slice(dot + 1) : '';
  if (frac.length > exp) return { ok: false, reason: `too many decimal places for ${currency}` };
  const minor = BigInt(intDigits) * 10n ** BigInt(exp) + BigInt(frac.padEnd(exp, '0') || '0');
  return { ok: true, minor };
}

/** Format a decimal minor-unit count for display: "980.00" style (no currency code). */
export function minorToMajor(currency: string, minor: bigint): string {
  const exp = { USD: 2, CAD: 2, EUR: 2, GBP: 2, JPY: 0, KWD: 3 }[currency];
  if (exp === undefined || exp === 0) return minor.toString();
  const s = minor.toString().padStart(exp + 1, '0');
  return `${s.slice(0, s.length - exp)}.${s.slice(-exp)}`;
}

/** "USD 980.00" / "JPY 198,000" from a {currency, minor:string|bigint} shape. */
export function fmtMoney(m: { currency: string; minor: bigint | string }): string {
  const minor = typeof m.minor === 'bigint' ? m.minor : BigInt(m.minor);
  const exp = { USD: 2, CAD: 2, EUR: 2, GBP: 2, JPY: 0, KWD: 3 }[m.currency];
  if (exp === undefined) return `${m.currency} ${minor}`;
  const s = minor.toString();
  const padded = exp > 0 ? s.padStart(exp + 1, '0') : s;
  const intDigits = exp > 0 ? padded.slice(0, padded.length - exp) : padded;
  const grouped = intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return exp > 0 ? `${m.currency} ${grouped}.${padded.slice(-exp)}` : `${m.currency} ${grouped}`;
}

/** Signed headroom display: "USD 20.00" or "−USD 16.00". */
export function fmtSigned(currency: string, minorSigned: bigint): string {
  const neg = minorSigned < 0n;
  const v = fmtMoney({ currency, minor: neg ? -minorSigned : minorSigned });
  return neg ? `−${v}` : v;
}

/** Demo clock display "09:02" from epoch ms. */
export function demoTime(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

export function downloadJSON(filename: string, data: unknown): void {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
