// CSV import for extra inventory rows. Imported rows are marked
// source: 'imported' so they are always distinguishable from fixtures.
// Expected header:
// id,name,size_inches,ports,location,owner,condition,availability,
// owner_confirm_required,transfer_cost_cents,earliest_arrival
// ports: semicolon-separated, e.g. "HDMI;DisplayPort"

import type { Asset, TransferOption, World } from './types.js';

export interface ImportResult {
  assets: Asset[];
  transfers: TransferOption[];
  errors: string[];
}

const LOCATIONS: Record<string, string> = {
  waterloo: 'loc-waterloo',
  kitchener: 'loc-kitchener',
  toronto: 'loc-toronto',
};

export function parseAssetCsv(text: string, world: World): ImportResult {
  const errors: string[] = [];
  const assets: Asset[] = [];
  const transfers: TransferOption[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) {
    return { assets, transfers, errors: ['File is empty'] };
  }
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const required = ['id', 'name', 'size_inches', 'ports', 'location', 'condition'];
  for (const col of required) {
    if (!header.includes(col)) errors.push(`Missing column "${col}"`);
  }
  if (errors.length > 0) return { assets, transfers, errors };

  const knownLocationIds = new Set(world.locations.map((l) => l.id));
  const existingIds = new Set(world.assets.map((a) => a.id));
  const seen = new Set<string>();

  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',').map((c) => c.trim());
    const row: Record<string, string> = {};
    header.forEach((h, idx) => (row[h] = cells[idx] ?? ''));
    const lineNo = i + 1;

    const id = row['id'];
    if (!id) { errors.push(`Line ${lineNo}: missing id`); continue; }
    if (existingIds.has(id) || seen.has(id)) {
      errors.push(`Line ${lineNo}: duplicate asset id ${id} — skipped`);
      continue;
    }
    const size = Number(row['size_inches']);
    if (!Number.isFinite(size) || size <= 0) {
      errors.push(`Line ${lineNo}: size_inches must be a positive number, got "${row['size_inches']}"`);
      continue;
    }
    const ports = row['ports'].split(';').map((p) => p.trim()).filter(Boolean);
    const locationKey = row['location'].toLowerCase();
    let locationId = LOCATIONS[locationKey];
    if (!locationId) {
      const byName = world.locations.find((l) => l.name.toLowerCase() === locationKey);
      const byId = knownLocationIds.has(row['location']) ? row['location'] : null;
      locationId = byName?.id ?? byId ?? '';
    }
    if (!locationId || !knownLocationIds.has(locationId)) {
      errors.push(`Line ${lineNo}: unknown location "${row['location']}"`);
      continue;
    }
    const condition = row['condition'].toLowerCase();
    if (condition !== 'functional' && condition !== 'damaged') {
      errors.push(`Line ${lineNo}: condition must be functional or damaged, got "${row['condition']}"`);
      continue;
    }
    const availability = (row['availability'] || 'available').toLowerCase();
    if (!['available', 'in_use', 'retired'].includes(availability)) {
      errors.push(`Line ${lineNo}: availability must be available/in_use/retired, got "${availability}"`);
      continue;
    }
    const costCents = Number(row['transfer_cost_cents'] || '0');
    if (!Number.isInteger(costCents) || costCents < 0) {
      errors.push(`Line ${lineNo}: transfer_cost_cents must be a non-negative integer`);
      continue;
    }
    const arrival = row['earliest_arrival'] || world.demoNow;
    if (Number.isNaN(Date.parse(arrival))) {
      errors.push(`Line ${lineNo}: earliest_arrival is not a parseable date: "${arrival}"`);
      continue;
    }
    seen.add(id);
    assets.push({
      id,
      name: row['name'] || `Monitor ${id}`,
      category: 'monitor',
      specs: { sizeInches: size, ports },
      locationId,
      ownerName: row['owner'] || 'Imported owner',
      condition: condition as Asset['condition'],
      availability: availability as Asset['availability'],
      ownerConfirmationRequired: ['1', 'true', 'yes'].includes((row['owner_confirm_required'] || '').toLowerCase()),
      ownerConfirmedAt: null,
      source: 'imported',
      version: 1,
    });
    transfers.push({ assetId: id, costCents, currency: 'CAD', earliestArrival: arrival });
  }
  return { assets, transfers, errors };
}
