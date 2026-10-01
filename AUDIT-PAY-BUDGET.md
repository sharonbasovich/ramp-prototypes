# Independent audit: Pay Me Twice and Budget Brawl

Audit completed against these read-only review checkouts:

- Pay Me Twice: `output/ramp-review-pay`, commit `2ef72e2c77e8366be51d96dbf80660f567a64502`.
- Budget Brawl: `output/ramp-review-budget`, commit `32468be53520e7185f870fa3e0143595696f83a8`.
- Runtime: Windows, Node 22.14.0, npm 11.3.0. Acceptance criteria: `output/ramp-handoff/SPEC-PAY-BUDGET.md`.

**Verdict:** Pay's scripted demonstration and transactional ledger work, but arbitrary uploads can silently pay an unrelated retained amount. Fix that before calling the upload flow ready. Budget's enforcement survives independent concurrent requests, but expired reservations can incorrectly deny the next request and its npm test command currently fails on Windows teardown.

No application source or root integration file was changed. `git status --short` was clean in both review worktrees after installation/build/testing. Temporary servers and the isolated headless browser were stopped; no user browser or Devin tab was used.

## Findings requiring fixes

### P1 — Pay uploads inherit unrelated prior facts, allowing an incorrect payment

**Locations:** `apps/pay-me-twice/src/App.tsx:178` (supported-document merge), `:190` (unreadable-document fallback).

The upload handler spreads the previous invoice facts, then filters out null and empty extracted fields. Missing fields therefore keep the previous invoice's values. It sets `factsSource: 'extracted'` for the merged record. The unreadable path likewise retains prior facts and a single field edit marks all of them manual.

**Independent browser reproduction:** Starting from Reset sandbox, upload this text:

```text
Supplier: Browser Audit Supplier
Invoice No.: BROWSER-991
No amount or period supplied.
```

The API/extractor correctly reports only supplier and reference. The form nevertheless shows **480.00**, **September 2024**, and **“Facts source: extracted from document.”** Click Try to get paid. It records `PAY-0002` for **$480.00**, citing the retained period, although neither was in the upload.

**Expected:** A new document starts with empty/unknown facts. Missing required amount blocks payment. An absent period remains absent, and extracted versus manually supplied facts remain distinguishable. Unreadable scans must require intentional fresh manual entry, not one edit over an unrelated sample.

**Evidence:** `audit-pay-budget-artifacts/pay-missing-fields-payment.png`; `browser-results.json` entries `pay-browser-missing-fields-retained` and `pay-browser-wrong-payment`.

### P2 — The native PDF extractor drops valid escaped parentheses, including totals

**Location:** `apps/pay-me-twice/engine/documents.mjs:319` and `:321`.

The literal-string regex excludes every parenthesis before PDF escape handling occurs. A normal PDF string `(Total \(USD\) $17.25) Tj` is skipped entirely, even though escaped parentheses are valid PDF syntax. The same applies to descriptions with parentheses. This compounds the P1 merge bug.

**Reproduction:** The independent fixture `audit-pay-budget-artifacts/independent-native.pdf` contains supplier, reference, October 2026 period, and **Total (USD) $17.25**. It is a native-text PDF with a font, content stream, xref, and trailer. `POST /api/documents` reports `supported: true` with supplier/reference/period, but `amountCents: null`; its text preview omits the total. The compressed version fails to extract that same line. In the browser, uploading it retains **480.00**, and Try to get paid records **$480.00**.

**Expected:** Correctly parse escaped PDF literal strings, or clearly require manual completion when a total cannot be read. Do not advertise a complete extracted invoice or substitute a sample amount. A PDF with the simpler line **Total USD $17.25** does successfully extract `amountCents: 1725`, so the route is functional but narrowly supported.

**Evidence:** `pay-native-pdf-wrong-amount.png`, both independent PDF fixtures, and `results.json` entries `pay-native-pdf`, `pay-flate-pdf`, and `pay-native-pdf-supported-simple-syntax`.

### P2 — Pay's “Invoice (as received)” panel fabricates document details

**Location:** `apps/pay-me-twice/src/components/InvoiceDocumentCard.tsx:34`, `:42`, `:43`, `:46`, and `:67`.

After an arbitrary upload, the panel displays the uploaded supplier alongside the sample supplier's address, September 2024 issue/due dates, sample Acme bill-to address, and zero tax. It renders editable facts as though they were the received document. It does not show the original PDF; extracted text is only in a collapsed details element. Editing the form also changes the supposedly received paper.

**Reproduction:** Upload the independent PDF above; its synthetic paper still shows Northline's sample address/dates and Acme's bill-to details, none of which are in that file. The screenshot `pay-native-pdf-wrong-amount.png` records this.

**Expected:** Label generated paper as a synthetic preview. For uploads, show the original document or clearly marked extracted text, and omit unknown address/date/tax fields. Do not present unverified template values as source evidence.

### P2 — Budget denies new requests against already-expired holds

**Locations:** `apps/budget-brawl/shared/engine.mjs:112` and `:177`; sweeping currently occurs at `server/index.mjs:99` only on GET state, plus actions touching the stale request.

**Independent HTTP reproduction:** Reset to $100 budget, $100 approval threshold, 500 ms quote TTL. Ada reserves a $60 monitor. Wait 700 ms, without reading state or acting on Ada's request. Ben then requests a $60 monitor. Ben is denied: **“Only $40.00 available.”** A subsequent GET state releases Ada's expired hold and reports **$100 available**, but Ben's request remains denied.

**Browser reproduction:** With the same configuration, wait 800 ms after Ada's request. The display continues showing Reserved $60 / Available $40. Sending Ben's request produces the same denial; refresh immediately shows $100 available beside the denial. Both adapters use the affected shared engine.

**Expected:** Expire stale holds inside the transaction before computing funds for a new reservation or approval. UI expiry refresh may improve display, but correctness must not depend on a separate GET state.

**Evidence:** `budget-expired-hold-denial.png`; `results.json` entries `budget-new-request-after-expiry-without-state-read` / `budget-post-expiry-state`; `browser-results.json` entries `budget-browser-expiry-stale-display` / `budget-browser-expiry-denial`.

### P2 — Budget accepts unsafe monetary configuration values

**Location:** `apps/budget-brawl/shared/engine.mjs:346` and `:352`.

`configure` checks `Number.isInteger` rather than `Number.isSafeInteger` and applies no upper monetary bound, unlike seed validation and catalog prices.

**Reproduction:** `POST /api/config` with `{ "budgetMinor": 1e30 }` returns 200 and persists `1e+30` as the wallet budget. GET state reports that value. At this magnitude, subtracting 6000 minor units cannot change the JavaScript number, so displayed available funds cease to represent exact cents. The approval threshold has the same validation gap.

**Expected:** Apply the same documented maximum and safe-integer validation to runtime configuration as to reset seeds. Reject invalid monetary values before any mutation.

### P2 — Budget reset does not protect against stale actions after a request ID is reused

**Locations:** `apps/budget-brawl/server/index.mjs:127`; action inputs contain only request ID. `shared/engine.mjs:304` acts on the current request found by that ID.

**Reproduction:** Reserve request `old-id` as Ada. Reset. Create request `old-id` as Ben. A stale client posting `/api/requests/old-id/cancel` successfully cancels Ben's new reservation. Epoch is stored but not required on incoming operations. The existing acceptance test checks only an old ID that has not been recreated.

**Expected:** An action for an earlier reset session cannot mutate a new session's record. Use epoch/session-scoped operation identity, or make reset/request identifiers unambiguously scoped. UI-generated UUIDs make accidental collisions unlikely, but do not satisfy the stated reset boundary by themselves.

### P2 — Budget's npm test fails on Windows because teardown races SQLite closure

**Location:** `apps/budget-brawl/tests/acceptance.test.mjs:98`.

Teardown sends `SIGTERM` and immediately recursively removes the test directory before the child exits and releases SQLite. Reproduced twice with `npm test`: the functional assertions pass, but the after hook fails with **EBUSY: resource busy or locked, unlink .../test.sqlite**. The command exits **1**.

**Expected:** Await the spawned child's exit/close before deleting its directory. Ensure the server closes its SQLite connection when shut down. Do not report the complete test command as passing from the individual assertion results.

## Passing checks and functional scope

| Check | Pay Me Twice | Budget Brawl |
| --- | --- | --- |
| npm ci | Pass | Pass |
| npm test | 29/29 pass | 21 functional assertions pass; teardown failure, command exits 1 |
| npm run typecheck | Pass | Pass |
| npm run build | Pass | Pass |
| Independent real HTTP burst | 20 clients → 1 recorded payment, 19 duplicate blocks, no 500s; one matching payment persists | 20 clients → 1 $60 reservation, 19 denials, $40 available on $100 budget |
| Independent retry / terminal race | Same request returns the same payment ID, without another ledger entry | Concurrent commit/cancel produces one terminal transition; final $60 spent/$0 held/$40 available |
| Browser fallback | Loads; next-month 10-request demonstration produces 1 payment/9 blocks | Loads; simultaneous scripted agents produce expected hold, approval, and permission results |
| Browser runtime errors | None in successful independent run | None in successful independent run |

Additional Pay checks used independent records rather than importing demonstration fixtures: identical uploaded bytes under a renamed filename are blocked by hash; an independently reformatted text invoice is blocked by identity; changed reference plus missing period is held for review; a new reference and new period is paid; unsupported non-manual facts are rejected; explicitly entered manual facts can be paid. Currency totals remain keyed by currency in the state representation. The manual UI's period selector is limited to September 2024–February 2025; arbitrary/current periods can be extracted but cannot currently be entered through that selector, so the manual fallback is narrower than the API.

Budget's existing independent HTTP acceptance tests also cover forged price claims, invalid quantities, denied permission scopes, approval under scarcity, stale prices, quote expiry when the request is touched, cancellation replay, budget-lowering rejection, and mixed request storms. Its server's synchronous transaction boundaries preserve money across the tested concurrency scenarios. The static adapter uses the same engine with an in-memory state and localStorage persistence and accurately labels its single-tab limitation.

## Claims and limitations

- Both applications visibly label sandbox money/no real payments. Pay says blocked duplicates are prevented repeats, not measured savings; Budget says blocked requested amounts are sample values, not realized savings. Those impact statements are appropriately limited.
- Budget explicitly calls the agents scripted. Neither app needs a model or claims a live Ramp card integration.
- Pay's source-data claims are the exception: “extracted” and “as received” are misleading while unrelated values can be retained or template details invented.
- Budget is a trusted-operator sandbox, not authenticated isolation between hostile agents. The action API has no caller authentication; item permissions are checked against the supplied agent ID. Do not describe it as a production authorization boundary without an identity layer. This is a scope limitation rather than an unsolicited request to build authentication for the prototype.
- Browser mode cannot prove server or cross-device enforcement. Labels and the Pay concurrency footnote make that distinction visible. Backend concurrency was tested independently over HTTP.

## Reproduction artifacts

- `output/ramp-handoff/audit-pay-budget.mjs`: independent HTTP/PDF checks using the two separate review worktrees.
- `output/ramp-handoff/audit-pay-budget-browser.mjs`: isolated headless browser checks against Vite previews of those same review worktrees. All previews and the headless browser close in `finally`.
- `output/ramp-handoff/audit-pay-budget-artifacts/results.json`: HTTP outcomes.
- `output/ramp-handoff/audit-pay-budget-artifacts/browser-results.json`: successful browser run, including visible values and zero page errors.
- Screenshots, independent native/compressed PDF fixtures, and SQLite audit ledgers are retained in that artifact directory for inspection.

Only those audit-owned scripts/artifacts were written. These findings need re-audit on the builders' subsequent fixed commits; this report does not claim any repair is complete.
