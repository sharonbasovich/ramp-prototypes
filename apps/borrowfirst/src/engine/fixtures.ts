// Example fixture data for the BorrowFirst demo. Every price, availability
// and confirmation here is sample data — nothing is a live quote or a real
// booking. The demo clock is fixed at an explicit instant so the whole flow
// is reproducible (reset always restores this exact state).

import type { EquipmentRequest, World } from './types.js';

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
    transferOptions: [
      // Same-office transfers arrive the same day.
      { assetId: 'M-101', costCents: 1500, currency: 'CAD', earliestArrival: '2026-09-30T19:00:00.000Z' },
      // M-102 is available today but its handling/transfer fee ($250) costs
      // more than buying new ($225) — the engine only picks it when the
      // cheaper spares cannot meet the deadline.
      { assetId: 'M-102', costCents: 25000, currency: 'CAD', earliestArrival: '2026-09-30T19:00:00.000Z' },
      // Kitchener → Waterloo courier arrives Friday 16:00: fine for a Friday
      // deadline, too late for tomorrow.
      { assetId: 'M-204', costCents: 1500, currency: 'CAD', earliestArrival: '2026-10-02T20:00:00.000Z' },
      { assetId: 'M-305', costCents: 2000, currency: 'CAD', earliestArrival: '2026-10-02T20:00:00.000Z' },
      { assetId: 'M-306', costCents: 1500, currency: 'CAD', earliestArrival: '2026-10-06T13:00:00.000Z' },
      { assetId: 'M-112', costCents: 1500, currency: 'CAD', earliestArrival: '2026-09-30T19:00:00.000Z' },
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
