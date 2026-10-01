// Display helpers for instants. All labels are computed against the fixed
// demo clock (DISPLAY_TIMEZONE) so the demo is reproducible.

import { DISPLAY_TIMEZONE } from './fixtures.js';

const dayFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: DISPLAY_TIMEZONE,
  weekday: 'long',
  month: 'short',
  day: 'numeric',
});

const shortFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: DISPLAY_TIMEZONE,
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});

const timeFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: DISPLAY_TIMEZONE,
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
});

function dayKey(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: DISPLAY_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

export function labelArrival(iso: string, demoNow: string): string {
  const nowKey = dayKey(demoNow);
  const targetKey = dayKey(iso);
  const target = new Date(iso);
  if (targetKey === nowKey) return `Today · ${timeFmt.format(target)}`;
  const tomorrow = new Date(demoNow);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  if (targetKey === dayKey(tomorrow.toISOString())) return `Tomorrow · ${timeFmt.format(target)}`;
  return `${shortFmt.format(target)} · ${timeFmt.format(target)}`;
}

export function labelDeadline(iso: string): string {
  return `${dayFmt.format(new Date(iso))} · ${timeFmt.format(new Date(iso))}`;
}
