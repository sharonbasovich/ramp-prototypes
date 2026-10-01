# Cart Tetris

The cheapest sticker prices can make the most expensive cart. Cart Tetris is a
small-catalog order optimizer: edit basket quantities and a delivery deadline,
then an **exact bounded solver** finds the cheapest feasible split of items
across vendors — exposing shipping fees, free-shipping thresholds, minimum
orders, stock caps, and delivery constraints that unit prices hide.

Everything here is demo data in a sandbox: example pretax quotes in USD cents,
no tax, **no real purchases, no payments, no external calls**.

## Run

```bash
npm ci
npm test          # 27 vitest cases, incl. a 150-case independent oracle fuzz
npm run build     # typecheck (tsc -b) + vite build -> dist/
npm start         # node server on http://localhost:5311 (serves dist + /api)
npm run dev       # vite dev server on :5311
```

Requires Node 22.x (uses built-in `node:sqlite`; Node 22.14 verified).

## What it does

1. Edit quantities (0–12/SKU), remove/add items, pick a 1/2/3/5-day deadline.
2. "Find the cheapest order" runs the exact solver and the cheapest feasible
   single-vendor baseline side by side with itemized breakdowns.
3. Edit vendor quotes inline, or import JSON/CSV (validated before replacing;
   downloadable template). CSV requires explicit `currency` (USD),
   `quoted_at`, and `valid_until` columns on every row — provenance is never
   invented or defaulted.
4. Approve the plan — any later input change voids the approval — then export a
   fully itemized JSON or CSV purchase plan with provenance and assumptions.

## Engine (`src/engine/optimize.ts`)

Exact exhaustive search over every per-SKU **split** (weak compositions of the
quantity across eligible vendors), not just whole-SKU assignments — so stock
caps that force split orders and volume tiers are handled correctly. Honest
bound: ≤3 SKUs, ≤4 vendors, ≤12 units/SKU, ≤5M evaluated allocations; larger
inputs return `boundExceeded` instead of a silent heuristic. Deterministic
tie-break: total cost, then fewer vendors, then a canonical allocation order.

`tests/oracle.test.ts` cross-checks the solver against `src/engine/oracle.ts`,
an independent per-unit brute force over 150 seeded random cases.

## Modes (labeled honestly)

- **SQLite server sandbox** — only claimed after a real `GET /api/health`
  succeeds. `server/index.mjs` serves `dist/` plus `GET/PUT/DELETE /api/state`
  persisted in a local `cart-tetris.sqlite` file written inside a transaction.
- **Browser sandbox** — default when no server answers (e.g. GitHub Pages).
  State persists in IndexedDB inside one transaction, single origin, this
  browser profile only. The same engine runs identically in both modes.

## Scope / limitations

- Demo sandbox only: no real orders, prices, accounts, or payments. Prices are
  example pretax quotes; no tax or currency conversion (USD only).
- Exact solver bound above; imported catalogs beyond it are refused honestly.
- Equivalence is strict: one SKU = the same item at every vendor, no
  substitutions.
- Persistence is local-only (SQLite file or IndexedDB); "Reset demo" restores
  the seed fixture.

## Screenshots & evidence

`docs/screenshots/` — desktop seed result, 1-day deadline recompute, approval +
export state, approval voided on input change, quotes editor, mobile 390px.
`docs/design-review.md` — concept-vs-render comparison.
