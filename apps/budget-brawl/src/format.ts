export function fmtMoney(minor: number): string {
  return `$${(minor / 100).toLocaleString('en-US', {
    minimumFractionDigits: minor % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

export function fmtTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function dollarsToMinor(s: string): number | null {
  const v = Number(s);
  if (!Number.isFinite(v) || v < 0) return null;
  return Math.round(v * 100);
}

let counter = 0;
export function newRequestId(): string {
  counter += 1;
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `REQ-${rand}${counter}`;
}
