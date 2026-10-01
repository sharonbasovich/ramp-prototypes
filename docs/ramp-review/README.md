# Independent review: Ramp private-event prototypes (re-review of repaired heads)

This is a review-only branch. No app code was changed and no builder fixes are duplicated here. Builders and the root owner handle fixes and merges. All work stays on the private event.

| App | Branch | First review | **Repaired head reviewed** | Port |
|---|---|---|---|---|
| Cart Tetris (+ root runner) | `codex/cart-tetris` PR1 | `1090a66` | **`eb0122d`** | 5311 |
| Budget Brawl | `codex/budget-brawl` PR2 | `32468be` | **`0e5e7b7`** | 5314 |
| BorrowFirst | `codex/borrowfirst` PR3 | `e2942ab` | **`df48f9e`** | 5313 |
| Pay Me Twice | `codex/pay-me-twice` PR4 | `2ef72e2` | **`a0b08c7`** | 5312 |
| ExitLane | `codex/exitlane` PR6 | — | **`7fd9f56`** (final repair) | 5315 |

## Checks (Node 22.14.0, Linux)

| App | npm ci | test | typecheck | build | /api/health |
|---|---|---|---|---|---|
| Cart `eb0122d` | ok | 50/50 including my 2-test independent oracle | ok | ok | sqlite |
| Pay `a0b08c7` | ok | 41/41 | ok | ok | sqlite |
| Borrow `df48f9e` | ok | 47/47 | ok | ok | sqlite |
| Budget `0e5e7b7` | ok | 35/35 | ok | ok | sqlite |
| Exit `7fd9f56` | ok | 40/40 (`node --test`) | ok | ok | sqlite |

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
| Root runner on Windows (`spawnSync npm`, status `null`) | Fixed in `b09cc5a`/`eb0122d`: `npm_execpath` under the current Node, then `npm.cmd` with `shell` on win32, with `r.error` reported. Not run on a real Windows host. |
| Pay: missing fields, escaped PDF totals, 2026 fixtures, mobile overflow | Fixed. 390px `scrollWidth` is 390. |
| Borrow: forced selection, server plan validation, restart persistence, confirmed-plan UI, mobile overflow | Fixed. After reserving, the panel shows Proposed $255 with Confirmed $255 (`screenshots/borrow-final-after-reserve.png`). 390px `scrollWidth` is 390. |
| Budget: holds swept only on GET, "Prevented" counting pending requests, command epochs | Fixed in `0e5e7b7`. `sweepExpired` now also runs inside place/approve/commit/cancel. With `quoteTtlMs:1000`, approving after 1.6 s with no GET in between returns `expired` and the next request reserves the released funds (`probes/budget4.mjs`). The headline now reads "Denied for budget: 0 · Pending approval or funds: 2". A stale `epoch` is rejected with `stale_epoch`. 20 concurrent requests left reserved 6000 of 10000, so the invariant holds. Windows test teardown is not run on a real Windows host. |

## ExitLane final head `7fd9f56` (`probes/exit-final.mjs`, `exitui2.py`, `exitcorrupt.py`)
- **Fee math and cutoffs:** E01, E02 and E09, the DST cutoff, the stale room after the clock moves, and the 8× concurrent execute all re-pass.
- **Skipped entries:** `/packet/execute` now returns stale and excluded entries with `skipped:true` and a reason, e.g. `bk-room: stale (clock_moved)` and `bk-decor: excluded: manual_review`.
- **Failed provider retry past cutoff:** retrying `bk-equipment` 2 days later executes once, and a repeat returns `replayed:true`. Equipment's assessment doesn't change across that window (100% fee), so the retry is legitimately not stale.
- **Invalid paid amount:** editing `paidMinor` above committed makes `bk-catering` `excluded` at prepare, and approve covers only the remaining 4 valid entries. A negative unpaid amount returns 400.
- **Reset replay:** after reset, requests and outcomes are empty, and an old-epoch request ID returns 404 `not_found`. New IDs carry an `-e<epoch>` suffix with no collision.
- **Corrupt browser storage:** with `exitlane:v1` set to `{garbage`, a wrong-shape JSON value, or `null`, a reload of the static build falls back to fresh fixtures ($550, browser-sandbox label) with no page errors.
- **Lifecycle counts:** after execution, the summary reads "Refundable if canceled now $0 — reviewed bookings already confirmed", "Approved packet estimate $550", and "3 confirmed, 1 failed".
- **Layout:** 1536 initial scrollHeight is 1196 (was 1650). The summary and all five booking rows are above the fold. Only the policy footnote, Provider confirmations and the Activity log are partly below it. At 390, `scrollWidth` is 390.
- **Windows cleanup:** not run on a real Windows host.

## Remaining findings (P1: none, P2: none open)

**P2**
ExitLane P2s 1–3 at `31bc5d0` (fit at 1536, $0 headline after execute, silently omitted stale entries) are resolved at `7fd9f56` (see above). Root runner P2 4 is resolved at `eb0122d`.

**P3**
- **Budget** (`0e5e7b7`): the agent status cards come from local `lane.last` state. After a reload or in a second tab they read "Idle — No request sent yet" even though the timeline shows the same requests awaiting approval (`screenshots/budget-final-390.png`). Fix: derive each card from the latest snapshot request per agent. On mobile the timeline table scrolls inside its card (page `scrollWidth` is 390), and its rows have large blank gaps.
- **Pay** (still present at `a0b08c7`): a missing currency is now rejected, but the API still accepts any 3-letter code — `POST /api/pay` with `currency:"XXX"` returns `recorded`. The UI offers only USD/EUR/GBP. Restrict the allowlist on the server.
- **Pay:** the billing-period date input is truncated at 1536 ("September 2⌷") next to "Not stated".
- **Cart:** with a 1-day deadline the result reads "$0.00 less" with no explanation. Add "Only QuickBox delivers in 1 day".

## Fit at 1536×1024 (result above the fold)

- **Cart:** savings card bottom at about 650px; Approve/Export at about 880px. Fits.
- **Pay:** verdict, ledger header and first ledger rows fit (ledger table header at y≈837).
- **Borrow:** proposed solution, "Potential spending avoided" and Confirm all fit (Confirm bottom ≈645).
- **Budget** (`0e5e7b7`): after launch, the whole page including the timeline and its Approve/Reject actions fits in 1024 (scrollHeight 1024). At 390px `scrollWidth` is 390 and no element extends past the right edge (`screenshots/budget-final-1536.png`, `budget-final-390.png`).
- **Exit** (`7fd9f56`): mostly fits (1196px tall). See above.

## Expected root CSS-only final polish (reported by root; not yet verified by this review)
- Budget: `max-width: 1500px` to match the concept width.
- Pay: month input `min-width: 150px` plus flex-wrap, so the full month and year show without clipping (resolves the Pay P3 truncation).

## Probe usage
The scripts assume local servers on 5311–5315. Python probes drive system Chrome through Playwright. The `.mjs` probes need Node ≥ 22.
