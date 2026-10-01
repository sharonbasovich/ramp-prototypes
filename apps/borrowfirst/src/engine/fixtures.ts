// Example fixture data for the BorrowFirst demo. Every price, availability
// and confirmation here is sample data — nothing is a live quote or a real
// booking. The demo clock is fixed at an explicit instant so the whole flow
// is reproducible (reset always restores this exact state).

import type { EquipmentRequest, TransferOption, World } from './types.js';

function tr(assetId: string, destinationLocationId: string, costCents: number, earliestArrival: string): TransferOption {
  return { assetId, destinationLocationId, costCents, currency: 'CAD', earliestArrival };
}

// Demo "now": Wednesday 2026-09-30, 14:00 in Waterloo (America/Toronto).
export const DEMO_NOW = '2026-09-30T18:00:00.000Z';
export const DISPLAY_TIMEZONE = 'America/Toronto';

export const DEADLINE_OPTIONS = [
  { id: 'tomorrow', label: 'Tomorrow · Thu Oct 1', requiredBy: '2026-10-01T21:00:00.000Z' },
  { id: 'friday', label: 'Friday · Oct 2', requiredBy: '2026-10-02T21:00:00.000Z' },
  { id: 'next-week', label: 'Next week · Fri Oct 9', requiredBy: '2026-10-09T21:00:00.000Z' },
] as const;

export function seedWorld(): World {
  return {
    demoNow: DEMO_NOW,
    locations: [
      { id: 'loc-waterloo', name: 'Waterloo office' },
      { id: 'loc-kitchener', name: 'Kitchener office' },
      { id: 'loc-toronto', name: 'Toronto office' },
    ],
    assets: [
      {
        id: 'M-101',
        name: 'Monitor M-101',
        category: 'monitor',
        specs: { sizeInches: 24, ports: ['HDMI'] },
        locationId: 'loc-waterloo',
        ownerName: 'IT pool · Waterloo',
        condition: 'functional',
        availability: 'available',
        ownerConfirmationRequired: false,
        ownerConfirmedAt: null,
        source: 'fixture',
        version: 1,
      },
      {
        id: 'M-102',
        name: 'Monitor M-102',
        category: 'monitor',
        specs: { sizeInches: 24, ports: ['HDMI', 'DisplayPort'] },
        locationId: 'loc-waterloo',
        ownerName: 'IT pool · Waterloo',
        condition: 'functional',
        availability: 'available',
        ownerConfirmationRequired: false,
        ownerConfirmedAt: null,
        source: 'fixture',
        version: 1,
      },
      {
        id: 'M-204',
        name: 'Monitor M-204',
        category: 'monitor',
        specs: { sizeInches: 27, ports: ['HDMI'] },
        locationId: 'loc-kitchener',
        ownerName: 'Priya S. · Kitchener',
        condition: 'functional',
        availability: 'available',
        ownerConfirmationRequired: true,
        ownerConfirmedAt: null,
        source: 'fixture',
        version: 1,
      },
      {
        id: 'M-305',
        name: 'Monitor M-305',
        category: 'monitor',
        specs: { sizeInches: 24, ports: ['VGA', 'DisplayPort'] },
        locationId: 'loc-toronto',
        ownerName: 'IT pool · Toronto',
        condition: 'functional',
        availability: 'in_use',
        ownerConfirmationRequired: false,
        ownerConfirmedAt: null,
        source: 'fixture',
        version: 1,
      },
      {
        id: 'M-306',
        name: 'Monitor M-306',
        category: 'monitor',
        specs: { sizeInches: 24, ports: ['HDMI'] },
        locationId: 'loc-kitchener',
        ownerName: 'IT pool · Kitchener',
        condition: 'functional',
        availability: 'available',
        ownerConfirmationRequired: false,
        ownerConfirmedAt: null,
        source: 'fixture',
        version: 1,
      },
      {
        id: 'M-112',
        name: 'Monitor M-112',
        category: 'monitor',
        specs: { sizeInches: 32, ports: ['HDMI'] },
        locationId: 'loc-waterloo',
        ownerName: 'IT pool · Waterloo',
        condition: 'damaged',
        availability: 'available',
        ownerConfirmationRequired: false,
        ownerConfirmedAt: null,
        source: 'fixture',
        version: 1,
      },
    ],
    // Transfer routes are per (asset, destination): a same-office move is
    // cheap and same-day, cross-office courier costs more and arrives later.
    // M-102's handling fee ($250) deliberately costs more than buying new
    // ($225) — the engine only picks it when cheaper spares cannot arrive
    // in time.
    transferOptions: [
      // M-101 — Waterloo
      tr('M-101', 'loc-waterloo', 1500, '2026-09-30T19:00:00.000Z'),
      tr('M-101', 'loc-kitchener', 6000, '2026-10-02T20:00:00.000Z'),
      tr('M-101', 'loc-toronto', 6000, '2026-10-02T20:00:00.000Z'),
      // M-102 — Waterloo
      tr('M-102', 'loc-waterloo', 25000, '2026-09-30T19:00:00.000Z'),
      tr('M-102', 'loc-kitchener', 27000, '2026-09-30T19:00:00.000Z'),
      tr('M-102', 'loc-toronto', 27000, '2026-09-30T19:00:00.000Z'),
      // M-204 — Kitchener: Kitchener→Waterloo courier arrives Friday 16:00,
      // fine for a Friday deadline but too late for tomorrow; the local
      // Kitchener move is same-day.
      tr('M-204', 'loc-waterloo', 1500, '2026-10-02T20:00:00.000Z'),
      tr('M-204', 'loc-kitchener', 1000, '2026-09-30T19:00:00.000Z'),
      tr('M-204', 'loc-toronto', 4000, '2026-10-02T20:00:00.000Z'),
      // M-305 — Toronto (in use anyway)
      tr('M-305', 'loc-waterloo', 2000, '2026-10-02T20:00:00.000Z'),
      tr('M-305', 'loc-kitchener', 3000, '2026-10-02T20:00:00.000Z'),
      tr('M-305', 'loc-toronto', 500, '2026-09-30T19:00:00.000Z'),
      // M-306 — Kitchener: courier to Waterloo only runs next Tuesday, but
      // the local Kitchener move is same-day — destination changes the plan.
      tr('M-306', 'loc-waterloo', 1500, '2026-10-06T13:00:00.000Z'),
      tr('M-306', 'loc-kitchener', 1000, '2026-09-30T19:00:00.000Z'),
      tr('M-306', 'loc-toronto', 4500, '2026-10-06T13:00:00.000Z'),
      // M-112 — Waterloo (damaged; routes exist but the asset is excluded)
      tr('M-112', 'loc-waterloo', 1500, '2026-09-30T19:00:00.000Z'),
      tr('M-112', 'loc-kitchener', 5000, '2026-10-02T20:00:00.000Z'),
      tr('M-112', 'loc-toronto', 5000, '2026-10-02T20:00:00.000Z'),
    ],
    purchaseOptions: [
      {
        id: 'po-new',
        label: 'New monitor purchase',
        category: 'monitor',
        specs: { sizeInches: 24, ports: ['HDMI', 'DisplayPort', 'USB-C'] },
        unitCostCents: 22500,
        flatShippingCents: 0,
        maxQuantity: 50,
        currency: 'CAD',
        deliveryInstant: '2026-10-02T16:00:00.000Z', // Friday noon — not tomorrow
        provenance: 'Example supplier quote · not a live price',
        expiresAt: '2026-10-07T04:00:00.000Z',
        version: 1,
      },
      {
        id: 'po-refurb',
        label: 'Certified refurbished monitor',
        category: 'monitor',
        specs: { sizeInches: 24, ports: ['HDMI'] },
        unitCostCents: 19000,
        flatShippingCents: 2000,
        maxQuantity: 10,
        currency: 'CAD',
        deliveryInstant: '2026-10-09T16:00:00.000Z', // only feasible for next week
        provenance: 'Example supplier quote · not a live price',
        expiresAt: '2026-10-30T04:00:00.000Z',
        version: 1,
      },
    ],
    reservations: [],
  };
}

export function defaultRequest(): EquipmentRequest {
  return {
    id: 'req-1',
    category: 'monitor',
    quantity: 3,
    minSizeInches: 24,
    requiredPorts: ['HDMI'],
    destinationLocationId: 'loc-waterloo',
    requiredBy: '2026-10-02T21:00:00.000Z', // Friday end of day
    currency: 'CAD',
  };
}
