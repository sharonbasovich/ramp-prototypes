# ExitLane

**The off-site was canceled. The bills weren't.**

ExitLane is a deterministic sandbox for recovering money from bookings linked to a
canceled event. A shared policy engine evaluates structured cancellation terms
against a labeled **demonstration clock**, builds a reviewable cancellation
packet, and executes it against **scripted sandbox providers** — idempotently,
with stale-approval invalidation. Nothing real is ever canceled, emailed, or
refunded.

## Run it

```bash
cd apps/exitlane
npm ci          # install (generates node_modules from package-lock.json)
npm start       # SQLite backend + static app on http://localhost:5315
```

Open **http://localhost:5315/ramp-prototypes/exitlane/** — the backend badge in
the header reads `SQLite backend sandbox` when `/api/health` answers
`{ engine: "sqlite" }`. If the server is unreachable (e.g. the static GitHub
Pages build), the app falls back to an in-browser store, the badge honestly
reads `Browser sandbox — this tab only`, and state persists to `localStorage`
for that tab only.

Other scripts:

```bash
npm test        # node:test — engine unit tests + full HTTP acceptance suite
npm run typecheck   # tsc --noEmit (strict)
npm run build   # vite build -> dist/ (Pages-ready, base /ramp-prototypes/exitlane/)
npm run dev     # vite dev server (frontend only, browser-sandbox mode)
```

## Modes

| Mode | Backend | Store | Scope | Badge |
| --- | --- | --- | --- | --- |
| Local backend | `server/index.mjs` + `server/sqlstore.mjs` | `node:sqlite` (`EXITLANE_DB`, default `apps/exitlane/.data/exitlane.db`) | Shared by every client of that server; `BEGIN IMMEDIATE` transactions serialize ops | `SQLite backend sandbox` |
| Static Pages | none | `shared/memstore.mjs` + `localStorage` | **This tab only** — no cross-tab coordination claimed | `Browser sandbox — this tab only` |

Both modes run the exact same `shared/engine.mjs` + `shared/seed.mjs`, so
behavior is identical; only the durability and coordination scope differ.

## The demo clock

All deadlines are true UTC instants (`…T16:00:00Z`); the UI displays them in
America/Toronto. The demo clock is a stored value, never the wall clock —
`+1h`, `+1d`, and `Past room cutoff` buttons (or direct datetime entry) move it
deterministically across policy cutoffs. Moving the clock across a boundary
re-tiers every assessment and **marks affected approvals stale** before any
provider call could occur.

## Money model (exact, integer cents)

For each booking `C = P + U` is required (committed = paid + unpaid). For a
matched tier with cancellation fee `F`:

- estimated refund `= max(P − F, 0)` — labeled *estimated recoverable cash*
- extra payment `= max(F − P, 0)`
- future charges avoided `= U` — labeled separately, never added to "cash back"
- net benefit `= refund + U − extra = C − F` — **negative values preserved**

The summary keeps the lifecycle self-explanatory: **remaining potential**
(`Refundable if canceled now` — still-active assessed bookings only), **approved
packet estimate** (the figure bound at approval, preserved after execution),
**refunds due** (approved minus marked-received — never double-counted), and
**refunds received** (marked explicitly, counts once). Simulated cancellations
are counted numerically (confirmed / queued / failed), never as a vague count.
`POST /api/packet/execute` reports every request — skipped entries carry a
reason distinguishing refused-stale from never-in-packet exclusions.

## Policy engine

`shared/engine.mjs` assesses each booking: booking financials are validated
(`C = P + U`, non-negative integers, USD only → `invalid`), then the policy's
tiers are matched at the demo-clock instant. `before` applies when
`now < cutoffInstant`, `at_or_after` when `now >= cutoffInstant`, `always`
only as a sole tier. **Exactly one** tier must match — zero or two is
`manual_review` (absent policy, unreadable/`supported:false` terms, or
contradictory structure). The engine never invents a refund.

Approvals bind a fingerprint of booking version + policy version + every
assessed figure. Any change — clock crossing a cutoff, edited amounts —
invalidates the approval *before* execution; executing a stale request returns
`stale` and no provider call is made. The same revalidation runs on every
execution path — including retries of `failed` requests — so a failed attempt
followed by a change requires fresh review before the provider is contacted.
Approval itself re-assesses the packet: a booking whose arithmetic broke since
`prepare` is rejected (`excluded`/`invalid`), never confirmed.

Sandbox providers consume scripted outcomes (`fail:<code>:<detail>` entries
simulate outages). Executed requests are replayed by idempotency key — the same
key can never cancel twice, and retries append attempt history.

Request identity is epoch-scoped (`req-<bookingId>-e<epoch>`). A reset mints
new ids, so a requestId captured before a reset can never execute a request in
a later demo epoch — it resolves to nothing (HTTP 404).

Browser persistence is schema-validated: `localStorage` payloads that parse
but don't match the store shape (e.g. `{bookings:null}`) are rejected and the
tab starts from a fresh seed rather than crashing on render.

## API (local backend)

| Route | Purpose |
| --- | --- |
| `GET /api/health` | `{ ok, engine:"sqlite", mode, epoch }` |
| `GET /api/state` | full snapshot: clock, event, bookings + assessment + request + outcomes, totals, timeline, activity log |
| `POST /api/reset` | `{config?}` re-seed (epoch bump — old approvals invalidated; old request ids die) |
| `POST /api/clock` | `{instant}` move the demo clock; marks stale approvals |
| `POST /api/event/cancel` | mark the event canceled |
| `POST /api/packet/prepare` | assemble packet: `prepared` / `excluded` per booking |
| `POST /api/packet/approve` | approve executable requests (binds fingerprints) |
| `POST /api/packet/execute` | execute all approved requests |
| `POST /api/requests/:id/execute` | execute one (also the retry path for `failed`) |
| `POST /api/requests/:id/refund-received` | mark simulated refund received (idempotent) |
| `POST /api/bookings/amounts` | `{bookingId, committedMinor?, paidMinor?, unpaidMinor?}` — bumps version, stale-marks approval |
| `GET /api/packet/export` | downloadable JSON cancellation packet |

Static files are served with SPA fallback under `/ramp-prototypes/exitlane/`
(prefix stripped); the same `dist/` deploys verbatim to GitHub Pages in
browser-sandbox mode.

## Fixture

Default demo data: the Fri Apr 25 2025 off-site, demo clock 10:00 AM Toronto
(`2025-04-25T14:00:00Z`), five bookings. At the default clock the
**estimated refundable total is exactly 55,000 cents** ($400 room + $150
catering); the shuttle demonstrates avoided future charges ($140 unpaid, $60
fee → $120 net benefit with $0 cash refund); the decor booking has an
unreadable policy → manual review. Everything is labeled sample data.

## Acceptance evidence

`npm test` covers, through the production engine and HTTP API: exact cutoff
boundaries (`now < cutoff`, one second each side), DST spring-forward evaluation
on the instant (EST→EDT), unknown/absent/contradictory policies → manual
review, negative net benefit preserved, `C ≠ P + U` and non-USD rejected,
pre-canceled exclusion, approve→clock-move→stale execution refusal, provider
failure leaves booking active, idempotent replay + retry attempt history,
concurrent double-execution single-outcome, export state separation,
received-refund-once, epoch-scoped request identity (dead-epoch ids 404),
approval rejection of invalidated assessments (engine + HTTP), failed-retry
approval revalidation (engine + HTTP), and malformed `localStorage` payload
recovery. See `tests/engine.test.mjs` and `tests/acceptance.test.mjs`.

## Scope and limitations

- **No real cancellation, email, or API keys.** Provider outcomes are scripted
  samples (`fail:…` entries simulate outages); every outcome is labeled
  `SIMULATED`.
- Browser sandbox is single-tab — it does not claim cross-client atomicity.
- Amounts are integer USD cents only; no currency conversion.
- "Estimated" figures assume each structured policy is the complete remaining
  obligation; unsupported terms route to manual review instead of guessing.
