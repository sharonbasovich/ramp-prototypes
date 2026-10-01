# Budget Brawl

**Three scripted agents share one enforced budget. Who gets to spend it?**

A working prototype for Sharon's private Ramp event: three agent lanes fire
purchase requests at a shared wallet while the wallet enforces
`spent + reserved <= budget`. The local SQLite server handles real concurrent
HTTP requests; the static public demo is explicitly a single-tab browser sandbox.

> Demo data only. Simulated marketplace, scripted agents, no real purchases,
> no Ramp integration, no real payments or card issuance.

## Run

```bash
npm ci
npm run build
npm start          # http://localhost:5314  (SPA + same-origin /api)
npm test           # node:test — 35 tests, incl. real concurrent HTTP
npm run typecheck  # tsc --noEmit
```

The server (`server/index.mjs`) serves `dist/` plus `/api/*` on port 5314 and
persists to `node:sqlite` at `.data/budget-brawl.sqlite` (created on first run).
`BUDGET_BRAWL_DB` and `PORT` env vars override both.

## What it demonstrates

- **Transactional reservations** — each request is validated (permission,
  quantity), priced from the **authoritative server catalog** (an agent's
  claimed price is recorded but never used), and reserved inside a single
  `BEGIN IMMEDIATE` SQLite transaction. The invariant
  `spentMinor + heldMinor <= budgetMinor` is checked and written atomically.
- **Real concurrency** — `tests/acceptance.test.mjs` fires 20 simultaneous
  HTTP requests at a $90 wallet: exactly one $60 hold survives, $30 remains,
  no negative balance. A commit/cancel race produces exactly one terminal
  transition.
- **Idempotent request IDs** — replaying a request ID returns the stored
  original result (`replayed: true`); no duplicate row, no double charge.
  Double-cancelling returns funds exactly once.
- **Approval threshold** — above the threshold a request becomes
  **pending approval** (never auto-denied). If funds fit, they're held; if
  not, the request pends with no hold and approving it later re-checks
  availability — approval can never overspend (`awaiting_funds` state).
- **Permission scopes** — Cleo's $200 gadget is denied because it is not in
  her permission scope, *not* because of any amount threshold. Scopes are
  immutable at request time.
- **Quote timeout + change recheck** — every request stores a quoted price
  with a TTL. Expired quotes release their hold before new reservations,
  approval, or budget changes decide available capacity (no GET required).
  The UI refreshes at the next expiry. If the catalog price moved,
  the commit is refused as stale (funds released, never charged the old price).
- **Reset** — deterministic reset bumps the epoch. Commands carry the epoch
  captured with their request: an old command gets `409 stale_epoch`, even
  when its request ID is reused in the new sandbox. Missing epochs get 400.
- **Impact counter** — terminal budget denials and pending approval/funds
  are reported separately. Pending requests may still succeed; requested
  sample amounts are explicitly not realized savings.
- **Safe money bounds** — budget, threshold and unit prices accept integer
  cents from 0 through 100,000,000 ($1 million), preserving exact arithmetic.

## Modes (shown on-screen at all times)

| Badge | Meaning |
| --- | --- |
| **SQLite backend sandbox — transactional ledger** | `/api/health` answered with `engine: "sqlite"`. Real transactional enforcement of the shared wallet. |
| **Browser sandbox — this tab only** | No server reachable. Same engine runs on an in-memory store persisted to `localStorage` (Web Locks when available). Single tab on this origin — it cannot prove cross-client enforcement and says so. |

## API

| Route | Purpose |
| --- | --- |
| `GET /api/health` | `{engine:"sqlite"}` probe used to select the backend mode |
| `GET /api/state` | wallet, totals, invariant check, catalog, agents, requests, purchases, events, impact |
| `POST /api/reset` | reseed; optional `{config}` body imports a custom wallet/catalog/agents (used by tests) |
| `POST /api/config` | edit budgetMinor / approvalThresholdMinor / quoteTtlMs (budget can't drop below commitments) |
| `POST /api/catalog/price` | edit a sample catalog price (open quotes keep their quoted price) |
| `POST /api/requests` | `{epoch, requestId, agentId, itemId, qty, claimedPriceMinor?}` → reserve / pending / denied |
| `POST /api/requests/:id/{approve,reject,commit,cancel}` | `{epoch}` from the original row; lifecycle transitions with replay protection |

Read the epoch from `/api/state` when creating a request, and keep that
request's returned epoch for its later actions. Never replace an old
command's epoch with a freshly fetched one after reset.

## Layout

```
server/index.mjs      HTTP + static file server (node:http, zero deps)
server/sqlstore.mjs   node:sqlite store — BEGIN IMMEDIATE transactions
shared/engine.mjs     ALL business rules (one implementation, both backends)
shared/memstore.mjs   in-memory store for the browser sandbox
shared/seed.mjs       demo seed + config validation
src/                  React + Vite + TypeScript UI
tests/                independent acceptance (HTTP) + engine unit tests
```

## Scope and limitations

- Sample marketplace with editable sample catalog prices. Integer cents only;
  fixed USD; no tax, no conversions.
- Scripted agents are labeled scripted. No AI model is integrated or claimed.
- No real payments, cards, suppliers, or financial data. Nothing leaves the
  machine; browser mode stays in one tab on one origin.
- Single-wallet scope. Multi-wallet, priorities, and model-driven agents are
  documented stretch goals, not implemented.

## Testing evidence

`npm test` → **35/35 pass**, including: 20-way reservation race (exactly one
hold), reserve→commit conservation, replayed purchase (same purchase ID),
double-cancel (funds once), forged-price rejection, invalid quantity matrix,
approval-under-scarcity (cannot overspend), expired + stale quotes,
commit/cancel race (one terminal transition), permission denial, epoch reset
isolation with reused IDs, safe money bounds, mutation-time expiry without
GET, truthful pending counts, and a 30-request invariant storm. Direct
TypeScript browser-adapter tests cover expiry, stale epochs and consistent
error responses without a UI browser. Test teardown awaits the server's
exit before removing its temporary SQLite files on Windows. Earlier
browser-run flow evidence is in `docs/screenshots/`; the compact revised
layout still needs root's visual verification at 1536/1366 widths.
