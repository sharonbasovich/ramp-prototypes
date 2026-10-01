# Independent BorrowFirst / ExitLane audit

Audit date: October 1, 2026. No implementation files were edited. Browser automation and online hackathon projects were not touched.

## BorrowFirst scope and environment

- Checkout: `C:/Users/Sharon/Documents/ChatGPT/hackthenorth/output/ramp-review-borrow`
- Reviewed commit: `e2942ab161d5e8ef0e8b186486e398f44d192c41`
- App: `apps/borrowfirst`
- Runtime: Node **22.14.0**, Windows PowerShell
- Reference: `output/ramp-handoff/SPEC-BORROW-EXIT.md`
- Local API audit ran on isolated port **15313**, not the root integration server on 5313. A separate two-launch persistence test used 15314 and a temporary database.
- Independent probes called the compiled production engine/store and real HTTP API. React's server renderer verified the post-reservation review output. This is not a claim of visual browser or accessibility verification.

## Verification results

| Check | Result |
| --- | --- |
| `npm ci` | Passed; installed 158 packages |
| `npm run build` | Passed; server TypeScript and Vite production output built |
| `npm run typecheck` | Passed for client and server |
| `npm test` | **Failed exit status**: all 22 assertions passed, but the reservation suite's `afterAll` failed with Windows `EBUSY` while unlinking `test.db` |
| `npm audit --omit=dev --json` | Zero production dependency advisories reported |
| Full dependency install audit | Reported three development dependency advisories; not used here to infer a production exposure |

The default request calculates the independently expected CAD amounts: baseline **$675**, proposed **$255**, potential spending avoided **$420**, two assets (`M-101`, `M-204`) and one new purchase. It correctly remains conditional until the simulated M-204 owner confirmation.

## Required fixes

### BF-01 — P1: Successful reservation replaces the reviewed allocation on screen

**Source:** `src/App.tsx:140`, `src/App.tsx:251`, `src/App.tsx:261`; `src/components/ReviewPanel.tsx:60`.

`reserve()` saves the confirmed plan but also replaces `world`. The allocation effect immediately replans the same request against the now-reserved inventory. The allocation and review panels receive this new plan rather than the frozen confirmed plan.

**Reproduction:** Reset, confirm M-204, then reserve the default three-monitor plan. Its original cost is $255. After the successful reservation, recomputation yields an all-new $675 plan. Rendering the actual review component with the same resulting state produces:

> Proposed solution $675.00 / 3 × new monitors $675.00 / Confirmed purchasing plan · $255.00 / 2 assets reserved.

**Impact:** The primary demo's successful final state contradicts itself and changes the visible shopping list. Export already uses `confirmed?.plan` and remains correct.

**Fix expectation:** Preserve the frozen confirmed allocation and its costs throughout the completed flow. Introduce an explicit new-request/recalculate action to start another allocation. Do not silently display a second purchasing plan while showing the original reservation as its confirmation.

### BF-02 — P1: The “Use” override is ignored or yields a nonminimal plan

**Source:** `src/engine/allocate.ts:273` and `src/engine/allocate.ts:275`; `src/App.tsx` `useAsset()`.

The search bounds `k` by `pool.length`, excluding forced assets from the maximum. It also considers `k=0` and subsets that contain fewer than all forced assets. These are not valid candidates when an asset has explicitly been forced into a plan.

**Independent reproductions using unchanged fixtures:**

1. `allocate({...defaultRequest(), quantity:1}, world, DEMO_NOW, {includeAssetIds:['M-102']})` returns **no transfers** and one $225 purchase despite the UI saying M-102 was forced into the plan.
2. Default quantity three with only M-102 forced returns M-102 plus M-101 and one purchase, cost **$490**. A valid forced plan using M-102 + M-101 + M-204 costs **$280**.
3. Force all three eligible assets M-101, M-102 and M-204: the result becomes three new purchases at **$675**, with no selected assets.

**Fix expectation:** Enforce every valid forced asset, reject impossible forced constraints explicitly, and search from the number of forced assets through `min(quantity, forced.length + pool.length)`. Add tests for one, several, all, and too many forced assets. Reconcile the “exact minimum-cost” claim with the supported override constraints.

### BF-03 — P1: ISO-offset holds expire at the wrong time

**Source:** `src/engine/store.ts:234`; `server/index.mjs:110` accepts arbitrary `expiresAt` strings.

SQLite expiry sweeping compares timestamp **text** using `expires_at <= ?`, while the eligibility engine correctly uses `Date.parse`. Different offsets therefore disagree about whether a hold is active.

At demo now `2026-09-30T18:00:00.000Z`:

- A hold expiring `2026-09-30T16:00:00-04:00` really expires at **20:00Z**, two hours in the future. The store marks it expired and allows another request to reserve M-101.
- A hold expiring `2026-09-30T19:00:00+02:00` really expired at **17:00Z**, one hour earlier. The sweep leaves it active, and the unique index rejects a new reservation.

Both outcomes were reproduced against the actual compiled SQLite store. UTC-`Z` fixture hold tests pass; they do not cover these cases.

**Fix expectation:** Validate and normalize incoming instants to a canonical UTC representation, or compare stored numeric epoch values. Use the same time semantics for eligibility and the database sweep. Reject invalid expiry dates. Add both offset cases to the store and API tests.

### BF-04 — P1: The destination control does not influence transfers

**Source:** `src/components/RequestPanel.tsx` destination selector; `src/engine/types.ts` `TransferOption`; `src/engine/allocate.ts` `evaluateInventory()`.

The UI permits Waterloo, Kitchener and Toronto destinations. Transfer options are keyed only by asset ID; they contain no destination. The allocator never reads `request.destinationLocationId` when establishing eligibility, price or arrival.

**Reproduction:** Allocate the default request, then change only `destinationLocationId` to `loc-toronto`. Transfer asset IDs, costs and arrival instants remain byte-for-byte identical. The export simply changes the destination label. Fixture comments identify those prices/arrivals as routes to Waterloo, so they cannot substantiate the Toronto plan.

**Fix expectation:** Either constrain this MVP to the supported Waterloo destination and say so, or introduce destination-specific route records and select a feasible route for each origin/destination pair. Do not let a control imply a decision the engine does not make.

### BF-05 — P1: Reservation validation accepts incomplete or fabricated plans

**Source:** `server/index.mjs:97`; `src/engine/store.ts:238`; `src/engine/allocate.ts:378`.

The endpoint trusts client plan shape, quantities, totals and completion status. `validateReservation()` checks existing transfer/quote lines but never checks that those lines fulfill the request, that request and plan agree, or that reviewed prices/counts match current authoritative data. The separate `request` argument primarily supplies the reservation request ID.

**Actual API reproductions:**

1. Request three monitors by tomorrow. `/api/allocate` correctly returns `status:'partial'`, shortage one, two transfers and no purchases. POST that unmodified result to `/api/reserve`: **HTTP 200**, two confirmed reservations. The UI disables this action, but the authoritative reservation boundary does not reject it.
2. Start with a valid one-monitor plan; set transfers and purchases to `[]`, status to `ok`, shortage and cost to zero. Submit it alongside a three-monitor request: **HTTP 200**, zero reservations.

**Fix expectation:** Validate input shape, request-plan equality, positive integer quantities, duplicate asset IDs, completeness, current prices/capacities, and required version snapshots inside the transaction. Prefer recomputing an authoritative plan or retaining a reviewed plan snapshot server-side. A failed integrity check must leave no reservation rows.

### BF-06 — P2: Financial comparison drift survives reservation review

**Source:** `src/engine/allocate.ts:348` and its quote validation loop; `src/engine/store.ts:238`.

Only purchased quote IDs are snapshotted and revalidated, so an all-internal plan's all-new baseline can expire unnoticed. Transfer prices are also neither versioned nor compared to the reviewed line costs.

**Independent reproductions:**

- Set the new quote expiry to `2026-09-30T18:00:01Z`. Review one internal monitor at `18:00:00Z`: baseline $225, proposed $15, potential reduction $210. At `18:00:02Z`, a fresh allocation has **no valid baseline**, but reserving the old plan still succeeds and retains its old comparison.
- Review the confirmed-ready default $255 plan, then update M-101's transfer cost in the temporary SQLite database from 1,500 to 150,000 cents without changing the asset. The old plan still reserves successfully at its reviewed $255 total. This demonstrates that transfer price changes have no revalidation mechanism.

**Fix expectation:** Snapshot/revalidate all evidence supporting the displayed comparison, including baseline quotes and transfer routes. Reprice or invalidate stale comparisons before presenting the plan as confirmed. Do not require an unrelated asset-version change to notice a transfer-price change.

### BF-07 — P2: Configured disk persistence is reset on every server launch

**Source:** `server/index.mjs:24`; README run section.

The README honestly documents an in-memory default, but separately promises that `BORROWFIRST_DB=/path/to/file.db` persists the database. Startup always calls `store.reset(seed)`, destroying saved reservations, owner confirmations and imports even with that file configured.

**Independent two-launch test:** Start server on 15314 with a fresh temporary `BORROWFIRST_DB`; confirm M-204 and reserve M-101; stop; restart using the exact same database. Before restart: **one reservation** and non-null M-204 confirmation. After restart: **zero reservations** and null confirmation.

**Fix expectation:** For the requested useful restart behavior, default to a durable app-specific database and initialize fixtures only when the schema has no seeded data. Keep explicit `/api/reset` as the intentional fixture restoration path. Explain what reset deletes. Test refresh, process restart and explicit reset independently; a file path alone is not evidence of persistence.

### BF-08 — P2: Browser storage errors silently discard every change

**Source:** `src/backend/sandbox.ts:27` and `src/backend/sandbox.ts:42`.

`persist()` swallows a storage failure with a comment saying it will keep running in memory, but no memory copy exists. Each later `load()` creates fresh fixtures when storage is blocked or quota-limited.

**Independent reproduction:** Run the actual bundled `SandboxStore` with a storage shim where reads return null and writes throw. Call `load()`, then `ownerConfirm('M-204')`, then `load()`. M-204 still has **null confirmation** and **version 1**. The mandatory confirmation-and-reservation flow cannot complete.

**Fix expectation:** Retain an in-memory world when persistence fails and clearly label it session-only. Do not silently turn successful actions into resets. Add a storage-failure test that completes confirmation, reservation and export.

### BF-09 — P2: Windows reservation test teardown never closes databases

**Source:** `tests/reserve.test.ts:22` and store/worker creation throughout that file.

Test stores and the final inspection connection remain open when `afterAll` recursively removes their directories. On Windows this produces `EBUSY: resource busy or locked, unlink .../test.db` and causes `npm test` to exit unsuccessfully despite all 22 assertions passing.

**Fix expectation:** Close every store connection in teardown, close worker connections before posting completion, and await worker exit before cleanup. Keep the concurrency test; do not replace the database cleanup error with an ignored failure.

## Passing independent checks and matrix coverage

| Matrix area | Evidence and limits |
| --- | --- |
| B01 | Independent production-engine arithmetic exactly matches 67,500 / 25,500 / 42,000 cents |
| B02–B03 | Existing production-engine regression tests pass for missing USB-C and a free spare arriving one minute late; source uses requirement attributes rather than names |
| B04 | Independent actual HTTP race returned `[200,409]`; database contained exactly one confirmed M-101 reservation. Existing separate-worker SQLite race assertion also passed |
| B05 | Existing real-store assertion passes: losing one selected asset rejects the remaining plan without partial rows |
| B06 | Independent actual API test increments an asset version after review and receives 409 `STALE_ASSET`; existing damaged-asset assertion passes |
| B07 | UTC fixture cases pass; non-UTC-offset hold cases fail as BF-03 describes |
| B08 | Existing expired-quote allocation test passes; baseline-only expiry at reservation fails as BF-06 describes |
| B09 | Existing exact five-unit mixed-plan assertion passes with unique assets and correct quantity |
| B10 | Independent actual API test with a USD transfer in a CAD plan receives 409 `CURRENCY_MISMATCH`; initial foreign-quote exclusion test passes |
| B11 | Independent actual API reserve before owner confirmation receives 409 `UNCONFIRMED_ASSET`. Confirming owner, reallocating, and reserving returns 200 with M-101 and M-204 |
| B12 | Existing infeasible-all-new/feasible-internal assertion passes and reports no numeric savings claim |
| B13 | Independent offline backend detection returns persistent label `Browser sandbox`; its detail expressly says no server, no cross-device or multi-user atomicity. Source renders the mode in header/footer. No real-browser multi-tab visual verification claimed |
| B14 | Existing reset/export assertions pass; export uses the frozen confirmed plan. Screen fidelity after reservation fails as BF-01 describes |
| Q01–Q06 | Source and offline adapter checks support an API-free sandbox flow with normal storage; storage failure breaks it. Fonts are bundled locally. Root still needs visual/keyboard/narrow-layout and deployed-base-path browser checks |

## Additional low-priority observations

- `src/engine/export.ts:137` formats every CSV monetary field with `CAD`, even if `doc.request.currency` is USD. The current normal UI is CAD-only, but the public types and engine permit USD worlds. Fix or explicitly constrain supported export currency before claiming multi-currency support.
- “USB-C power delivery” is a UI label while compatibility records only a `USB-C` port token. A USB-C connector does not prove power-delivery capability. Model that requirement explicitly or shorten the supported claim to USB-C port.
- The `/api/hold` endpoint neither validates parseable expiry timestamps nor returns a dedicated conflict when its insertion hits an active reservation. The expiry normalization repair should include its boundary behavior.

## ExitLane

ExitLane implementation checkout has not yet been supplied. **Not audited yet.** The acceptance matrix in `SPEC-BORROW-EXIT.md` remains the reference; no ExitLane test or completion claim is made here.
