# Independent review: Ramp private-event prototypes (re-review of repaired heads)

This is a review-only branch. No app code was changed and no builder fixes are duplicated here. Builders and the root owner handle fixes and merges. All work stays on the private event.

| App | Branch | First review | **Repaired head reviewed** | Port |
|---|---|---|---|---|
| Cart Tetris (+ root runner) | `codex/cart-tetris` PR1 | `1090a66` | **`b09cc5a`** | 5311 |
| Budget Brawl | `codex/budget-brawl` PR2 | `32468be` | `32468be` (no repaired head pushed yet) | 5314 |
| BorrowFirst | `codex/borrowfirst` PR3 | `e2942ab` | **`ef0ad26`** | 5313 |
| Pay Me Twice | `codex/pay-me-twice` PR4 | `2ef72e2` | **`2872c2e`** | 5312 |
| ExitLane | `codex/exitlane` | — | **`31bc5d0`** | 5315 |

## Checks (Node 22.14.0, Linux)

| App | npm ci | test | typecheck | build | /api/health |
|---|---|---|---|---|---|
| Cart `b09cc5a` | ok | 46/46, plus my 2-test independent oracle = 48/48 | ok | ok | sqlite |
| Pay `2872c2e` | ok | 36/36 | ok | ok | sqlite |
| Borrow `ef0ad26` | ok | 43/43 | ok | ok | sqlite |
| Budget `32468be` | ok | 21/21 | ok | ok | sqlite |
| Exit `31bc5d0` | ok | 32/32 (`node --test`) | ok | ok | sqlite |

Static builds fall back to the "Browser sandbox" label; the console shows the expected `/api/health` 404. That 404 is the probe that triggers the fallback and is not a defect.

## Independent probes (`probes/`) on the repaired heads

- **Cart** (`cart-oracle.test.ts`): my own brute-force solver checked 600 random cases covering $0 prices, minimum orders, free-ship thresholds, volume tiers, deadlines and stock limits. All 600 match `solve()`. Order totals equal the plan total, and no allocation exceeds the deadline or stock. Junk, `__proto__` and null imports never throw.
- **Pay** (`pay3.mjs`): uploading a partial text file (invoice number and supplier only) gives `amountCents:null` and `period:""`, so no sample facts are inherited, and validate/pay return `invalid`. Escaped-paren PDF and FlateDecode PDF totals parse correctly. 20 concurrent requests gave 1 recorded and 19 duplicates. A negative amount and a 1.5¢ amount are both `invalid`.
- **Borrow** (`borrow4.mjs`): B01 is 25500 versus 67500 with 42000 avoided. A forged plan total of 1 gets 409 `PLAN_MISMATCH`, and so does a forged unknown asset. 10 parallel reserves gave one 200 and nine 409s. Reservations survive a server restart.
- **Exit** (`exit-assess.mjs`, `exithttp.mjs`, `exitstale.mjs`):
  - Fee cases: E01 gives refund 0 / avoided 20000 / extra 5000 / net 15000. E02 gives refund 15000. E09 gives net −3000, not clamped.
  - Cutoff boundaries: at the spring-forward cutoff (2025-03-09T07:00Z), 1 ms before uses the free tier and the exact instant uses the late tier. Overlapping tiers, no matching tier, an unparseable cutoff and an unsupported policy all go to `manual_review`. Floats, CAD and C≠P+U are `invalid`.
  - Seed totals: estimated refundable 55000.
  - Stale approval: after advancing the clock 2 days, only `bk-room` (whose tier changed) becomes `stale` and is skipped. The other bookings' figures are unchanged, so they still execute. That is correct.
  - Idempotency: 8 concurrent `/packet/execute` calls left one outcome per booking.
  - Export: says SIMULATED and states that confirmed ≠ received.
  - Invalid inputs: bad clock values and float amounts return 400.

## Audit items, reassessed on the repaired heads

| Item | Status |
|---|---|
| Cart: zero-price shipping and minimum orders, strict CSV/ID validation, irreversible approval, numeric ordering | Fixed. Verified by my oracle and junk-import probe; approval tests stay with the builder. |
| Root runner on Windows (`spawnSync npm`, status `null`) | Fixed in `b09cc5a`: `npm_execpath` under the current Node, then `npm.cmd` with `shell` on win32, with `r.error` reported. Not run on a real Windows host. |
| Pay: missing fields, escaped PDF totals, 2026 fixtures, mobile overflow | Fixed. 390px `scrollWidth` is 390. |
| Borrow: forced selection, server plan validation, restart persistence, confirmed-plan UI, mobile overflow | Fixed. After reserving, the panel shows Proposed $255 with Confirmed $255 (`screenshots/borrow-final-after-reserve.png`). 390px `scrollWidth` is 390. |
| Budget: holds swept only on GET, Windows test teardown, "Prevented" counting pending requests | **Not reassessed.** No repaired head had been pushed when this was written. |

## Remaining findings (P1: none)

**P2**
1. **ExitLane: results don't fit in 1536×1024.** The page is 1650px tall. The content is centered at about 1120px wide, while the concept uses the full width. Only Room, Catering and part of Equipment show above the fold; Shuttle, Decor, Provider confirmations and Policy evidence are below it (`screenshots/exit-1536.png` vs `exitlane-concept.png`). Fix: widen the container to about 1460px, put the timezone select on the control row, and tighten table row padding.
2. **ExitLane: confusing summary after execution.** Repro: Cancel → Review packet → Approve → Execute. "Estimated refundable" drops to **$0** while "Refunds due (estimated)" shows $550, and the "Provider-confirmed cancellations" value reads "recorded below" (`screenshots/exit-mobile.png`). A viewer reads $0 as "nothing recovered". Fix: keep $550 with a "now confirmed → due" label, and show the confirmed count as a number.
3. **ExitLane: the `/packet/execute` response silently omits stale bookings.** After the clock advance, the result lists 3 bookings, and `bk-room` (stale) is missing instead of being reported as `refused: stale`. The UI or API consumer cannot tell "skipped" from "not in packet". Fix: return stale and excluded entries with a reason.
4. **Root runner: `runStart` removes items from `list` while iterating it.** In `scripts/run-apps.mjs`, `list.splice(list.indexOf(slug), 1)` inside `for (const slug of list)` makes the next app skip its dist check. If app A fails to build, app B is started without a build. I reproduced the skip semantics in Node. Fix: iterate over a copy, or filter after the loop.

**P3**
- **Pay:** the API accepts any 3-letter currency. `POST /api/pay` with `currency:"XXX"` returns `recorded`. The UI offers only USD/EUR/GBP. Restrict the allowlist on the server.
- **Pay:** the billing-period date input is truncated at 1536 ("September 2⌷") next to "Not stated".
- **Cart:** with a 1-day deadline the result reads "$0.00 less" with no explanation. Add "Only QuickBox delivers in 1 day".

## Fit at 1536×1024 (result above the fold)

- **Cart:** savings card bottom at about 650px; Approve/Export at about 880px. Fits.
- **Pay:** verdict, ledger header and first ledger rows fit (ledger table header at y≈837).
- **Borrow:** proposed solution, "Potential spending avoided" and Confirm all fit (Confirm bottom ≈645).
- **Budget** (unrepaired head): totals, prevented line and agent cards fit.
- **Exit:** does not fit (see P2-1).

## Probe usage
The scripts assume local servers on 5311–5315. Python probes drive system Chrome through Playwright. The `.mjs` probes need Node ≥ 22.
