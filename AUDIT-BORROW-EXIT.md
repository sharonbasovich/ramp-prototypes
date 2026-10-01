# Independent BorrowFirst / ExitLane audit

Audit date: October 1, 2026. No implementation files were edited. Browser automation and online hackathon projects were not touched.

## Current status after independent re-audit

The original reviews below are historical evidence at Borrow `e2942ab`/`ef0ad26` and Exit `31bc5d0`. Final re-audits at **Borrow `df48f9e`** and **Exit `7fd9f56`** verify all listed findings repaired: builds/typechecks, **47 Borrow tests / 40 Exit tests**, and every retained original/new independent probe pass. **No current blocking engine/API finding remains in either app.** Full exact repros and observations are retained in this directory; see the dated final gate sections. Root's real-browser testing is separate from this read-only engine/API audit.

## BorrowFirst scope and environment

- Checkout: `C:/Users/Sharon/Documents/ChatGPT/hackthenorth/output/ramp-review-borrow`
- Reviewed commit: `e2942ab161d5e8ef0e8b186486e398f44d192c41`
- App: `apps/borrowfirst`
- Runtime: Node **22.14.0**, Windows PowerShell
- Reference: `output/ramp-handoff/SPEC-BORROW-EXIT.md`
- Local API audit ran on isolated port **15313**, not the root integration server on 5313. A separate two-launch persistence test used 15314 and a temporary database.
- Independent probes called the compiled production engine/store and real HTTP API. React's server renderer verified the post-reservation review output. This is not a claim of visual browser or accessibility verification.

### Retained repro runner

`output/ramp-handoff/REPRO-BORROW.mjs` retains the independently executed engine, API, offset-hold, persistence, storage-failure and React-render repros. It was syntax-checked and executed successfully against the reviewed checkout. Build the app first, then run:

```powershell
node --experimental-sqlite C:/Users/Sharon/Documents/ChatGPT/hackthenorth/output/ramp-handoff/REPRO-BORROW.mjs C:/Users/Sharon/Documents/ChatGPT/hackthenorth/output/ramp-review-borrow/apps/borrowfirst
```

For a patched checkout, replace only the final app path. The runner emits observed/expected JSON lines and stops its own temporary servers. The post-reservation React output deliberately reproduces the old prop-state combination; use the emitted real `App` wiring plus root's browser verification to judge whether the integration fix landed. Do not interpret that isolated component observation alone as proof that a fixed App still sends the old props.

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

## BorrowFirst re-audit at ef0ad26

`npm ci`, production build, client/server typecheck, and **43 tests pass with exit 0**. Running every retained original probe against this commit verifies:

- Forced asset controls now return the correct mandatory assets/costs, including $250 for forced M-102 alone and $280 for all three forced monitors.
- Waterloo/Toronto destinations produce different supported routes and costs ($255/$325).
- ISO offset hold comparisons normalize correctly: still-live `-04:00` holds cannot be stolen; expired `+02:00` holds can be released.
- Baseline expiry and transfer-price drift reject stale reservations; owner confirmation, stale asset version and mixed currency reject invalid requests.
- The actual HTTP race produces one reservation; partial and forged-empty plans are rejected with 409.
- File SQLite restart preserves reservations/owner confirmation; blocked browser storage retains session memory.
- App wiring passes the frozen `shownPlan`. Root's actual browser flow independently confirmed the completed $255 plan, Kitchener $80 and narrow layout; the isolated legacy-prop renderer is historical information only.
- Windows teardown was repaired; the meaningful concurrency test remains.

### BF-10 — P1: Reviewed quote exclusions spuriously fail authoritative reservation

**Source:** `src/engine/allocate.ts`, `validatePlanIntegrity` baseline recomputation; `AllocationPlan` does not retain the reviewed quote exclusions.

**Retained case:** `reviewed-quote-exclusion-reserve` in `REPRO-BORROW.mjs`.

Confirm M-204; request three monitors by `2026-10-09T21:00:00.000Z`; allocate with `{excludeQuoteIds:['po-refurb']}`. The valid plan uses M-101/M-204/M-306, costs **4,500 cents**, and has reviewed baseline **67,500 cents**. Reserve rejects it as `BASELINE_STALE` because its baseline is recomputed with the explicitly excluded refurbished quote and becomes **59,000 cents**. No data or time changed.

**Fix expectation:** Retain reviewed constraints and use exactly those constraints for authoritative baseline/coverage validation, or give the baseline one consistent documented meaning. The ordinary UI quote exclusion control must still allow a complete valid plan to reserve.

### BF-11 — P2: Existing v1 sandbox saves lose every destination route after upgrade

**Source:** `src/backend/sandbox.ts`, unchanged key `borrowfirst.sandbox.v1` and assets-only load validation; `src/engine/allocate.ts` destination route filtering.

**Retained case:** `legacy-v1-sandbox-upgrade`.

Existing pre-fix saved transfers have no `destinationLocationId`. The new loader accepts that old world because its assets are an array, but the destination filter rejects every old transfer. The default three-monitor plan silently changes to **zero transfers and 67,500 cents of new purchases** until the user resets.

**Fix expectation:** Version the persisted schema or safely migrate old routes with explicit supported destinations. Preserve state when possible; explain an unavoidable reset. Validate the entire restored world, not just the assets array.

### BF-12 — P2: Memory fallback masks working shared storage and overwrites another tab

**Source:** `src/backend/sandbox.ts` `load()` returns `memoryWorld` before reading localStorage, including inside the Web Lock.

**Retained case:** `cached-browser-store-overwrites-working-storage`.

Two `SandboxStore` instances read shared working storage. A sequentially reserves M-101 for `tab-A`; B subsequently reserves the same M-101 from its cached seed. Both return success and the persisted world contains only `tab-B`, silently deleting A's reservation. This is a sequential stale-cache overwrite; the Web Lock does not refresh the data.

**Fix expectation:** When storage works, reread/validate it under the write lock. Use memory solely when storage is unavailable. Preserve the honest single-browser/no-cross-device guarantee; this finding does not claim global multi-user coordination.

**Saved complete output:** `BORROW-REPRO-ef0ad26.jsonl`. The original runner now includes all three new cases.

### Final BorrowFirst gate at df48f9e

**Reviewed head:** `df48f9e` (`borrowfirst: fix three reserve/sandbox regressions from audit round 3`). `npm ci`, build, typecheck and **all 47 tests pass with exit 0**. `BORROW-REPRO-df48f9e.jsonl` retains the full independent rerun, including original engine/API/persistence/fallback probes.

BF-10 now succeeds: reviewed excluded-refurb baseline stays 67,500 and the 4,500-cent three-asset plan reserves correctly. BF-11 now migrates the legacy v1 save to supported routes and returns the correct conditional 25,500-cent default plan. BF-12 now rereads working storage: A succeeds, B is rejected, and the persisted reservation remains A's. Original owner confirmation, stale asset version, mixed currency, real HTTP race, partial/forged plan rejection, UTC-offset hold expiry, quote expiry, transfer drift, file restart and blocked storage checks remain correct. The historical findings above are resolved at this head; no new release blocker was found in this bounded audit.

## ExitLane audit at 31bc5d0

- Checkout: `C:/Users/Sharon/Documents/ChatGPT/hackthenorth/output/ramp-review-exit`, app `apps/exitlane`.
- Runtime: Node 22.14.0 / Windows. Independent runner imports the production shared engine, executes real SQLite HTTP requests, and starts only isolated child servers on random ports.
- `npm ci`, `npm run build`, `npm run typecheck` **pass**.
- `npm test`: **32 meaningful assertions pass, but overall exit 1** from a Windows SQLite cleanup hook (EL-03 below).
- Runner: `REPRO-EXIT.mjs`; complete observed/expected output: `EXIT-REPRO-31bc5d0.jsonl`.

```powershell
node --experimental-sqlite C:/Users/Sharon/Documents/ChatGPT/hackthenorth/output/ramp-handoff/REPRO-EXIT.mjs C:/Users/Sharon/Documents/ChatGPT/hackthenorth/output/ramp-review-exit/apps/exitlane
```

### EL-01 — P1: Failed retries execute against stale approvals and claim obsolete refunds

**Source:** `shared/engine.mjs:251`, `shared/engine.mjs:437`, `shared/engine.mjs:561`: clock/amount changes and execute-time fingerprint checks apply only to `approved`, skipping `failed` requests.

**Exact fixture:** C=30,000, P=10,000, U=20,000 USD cents; free cancellation before `2026-10-01T16:00:00Z`, 100% fee at/after that instant; provider script first fails with 503, then confirms. Clock starts at 15:00Z.

**Repro:** Cancel event → prepare → approve → execute (provider failure) → move clock to exact cutoff → retry same request. Both production-memory engine and actual SQLite HTTP API confirm the second attempt. Current assessment correctly says **refund 0 and extra due 20,000**, yet the executed request counts the old **10,000 refund as confirmed due**. Two provider outcomes were recorded.

The same bug reproduces after a failed attempt followed by a valid amount/version edit: new refund 11,000 vs old approved 10,000, then retry confirms old figures.

**Fix expectation:** Revalidate booking status, policy/version/fingerprint and assessed eligibility immediately before every nonterminal provider attempt, including failed retries. Changes must mark stale and require fresh review/approval. No second provider outcome or financial confirmation on a stale retry. Retained cases `FAILED-retry-after-cutoff`, `FAILED-retry-after-booking-version-edit`, and `HTTP-FAILED-retry-after-cutoff`.

### EL-02 — P1: Prepared bookings can become invalid and still be approved/executed

**Source:** `shared/engine.mjs:360` `approvePacket`; it recomputes the assessment but unconditionally approves every previously prepared request. Execution checks only equality to that invalid fingerprint.

**Repro:** Prepare the valid fixture above, then edit P to 1,000 while leaving C=30,000 and U=20,000. The displayed assessment becomes `invalid` because C != P+U. `approvePacket` nevertheless returns `approved:['audit-booking']`; execute returns a simulated confirmation, stores an outcome, and changes booking to `cancel_confirmed`. This reproduces through actual HTTP `/api/bookings/amounts`, `/api/packet/approve`, and `/api/requests/.../execute`.

**Fix expectation:** Approval must check current active booking and `assessment.status==='assessed'`, otherwise exclude/reject and require correction. Execute must separately validate eligibility even if the fingerprint happens to match. Cover transition from prepared to invalid/manual-review/canceled, not only invalid input at initial prepare. Retained cases `PREPARED-invalid-booking-approved` and its `HTTP-` equivalent.

### EL-03 — P2: Windows test teardown deletes an open SQLite file

**Source:** `tests/acceptance.test.mjs:98`–100; `server/index.mjs` has no graceful database-close handler.

The cleanup hook calls `child.kill('SIGTERM')` then immediately removes the directory. Windows reports `EBUSY ... test.sqlite`; npm test exits 1 after all 32 assertions pass. Await owned child exit and close the database before removing exact temporary files. Keep the HTTP concurrency assertions; do not ignore cleanup errors.

### EL-04 — P2: Reset reuses old request IDs in the new epoch

**Source:** `shared/engine.mjs:316`, request ID `req-${bookingId}` and idempotency key omit store epoch.

An old ID receives 404 immediately after reset, as existing tests check. Once the same booking is prepared and approved again, the identical old ID addresses the new request and executes it with 200. An in-flight retry from the previous demo can therefore mutate the newly reset scenario. Reproduced through HTTP; old epoch 4 → new epoch 5, both IDs `req-audit-booking`.

**Fix expectation:** Include epoch or a fresh unique request token in IDs and idempotency keys; stale callbacks must not address new approvals after reset. Retained case `HTTP-reset-stale-request-id` includes both immediate and after-new-approval calls.

### EL-05 — P2: Parseable but corrupt localStorage state causes a startup crash loop

**Source:** `shared/memstore.mjs:122` blind `Object.assign` restore; `src/backend/browser.ts:21` catches JSON parse errors but does not validate restored shape.

Actual bundled browser backend with stored `{"bookings":null}` connects, then `state()` throws `TypeError: Cannot read properties of null (reading 'map')`. Reload repeats the same restore. Validate schema before replacing the seeded state, recover to a clearly labeled fresh sandbox, and preserve valid saves. Retained case `corrupt-storage-shape`.

### ExitLane passing independent acceptance evidence

| Area | Independently observed result |
| --- | --- |
| Exact cutoff and timezone | Before cutoff refund 10,000; at cutoff/offset-equivalent instant refund 0, extra 20,000; correct `<` / `>=` semantics |
| Honest money | C=P+U required; negative/fractional/currency input rejected; negative net benefit preserved rather than clamped |
| Policy uncertainty | Missing, unsupported, contradictory and unreadable fee policies return manual review without estimated figures |
| Approval/version | Prepared cannot execute; normally approved policy-version drift becomes stale with no provider outcome |
| Idempotency | Eight actual simultaneous HTTP executions produce exactly one provider outcome and seven replays |
| Refund receipt | Eight simultaneous receipt requests record 10,000 once, with seven replays; due and received remain distinct |
| Frozen executed history | Moving clock after a completed cancellation does not change approved financial confirmation; replay remains terminal |
| Durable SQLite | Two-launch test retains epoch, request, outcome and exact due/received totals |
| Blocked storage | Browser backend retains five requests and its subsequent outcome in memory when writes throw |
| Explicit modes | Static adapter exports `Browser sandbox — this tab only`; header source distinguishes it from `SQLite backend sandbox` |
| No real action | Provider scripts/outcomes and exports are explicitly SIMULATED; source contains no vendor/payment cancellation integration |

Root owns real-browser layout, keyboard, reset/reload and visual-design verification. This report does not substitute server-render/source checks for those UI checks.

### Final ExitLane gate at 7fd9f56

**Reviewed head:** `7fd9f56` (`exitlane: fix audit P1/P2s, epoch-scoped request ids, storage validation, density pass`). `npm ci`, production build and typecheck pass. **All 40 tests pass with exit 0**, including Windows child shutdown/SQLite cleanup. The complete independent retained runner also passes; output is `EXIT-REPRO-7fd9f56.jsonl`.

- **EL-01 repaired:** actual HTTP failure → exact cutoff → retry records **only the original failed outcome**, moves request to `stale`, keeps booking active and confirmed due at 0. Valid amount/version edits and unsupported policy changes after failure likewise refuse before another provider attempt. Unchanged failed requests still retry correctly and retain failed + confirmed history.
- **EL-02 repaired:** prepared → inconsistent financial edit → approval returns `approved:[]`, marks request `excluded`, and execute receives 409. Booking remains active; no provider outcome exists.
- **EL-03 repaired:** real server tests now finish cleanly on Windows; no open-file teardown failure.
- **EL-04 repaired:** request and idempotency IDs include epoch; old `req-audit-booking-e4` returns 404 both immediately after reset and after new `req-audit-booking-e5` is approved.
- **EL-05 repaired:** actual bundled browser backend recovers from parseable `{"bookings":null}` storage into a valid seeded state.
- Normal eight-call HTTP cancellation/refund races still yield one outcome, seven execution replays, one receipt and seven receipt replays. File restart keeps epoch, requests, outcomes and exact financial totals. Blocked browser storage retains sequential state, and labels stay `Browser sandbox — this tab only` / `SQLite backend sandbox`.

All app source remained untouched by the independent auditor. Root still owns final integration and browser verification; this gate covers the engine, actual HTTP API, isolated persistence, fallback adapter and production build/type/test checks.
