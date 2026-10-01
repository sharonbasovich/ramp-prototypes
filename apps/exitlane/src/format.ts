// Display helpers. Instants are stored in UTC and rendered in
// America/Toronto unless noted. Money is integer cents USD.

const TORONTO = 'America/Toronto';

export function fmtMoney(minor: number | null | undefined): string {
  if (minor === null || minor === undefined || !Number.isFinite(minor)) return '—';
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  return abs % 100 === 0 ? `${sign}$${(abs / 100).toLocaleString()}` : `${sign}$${(abs / 100).toFixed(2)}`;
}

export function dollarsToMinor(text: string): number | null {
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

const dtf = new Intl.DateTimeFormat('en-US', {
  timeZone: TORONTO,
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

const dtfFull = new Intl.DateTimeFormat('en-US', {
  timeZone: TORONTO,
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
  timeZoneName: 'short',
});

const dtfDay = new Intl.DateTimeFormat('en-US', {
  timeZone: TORONTO,
  month: 'short',
  day: 'numeric',
});

export function fmtInstant(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return dtf.format(d);
}

export function fmtInstantFull(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${dtfFull.format(d)} Toronto`;
}

export function fmtDay(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return dtfDay.format(d);
}

export function fmtUtc(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.toISOString().replace('.000Z', 'Z')} (UTC)`;
}

/**
 * Convert between the demo clock instant (UTC ISO) and the
 * America/Toronto wall-clock value a datetime-local input edits.
 */
export function instantToTorontoInput(iso: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TORONTO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}`;
}

/**
 * Toronto wall time ("YYYY-MM-DDTHH:mm") -> UTC ISO instant.
 * Computes the zone offset iteratively so DST transitions (the 2025
 * spring-forward is Mar 9, fall-back Nov 2) resolve correctly.
 */
export function torontoInputToInstant(input: string): string | null {
  const m = input.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  const wallMs = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const offsetOf = (utcMs: number) => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: TORONTO,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(new Date(utcMs));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    const hour = get('hour') === 24 ? 0 : get('hour');
    const asWall = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
    return asWall - utcMs;
  };
  let utc = wallMs;
  for (let i = 0; i < 3; i++) {
    const off = offsetOf(utc);
    const next = wallMs - off;
    if (next === utc) break;
    utc = next;
  }
  return new Date(utc).toISOString();
}
