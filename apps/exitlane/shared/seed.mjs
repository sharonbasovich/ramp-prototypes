// shared/seed.mjs — deterministic demo fixtures for ExitLane.
// All money is integer minor units (cents), fixed USD. All instants are UTC
// ISO strings with offsets; the display timezone is America/Toronto.
// Everything below is labeled sample data — no real bookings or providers.

export const DISPLAY_TZ = 'America/Toronto';
export const CURRENCY = 'USD';

// Demo clock: Fri, Apr 25, 2025 10:00 AM Toronto (EDT) = 14:00 UTC.
export const DEFAULT_CLOCK_ISO = '2025-04-25T14:00:00Z';

export const DEFAULT_SEED = {
  clockInstant: DEFAULT_CLOCK_ISO,
  event: {
    eventId: 'evt-offsite',
    name: 'Team off-site · Friday',
    startInstant: '2025-04-25T13:00:00Z', // Fri 9:00 AM Toronto
    bookedInstant: '2025-04-18T14:00:00Z', // Fri Apr 18, 10:00 AM Toronto
    displayTz: DISPLAY_TZ,
    status: 'active', // 'active' | 'canceled'
    canceledInstant: null,
  },
  bookings: [
    {
      bookingId: 'bk-room',
      service: 'Room',
      provider: 'Harbor View Hotel',
      providerId: 'harborview',
      serviceLabel: 'Fri, Apr 25 – Sat, Apr 26 · 1 room',
      serviceInstant: '2025-04-25T19:00:00Z', // Fri 3:00 PM Toronto
      committedMinor: 40000,
      paidMinor: 40000,
      unpaidMinor: 0,
      currency: CURRENCY,
      confirmationRef: 'HV-4471',
      version: 1,
      status: 'active',
      policyId: 'pol-room',
    },
    {
      bookingId: 'bk-catering',
      service: 'Catering',
      provider: 'GoodFood Co.',
      providerId: 'goodfood',
      serviceLabel: 'Fri, Apr 25 · 20 people',
      serviceInstant: '2025-04-25T16:00:00Z', // Fri 12:00 PM Toronto
      committedMinor: 30000,
      paidMinor: 30000,
      unpaidMinor: 0,
      currency: CURRENCY,
      confirmationRef: 'GF-8820',
      version: 1,
      status: 'active',
      policyId: 'pol-catering',
    },
    {
      bookingId: 'bk-equipment',
      service: 'Equipment',
      provider: 'StageRight Rentals',
      providerId: 'stageright',
      serviceLabel: 'Fri, Apr 25 · AV package',
      serviceInstant: '2025-04-25T13:00:00Z',
      committedMinor: 20000,
      paidMinor: 20000,
      unpaidMinor: 0,
      currency: CURRENCY,
      confirmationRef: 'SR-2291',
      version: 1,
      status: 'active',
      policyId: 'pol-equipment',
    },
    {
      bookingId: 'bk-shuttle',
      service: 'Shuttle',
      provider: 'CityShuttle',
      providerId: 'cityshuttle',
      serviceLabel: 'Fri, Apr 25 · airport run',
      serviceInstant: '2025-04-25T12:00:00Z',
      committedMinor: 18000,
      paidMinor: 4000, // $40 deposit; $140 still owed -> future charges avoided
      unpaidMinor: 14000,
      currency: CURRENCY,
      confirmationRef: 'CS-1173',
      version: 1,
      status: 'active',
      policyId: 'pol-shuttle',
    },
    {
      bookingId: 'bk-decor',
      service: 'Decor',
      provider: 'BloomBox Styling',
      providerId: 'bloombox',
      serviceLabel: 'Fri, Apr 25 · table styling',
      serviceInstant: '2025-04-25T15:00:00Z',
      committedMinor: 9500,
      paidMinor: 9500,
      unpaidMinor: 0,
      currency: CURRENCY,
      confirmationRef: 'BB-5093',
      version: 1,
      status: 'active',
      policyId: 'pol-decor',
    },
  ],
  // Structured cancellation policies. Each tier: boundary operator +
  // cutoff instant (UTC ISO) + cancellation fee. Tiers must partition
  // time — exactly one applies at any instant. 'before' applies when
  // now < cutoffInstant; 'at_or_after' when now >= cutoffInstant;
  // 'always' is only valid as the sole tier of a policy. Two matching
  // tiers is a contradictory policy -> manual review, never a guess.
  policies: [
    {
      policyId: 'pol-room',
      version: 'v3',
      supported: true,
      summary: 'Free cancellation up to 24 hours before check-in.',
      sourceRef: 'Harbor View Hotel terms §4.2 (sample), reviewed Apr 18',
      checkInInstant: '2025-04-26T16:00:00Z', // Sat 12:00 PM Toronto
      tiers: [
        {
          tierId: 'free',
          boundary: 'before',
          cutoffInstant: '2025-04-25T16:00:00Z', // check-in minus 24h, Fri 12:00 PM Toronto
          label: 'Cancel before 12:00 PM Fri (24h before check-in)',
          fee: { kind: 'fixed', amountMinor: 0 },
        },
        {
          tierId: 'inside-24h',
          boundary: 'at_or_after',
          cutoffInstant: '2025-04-25T16:00:00Z',
          label: 'Inside 24 hours of check-in',
          fee: { kind: 'percent', percent: 100 },
        },
      ],
    },
    {
      policyId: 'pol-catering',
      version: 'v2',
      supported: true,
      summary: '50% cancellation fee within 7 days of event.',
      sourceRef: 'GoodFood Co. catering agreement §2 (sample), reviewed Apr 18',
      tiers: [
        {
          tierId: 'outside-7d',
          boundary: 'before',
          cutoffInstant: '2025-04-18T13:00:00Z', // event start minus 7 days
          label: 'Cancel 7+ days before event',
          fee: { kind: 'fixed', amountMinor: 0 },
        },
        {
          tierId: 'within-7d',
          boundary: 'at_or_after',
          cutoffInstant: '2025-04-18T13:00:00Z',
          label: 'Within 7 days of event',
          fee: { kind: 'percent', percent: 50 },
        },
      ],
    },
    {
      policyId: 'pol-equipment',
      version: 'v1',
      supported: true,
      summary: 'No refunds within 7 days of event.',
      sourceRef: 'StageRight Rentals rental terms §7 (sample), reviewed Apr 18',
      tiers: [
        {
          tierId: 'outside-7d',
          boundary: 'before',
          cutoffInstant: '2025-04-18T13:00:00Z',
          label: 'Cancel 7+ days before event',
          fee: { kind: 'fixed', amountMinor: 0 },
        },
        {
          tierId: 'within-7d',
          boundary: 'at_or_after',
          cutoffInstant: '2025-04-18T13:00:00Z',
          label: 'Within 7 days of event',
          fee: { kind: 'percent', percent: 100 },
        },
      ],
    },
    {
      policyId: 'pol-shuttle',
      version: 'v1',
      supported: true,
      summary: 'Flat $60 cancellation fee at any time.',
      sourceRef: 'CityShuttle charter contract §5 (sample), reviewed Apr 18',
      tiers: [
        {
          tierId: 'flat',
          boundary: 'always',
          label: 'Any cancellation',
          fee: { kind: 'fixed', amountMinor: 6000 },
        },
      ],
    },
    {
      policyId: 'pol-decor',
      version: 'v1',
      supported: false, // policy text is not machine-readable -> manual review
      summary: 'Cancellation terms "subject to review" — not a supported structure.',
      sourceRef: 'BloomBox Styling email quote (sample), unreadable terms',
      tiers: [],
    },
  ],
  // Deterministic sandbox providers. Each attempt consumes the next scripted
  // outcome; the last one repeats. 'fail:<code>:<detail>' simulates an error.
  // No real provider is ever contacted.
  providers: {
    harborview: { displayName: 'Harbor View Hotel', script: ['confirmed'] },
    goodfood: { displayName: 'GoodFood Co.', script: ['confirmed'] },
    stageright: {
      displayName: 'StageRight Rentals',
      script: ['fail:503:Simulated provider outage — try again', 'confirmed'],
    },
    cityshuttle: { displayName: 'CityShuttle', script: ['confirmed'] },
    bloombox: { displayName: 'BloomBox Styling', script: ['confirmed'] },
  },
};

function isInt(v) {
  return typeof v === 'number' && Number.isInteger(v);
}

const MAX_MINOR = 100_000_000_00;

/**
 * Validate + normalize a config object into a full seed. Used by /api/reset
 * and the browser sandbox so tests can inject adversarial fixtures.
 * Returns { ok, seed?, error? }.
 */
export function buildSeed(input) {
  const src = input && typeof input === 'object' ? input : {};
  const seed = JSON.parse(JSON.stringify(DEFAULT_SEED));

  if (src.event !== undefined) {
    const e = src.event;
    if (!e || typeof e !== 'object' || !String(e.eventId ?? '').trim()) {
      return { ok: false, error: 'event requires an eventId' };
    }
    for (const k of ['startInstant', 'bookedInstant']) {
      if (e[k] !== undefined && Number.isNaN(Date.parse(e[k]))) {
        return { ok: false, error: `event.${k} is not a valid ISO instant` };
      }
    }
    seed.event = { ...seed.event, ...e, status: 'active', canceledInstant: null };
  }

  if (src.clockInstant !== undefined) {
    if (Number.isNaN(Date.parse(src.clockInstant))) {
      return { ok: false, error: 'clockInstant is not a valid ISO instant' };
    }
    seed.clockInstant = src.clockInstant;
  }

  if (src.bookings !== undefined) {
    if (!Array.isArray(src.bookings) || !src.bookings.length) {
      return { ok: false, error: 'bookings must be a non-empty array' };
    }
    const seen = new Set();
    const bookings = [];
    for (const raw of src.bookings) {
      const bookingId = String(raw?.bookingId ?? '').trim();
      if (!bookingId || bookingId.length > 60) return { ok: false, error: 'booking missing bookingId' };
      if (seen.has(bookingId)) return { ok: false, error: `duplicate booking '${bookingId}'` };
      seen.add(bookingId);
      for (const k of ['committedMinor', 'paidMinor', 'unpaidMinor']) {
        if (!isInt(raw[k]) || raw[k] < 0 || raw[k] > MAX_MINOR) {
          return { ok: false, error: `booking '${bookingId}' needs integer ${k} 0..${MAX_MINOR}` };
        }
      }
      bookings.push({
        bookingId,
        service: String(raw.service ?? bookingId),
        provider: String(raw.provider ?? 'Example provider'),
        providerId: String(raw.providerId ?? 'example'),
        serviceLabel: String(raw.serviceLabel ?? ''),
        serviceInstant: String(raw.serviceInstant ?? seed.event.startInstant),
        committedMinor: raw.committedMinor,
        paidMinor: raw.paidMinor,
        unpaidMinor: raw.unpaidMinor,
        currency: String(raw.currency ?? CURRENCY),
        confirmationRef: String(raw.confirmationRef ?? ''),
        version: isInt(raw.version) ? raw.version : 1,
        status: ['active', 'canceled'].includes(raw.status) ? raw.status : 'active',
        policyId: String(raw.policyId ?? ''),
      });
    }
    seed.bookings = bookings;
  }

  if (src.policies !== undefined) {
    if (!Array.isArray(src.policies)) return { ok: false, error: 'policies must be an array' };
    seed.policies = src.policies.map((p) => ({
      policyId: String(p.policyId ?? ''),
      version: String(p.version ?? 'v1'),
      supported: p.supported !== false,
      summary: String(p.summary ?? ''),
      sourceRef: String(p.sourceRef ?? ''),
      checkInInstant: p.checkInInstant ?? null,
      tiers: Array.isArray(p.tiers) ? p.tiers : [],
    }));
  }

  if (src.providers !== undefined) {
    seed.providers = src.providers;
  }

  const policyIds = new Set(seed.policies.map((p) => p.policyId));
  for (const b of seed.bookings) {
    if (b.policyId && !policyIds.has(b.policyId)) {
      return { ok: false, error: `booking '${b.bookingId}' references unknown policy '${b.policyId}'` };
    }
  }
  return { ok: true, seed };
}
