# Independent review: Ramp private-event prototypes

This is a review-only branch. No app code was changed. Builders and the root owner make all fixes and merges.

| App | Branch / PR | Commit reviewed | Port |
|---|---|---|---|
| Cart Tetris | `codex/cart-tetris` / PR1 | `1090a66` | 5311 |
| Budget Brawl | `codex/budget-brawl` / PR2 | `32468be` | 5314 |
| BorrowFirst | `codex/borrowfirst` / PR3 | `e2942ab` | 5313 |
| Pay Me Twice | `codex/pay-me-twice` / PR4 | `2ef72e2` | 5312 |
| ExitLane | `codex/exitlane` | **Not reviewed: the branch was not on origin when this was written** | 5315 |

## Checks run (Linux, Node 22.23.3; `npm test` also run on Node 22.14.0)

| App | npm ci | test | build | typecheck | /api/health | static build (no backend) |
|---|---|---|---|---|---|---|
| Cart Tetris | ok | 27/27 (includes a 150-case brute-force oracle) | ok | ok | ok | ok: labeled "Browser sandbox" |
| Budget Brawl | ok | 21/21 | ok | ok | ok | ok |
| BorrowFirst | ok | 22/22 (includes worker-thread SQLite races) | ok | ok | ok | ok |
| Pay Me Twice | ok | 29/29 | ok | ok | ok | ok |

In static mode the browser console logs one 404 for `/api/health`. This is expected: the failed probe is how the app falls back to the honest "Browser sandbox" label.

## Independent adversarial probes (scripts in `probes/`, run against the SQLite servers)

- **Budget Brawl:** I sent 20 concurrent $60 requests against a $100 budget. Exactly one held funds and the rest went to `awaiting_approval` with `fundsHeld:false`. Approving a request with no funds behind it returned `awaiting_funds`, with totals reserved 6000 and available 4000, so there was no overspend. Claimed prices are ignored in favor of the catalog price. Invalid quantities are rejected. A double cancel releases funds only once. A commit/cancel race ends with a single terminal winner.
- **Pay Me Twice:** 20 concurrent requests with the same identity gave 1 `recorded` and 19 `duplicate`. A replay returned `replayed` with no new ledger row. The real next-period bill was `recorded`. A changed invoice number with no billing period went to `review` and was not paid.
- **BorrowFirst:** I sent 10 parallel `/api/reserve` calls for the same B01 plan (M-101 + M-204). Results were one 200 and nine 409, leaving exactly 2 active reservations. The seed plan is 25500 versus a 67500 baseline, so potential avoided spending is 42000, which matches B01.
- **Cart Tetris (UI):** The seed plan matches the spec: $81.50 versus $101.00, $19.50 less. With a 1-day deadline Bulk Club is excluded, giving $101.00 versus $101.00 and "$0.00 less". Changing the deadline or a quantity shows "Inputs changed", voids the approval and disables export. The exported JSON includes the disclaimer and assumptions.

## Concept vs. render at 1536×1024

All four apps follow their concept's composition: header, hook headline, a three-column workflow (or input plus table) and the result panel. They also apply the contract's required corrections: Cart arithmetic is fixed, BorrowFirst's invented People/Reports navigation is removed, and the sandbox labels are honest. The concept shows Budget Brawl after launch ($60 reserved / $40 available); the fresh app starts at $0 / $100 and reaches the concept state after one "Launch" click (`screenshots/budget-sqlite-1-launch.png`). I don't count that as a defect.

## P1 defects

None found in PR1–PR4.

## P2 defects

1. **Pay Me Twice: horizontal overflow at 390px.** Repro: open `:5312/` at a 390×844 viewport. `document.scrollWidth` is 437. The overflowing element is `section.card.details-card`: the `@media` rule keeps `.fields { grid-template-columns: 1fr 1fr }` and the inputs don't shrink. Screenshot: `screenshots/overflow-pay.png`. Fix: use a single column at ≤480px, or add `min-width:0` to `.field`. On mobile the ledger table also wraps invoice numbers mid-token.
2. **BorrowFirst: horizontal overflow at 390px.** Repro: open `:5313/` at 390×844. `scrollWidth` is 501. `.header-right` (mode chip and Reset) is pushed past the viewport because nav, logo and chip share one row. Screenshot: `screenshots/overflow-borrow.png`. Fix: let the header wrap onto two rows on mobile. The inventory table already scrolls inside its own card.
3. **BorrowFirst: contradictory totals after "Confirm and reserve".** Repro: Reset → mark M-204 owner-confirmed → Find (proposed $255, avoided $420) → Confirm and reserve. The plan is then recomputed against the inventory that was just reserved. Panel 2 switches to "New monitor purchase × 3", and panel 3 shows "All new purchase $675 / Proposed solution $675" directly above "Confirmed purchasing plan · $255.00" (`screenshots/borrow-sqlite-5-reserved.png`). A viewer at the 30-second mark sees $675 and $255 at the same time. Fix: after a successful reserve, freeze panels 2–3 on the confirmed plan until inputs change.
4. **Budget Brawl: "Prevented over-budget requests" counts requests that are still pending.** Repro: Reset → Launch simultaneous requests. The banner reads "Prevented over-budget requests: 1 — $60", but Ben's card says "Pending approval; no funds held". `shared/engine.mjs` counts `awaiting_approval && !fundsHeld` and `awaiting_funds` as prevented. If budget is raised and Ben is approved, the request succeeds, so the count claims a prevention that may not hold. Fix: count only terminal `denied/insufficient_funds`, or relabel the line to "Blocked from reserving (pending funds)".
5. **Root runner is not cross-platform** (`scripts/run-apps.mjs` on `codex/cart-tetris`). `spawnSync('npm', …)` returns `status: null` with ENOENT on Windows, and `r.status !== 0` then counts every app as failed. Fix: use `process.platform === 'win32' ? 'npm.cmd' : 'npm'` together with `shell: true` (needed on Node ≥ 20.12 for `.cmd`), and print `r.error` when it is set.

## Highest-value polish (not defects)

- **Cart:** with a 1-day deadline the result says "$0.00 less". Add a line explaining why, e.g. "Only QuickBox delivers in 1 day; splitting saves nothing". That is the trade-off the deadline is meant to teach.
- **Pay:** sandbox ledger rows created now are stamped "Sep 3, 2024…". Mark this as a demo clock so it doesn't read as a bug. Put the "N duplicates blocked" stat at the top of the right panel; it is the 30-second takeaway.
- **BorrowFirst:** the "Potential spending avoided $420" card is the key message. Keep it visible after reserving, in the confirmed state (see P2-3).
- **Budget:** make the first view resemble the concept, e.g. a pulsing "▶ Launch simultaneous requests" call to action above the fold so viewers press it first.

## ExitLane

`codex/exitlane` was not on origin (checked with `git ls-remote`). Its review is still owed. The E01–E14 checks to run once it lands: E01 shows net $150, E02 refunds $150, the sample refundable total is 55000, the exact UTC cutoff displays correctly in America/Toronto across DST, negative net benefit stays visible, and duplicate execution and provider failure are idempotent.
