// shared/seed.mjs — deterministic demo seed + config validation.
// All money is integer minor units (cents). Everything here is sample data.

export const DEFAULT_SEED = {
  wallet: { budgetMinor: 10000, approvalThresholdMinor: 5000, quoteTtlMs: 120000 },
  catalog: [
    { itemId: 'monitor', name: 'Monitor', priceMinor: 6000, category: 'Workspace' },
    { itemId: 'keyboard', name: 'Keyboard', priceMinor: 4500, category: 'Workspace' },
    { itemId: 'usb-hub', name: 'USB-C hub', priceMinor: 3800, category: 'Workspace' },
    { itemId: 'notebook-pack', name: 'Notebook pack', priceMinor: 1200, category: 'Workspace' },
    { itemId: 'sensor-kit', name: 'Sensor kit', priceMinor: 9000, category: 'Engineering' },
    { itemId: 'gadget', name: 'Experimental gadget', priceMinor: 20000, category: 'Research' },
  ],
  agents: [
    {
      agentId: 'ada',
      name: 'Agent Ada',
      lane: 'Workspace essentials',
      items: ['monitor', 'keyboard', 'usb-hub', 'notebook-pack'],
    },
    {
      agentId: 'ben',
      name: 'Agent Ben',
      lane: 'Engineering tools',
      items: ['monitor', 'sensor-kit', 'usb-hub', 'keyboard'],
    },
    {
      agentId: 'cleo',
      name: 'Agent Cleo',
      lane: 'Research & experimentation',
      items: ['sensor-kit', 'notebook-pack', 'monitor'],
    },
  ],
};

const LIMITS = {
  maxBudgetMinor: 1_000_000_00,
  maxPriceMinor: 1_000_000_00,
  minQuoteTtlMs: 500,
  maxQuoteTtlMs: 3_600_000,
};

function isInt(v) {
  return typeof v === 'number' && Number.isInteger(v);
}

/**
 * Validate + normalize a config object into a full seed.
 * Unknown fields are ignored; missing sections fall back to DEFAULT_SEED.
 * Returns { ok, seed?, error? } — callers surface `error` as a 400.
 */
export function buildSeed(input) {
  const src = input && typeof input === 'object' ? input : {};
  const w = src.wallet ?? {};
  const wallet = {
    budgetMinor: isInt(w.budgetMinor) ? w.budgetMinor : DEFAULT_SEED.wallet.budgetMinor,
    approvalThresholdMinor: isInt(w.approvalThresholdMinor)
      ? w.approvalThresholdMinor
      : DEFAULT_SEED.wallet.approvalThresholdMinor,
    quoteTtlMs: isInt(w.quoteTtlMs) ? w.quoteTtlMs : DEFAULT_SEED.wallet.quoteTtlMs,
  };
  if (wallet.budgetMinor < 0 || wallet.budgetMinor > LIMITS.maxBudgetMinor) {
    return { ok: false, error: `budgetMinor must be an integer 0..${LIMITS.maxBudgetMinor}` };
  }
  if (wallet.approvalThresholdMinor < 0 || wallet.approvalThresholdMinor > LIMITS.maxBudgetMinor) {
    return { ok: false, error: `approvalThresholdMinor must be an integer 0..${LIMITS.maxBudgetMinor}` };
  }
  if (wallet.quoteTtlMs < LIMITS.minQuoteTtlMs || wallet.quoteTtlMs > LIMITS.maxQuoteTtlMs) {
    return { ok: false, error: `quoteTtlMs must be ${LIMITS.minQuoteTtlMs}..${LIMITS.maxQuoteTtlMs}` };
  }

  let catalog = DEFAULT_SEED.catalog;
  if (Array.isArray(src.catalog)) {
    catalog = [];
    const seen = new Set();
    for (const raw of src.catalog) {
      const itemId = String(raw?.itemId ?? '').trim();
      const name = String(raw?.name ?? '').trim();
      const priceMinor = raw?.priceMinor;
      if (!itemId || itemId.length > 60) return { ok: false, error: 'catalog item missing itemId' };
      if (seen.has(itemId)) return { ok: false, error: `duplicate catalog item '${itemId}'` };
      seen.add(itemId);
      if (!name) return { ok: false, error: `catalog item '${itemId}' missing name` };
      if (!isInt(priceMinor) || priceMinor < 0 || priceMinor > LIMITS.maxPriceMinor) {
        return { ok: false, error: `catalog item '${itemId}' needs integer priceMinor 0..${LIMITS.maxPriceMinor}` };
      }
      catalog.push({ itemId, name, priceMinor, category: String(raw?.category ?? 'General') });
    }
    if (!catalog.length) return { ok: false, error: 'catalog cannot be empty' };
  }
  const catalogIds = new Set(catalog.map((c) => c.itemId));

  let agents = DEFAULT_SEED.agents;
  if (Array.isArray(src.agents)) {
    agents = [];
    const seen = new Set();
    for (const raw of src.agents) {
      const agentId = String(raw?.agentId ?? '').trim();
      const name = String(raw?.name ?? '').trim();
      if (!agentId || agentId.length > 60) return { ok: false, error: 'agent missing agentId' };
      if (seen.has(agentId)) return { ok: false, error: `duplicate agent '${agentId}'` };
      seen.add(agentId);
      if (!name) return { ok: false, error: `agent '${agentId}' missing name` };
      const items = Array.isArray(raw?.items) ? raw.items.map((i) => String(i)) : [];
      for (const it of items) {
        if (!catalogIds.has(it)) return { ok: false, error: `agent '${agentId}' permitted unknown item '${it}'` };
      }
      agents.push({ agentId, name, lane: String(raw?.lane ?? ''), items });
    }
    if (!agents.length) return { ok: false, error: 'agents cannot be empty' };
  } else {
    for (const a of agents) {
      for (const it of a.items) {
        if (!catalogIds.has(it)) return { ok: false, error: `default permission references unknown item '${it}'` };
      }
    }
  }

  return { ok: true, seed: { wallet, catalog, agents } };
}
