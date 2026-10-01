# BorrowFirst

Before you buy it, find what you already own. BorrowFirst allocates a new
equipment request against inventory your organization already holds, reserves
the chosen assets transactionally, and emits a shopping list only for what is
actually missing.

Built for the private Ramp prototype event. React 19 + Vite + TypeScript
frontend; a small Node HTTP server using `node:sqlite` for genuine
transactional reservations; a static in-browser sandbox fallback for the
public demo. No real purchases, no real transfers, no credentials, no paid
services.

## Run

```bash
cd apps/borrowfirst
npm ci
npm start          # builds, then serves the app + API on http://localhost:5313
```

- `npm run dev` — Vite dev server on :5314, proxies `/api` to :5313
- `npm run test` — `tsc` server build + `vitest run` (22 tests)
- `npm run typecheck` — client + server typecheck
- `npm run build` — `tsc -p tsconfig.server.json` + `vite build`
- `npm run preview` — serve `dist/` statically (forces Browser sandbox mode)

`BORROWFIRST_DB=/path/to/file.db` persists the SQLite database; default is
in-memory. The demo clock is fixed at `2026-09-30T18:00:00Z` (Wednesday,
14:00 America/Toronto) so seeded arrivals and deadlines are deterministic.

## Two honest modes — label is always visible

The header chip never hides which backend is live:

- **SQLite server sandbox** — shown only after a real `GET /api/health`
  returns `{ok:true, backend:'sqlite'}`. Reservations commit inside
  `BEGIN IMMEDIATE … COMMIT` with a partial unique index guaranteeing one
  active reservation per asset; contending writers get `SQLITE_BUSY`/unique
  violations mapped to a conflict response with a recalculation path.
- **Browser sandbox** — static build, no API. State lives in
  `localStorage`, guarded by `navigator.locks` best-effort. The label says
  exactly what it is: single-browser scope, no cross-device or multi-user
  atomicity claim. Every behavior still works — allocation, owner
  confirmation, reservation, import, export, reset — against the same pure
  engine.

## What's real vs. demo

Real: the allocation engine (exact minimum-cost assignment search over the
small inventory, not a heuristic), compatibility/deadline/currency
evaluation, conditional owner-confirmation gating, transactional
reservation with stale-plan revalidation, CSV import, export document.

Demo: fixtures, transfer costs, supplier quotes and prices are example
values labeled as such. "Potential spending avoided" is a projection; the
UI never claims realized savings. No money moves.

## Architecture

```
src/engine/        pure TypeScript — shared verbatim by server, tests, sandbox
  allocate.ts      eligibility + exact assignment search + plan validation
  store.ts         BorrowFirstStore over node:sqlite (schema, seed, reserve, hold, import)
  fixtures.ts      seeded world, demo clock, deadline options
  csv.ts           asset CSV import (tolerant parser, error report)
  export.ts        export document + CSV rendering
  dates.ts money.ts types.ts
server/index.mjs   zero-dep HTTP server: /api/health, /api/state, /api/reserve,
                   /api/hold, /api/owner-confirm, /api/import, /api/export,
                   /api/reset, /api/allocate + static dist with SPA fallback
src/backend/       Backend interface; SqliteBackend; SandboxBackend (localStorage)
src/components/    RequestPanel, AllocationPanel, ReviewPanel, InventoryTable,
                   LocationsView, Header, bits
tests/             vitest, runs against the same engine + store as production
```

The acceptance-matrix cases B01–B14 from `SPEC-BORROW-EXIT.md` each map to a
named test in `tests/` (B04/B05 include a `worker_threads` race and a
mid-flight-asset-loss rejection — the mandatory concurrency cases).
Browser-driven outcomes (deadline change, USB-C spec change, owner
confirmation, reservation, mobile layout) are evidenced in
`docs/screenshots/`; the concept-vs-rendered audit is in
`docs/design-review.md`.

## Deliberate limitations

- Example fixture data only; no persistence guarantee beyond the sandbox DB.
- "Owner confirmation" is simulated by a button — no email/Slack is sent.
- Quotes are static example records with expiry/delivery instants; no live
  supplier integration.
- Browser sandbox cannot coordinate across tabs/devices; it says so on-screen.
- Static export is a `.txt` download containing the JSON document + CSV.
