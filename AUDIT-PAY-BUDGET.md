# Independent audit: Pay Me Twice and Budget Brawl

> **CURRENT VERDICT (final Pay a0b08c7): PASS for the reviewed upload, currency, provenance and concurrency criteria. Pay: 41/41 tests, typecheck and build pass. Budget: 35/35 local repair tests passed; root has subsequently merged it and verified the core SQLite/browser flows and compact viewports. Earlier findings below are historical and superseded by this banner and the final Pay evidence. No open Pay P1/P2 remains from this audit.**

## Final Pay re-audit - a0b08c7

Read-only checkout: `output/ramp-review-pay`, commit `a0b08c7be042d4f22bf1be866cfa0bb1737f1108`. Application files were not changed by this re-audit. The existing independent upload/API probes were extended in a separate handoff script and run against a temporary SQLite server.

**Unstated currency now cannot pay, independently verified:** Both `Total 12.34` and `Total $12.34` upload as amount 1234 cents with a blank currency. A payment using either the returned blank currency or an omitted currency property returns `invalid` with "Currency is required" and leaves the payment ledger unchanged. Only deliberately supplying USD allows the exact $12.34 payment. Bare dollars no longer imply USD. Source inspection also confirms the currency selector has an empty placeholder, the upload notice identifies missing currency, and validation/payment readiness includes explicit currency.

**Provenance correction verified:** In `src/App.tsx`, every supplier/reference/period/currency and amount edit uses the shared `factsSourceAfterEdit` function. Extracted or generated facts become `mixed`; existing manual records remain manual. The UI labels mixed facts "document + manual edits" and the engine evidence says "Document text + manual edits". An independent partial upload lacking amount/currency cannot pay; after deliberate $23.17/USD completion marked mixed, the ledger records exactly 2317 cents and the evidence explicitly discloses manual edits. This resolves the earlier false extracted-source label. Fine-grained per-field provenance is not implemented or claimed.

**Core upload and concurrency checks still pass:** Independently supplied native and Flate-compressed PDFs both extract the literal source text, invoice NATIVE-812, October 2026, explicit USD and exactly 1725 cents. A missing reference remains invalid. Unreadable image bytes return `supported:false` and no fields; blank manual facts remain invalid. A fresh supplier/reference sent in a 20-way HTTP burst records one exact 2367-cent payment, blocks 19 duplicates, creates one matching ledger row and returns no non-200 status.

**Validation:** `npm test` **41/41 pass** (27 engine tests, 14 acceptance tests); `npm run typecheck` and `npm run build` pass. Additional independent HTTP probes all pass. The temporary server and in-memory SQLite connection were closed in `finally`. No UI browser was opened, and the review checkout remains clean.

**Evidence:** Reproducible script `output/ramp-handoff/reaudit-pay-a0b08c7.mjs`; captured outcomes `output/ramp-handoff/audit-pay-budget-artifacts/reaudit-pay-a0b08c7.json`. Prior defect reproductions are retained below as history rather than current blockers.

**Latest Budget integration evidence from root:** Local fix commit `0e5e7b7` was pushed to existing PR 2 and merged; root additionally changed desktop max width from 1320px to 1500px. Root's in-app browser verification passed Launch/Approve/Commit/Replay in both SQLite and Browser modes, all core sections visible at 1536px, and horizontal-safe layouts at 1366px and 390px. The earlier statement awaiting visual verification is historical. A separate independent Opus review of Budget is still active; this report does not assume its outcome.

## Latest Budget repair validation - local commit 0e5e7b7

Budget is now locally hardened on `codex/budget-local-hardening`, commit `0e5e7b79eaf43c42e1bb814fd673166d43a397f2`, in `output/ramp-review-budget`. This section supersedes the original Budget findings below. Root authorized app-only implementation after the cloud builder hit capacity; the original auditor performed these repairs, so this is repair validation rather than a second independent implementation review. Nothing was pushed, and no root integration file or other app was changed.

**All requested engine/API defects are repaired and covered by observable regressions:**

- Expired holds are released inside the same transaction before placement, approval, and budget-capacity decisions. Independent HTTP tests now place a $60 hold, wait beyond its 500ms TTL without a GET, and successfully reserve the next $60 request. Another case approves an $80 pending request after a different hold expires, and lowering the budget succeeds only after expired holds are released. No intervening state read masks these cases.
- Runtime budget, approval-threshold, catalog-price and claimed-price values are bounded safe integer cents, maximum 100,000,000 ($1 million). HTTP rejects `1e30`, values beyond JavaScript's safe-integer limit, 100,000,001 cents, fractions and negatives; persisted wallet values stay unchanged. Shared-engine testing confirms exact subtraction at the supported maximum. Malformed explicit seed wallet values now fail instead of silently becoming defaults.
- Placement and lifecycle commands require their captured epoch. Missing epochs return `400 epoch_required`; stale epochs return `409 stale_epoch` before replay lookup or mutation. Engine, real HTTP and the actual TypeScript browser adapter reset the sandbox, reuse the same request ID, then reject all four old lifecycle commands and the old duplicate placement while preserving the fresh request/hold. Fresh-epoch operations remain functional.
- Both backends expose the same `OpResponse` failure shape. A new direct browser-adapter test caught raw engine errors being returned without the UI's `error` object; configuration, price, placement and lifecycle errors now normalize to `{ok:false,error:{code,detail}}`.
- The impact counter counts terminal `denied/insufficient_funds` requests only. Pending approval or funds have separate counts and sample amounts, and the interface explicitly says pending requests may still succeed and requested amounts are not realized savings.
- Test teardown awaits the child server's close before deleting its validated test-owned temporary directory. The HTTP server also closes its SQLite handles on SIGTERM/SIGINT. Both successive complete test runs exited successfully on Windows, without the former EBUSY after-hook failure.

**Compact layout changes (source reviewed; visual verification assigned to root):** Launch/replay controls appear before the lanes; the transaction ledger appears before collapsed advanced catalog/quote controls. Request/quantity share one row, the unused justification field is removed, numeric totals use tabular figures, desktop controls keep a minimum 40px target (44px on mobile), and lane summaries expose full detail in the ledger. The UI schedules one refresh at the next live quote expiry and synchronizes lane status from the refreshed snapshot. No continuous polling was added. Root must verify the final populated layout at 1536 and 1366 widths; no UI browser was used for this repair pass.

**Validation:** `npm test` **35/35 pass**, including 19 real HTTP/SQLite tests, 13 engine tests and 3 tests of the bundled TypeScript browser adapter without a UI browser; `npm run typecheck` passes; `npm run build` passes; `git diff --check` passes. All temporary HTTP test servers exited and their test-owned SQLite directories were removed. The local worktree is clean after the commit.

**Integration contract:** `POST /api/requests` requires `epoch` from the snapshot that originated the request. Every `POST /api/requests/:id/{approve,reject,commit,cancel}` requires `{epoch}` from that original request row/result, not an epoch freshly substituted after Reset. The browser adapter and UI follow the same contract. Root will publish the local commit to the existing PR after reviewing it.

## Historical re-audit — Pay commit 2872c2e

Pay's checkout is now `2872c2e3abb1c70e8eafb4426e0caa7cc8a2a6a5`. This section supersedes the original Pay verdict/findings below. Budget's later local repairs and validation are documented above.

**Resolved in source and independently verified through the API:** the original P1 missing-upload-value retention and the P2 escaped-PDF-total extraction defect. The upload handler now builds a fresh record from extracted values, with missing supplier/reference/amount empty, and clears an unreadable scan's form. Payment and validation buttons are gated on the required facts. The engine independently rejects incomplete facts. Native and compressed versions of the original independent PDF now both extract `amountCents: 1725` and preserve `Total (USD) $17.25` in text. A deliberate manual completion records exactly $23.17 with manual-entry evidence. A new independent 20-request HTTP burst yields one payment and 19 duplicate blocks, with no 500s.

**Resolved by source inspection:** uploaded readable documents now display their own extracted text rather than fabricated sample addresses, dates, tax and bill-to details. The manual period control is now a `type="month"` input, allowing arbitrary/current periods. Sample fixture dates have moved to 2026. UI execution of this fixed commit is left to root; no UI browser was used during this re-audit.

**Validation:** 36/36 tests pass; typecheck passes; production build passes. Application source remains unchanged by the auditor. The temporary API server was closed. Evidence: `audit-pay-budget-artifacts/reaudit-pay-2872c2e.json`; reproducible script: `reaudit-pay-2872c2e.mjs`.

### Historical P2 (resolved in a0b08c7) — An absent currency is invented as USD and can pay without confirmation

**Locations:** `apps/pay-me-twice/engine/documents.mjs` total parsing, `engine/engine.mjs` normalizeFacts currency default, and `src/App.tsx` upload currency fallback.

Independent upload:

```text
Supplier: Independent No Currency
Invoice No.: NO-CUR-22
Total 12.34
```

`POST /api/documents` returns `currency: 'USD'`, `amountCents: 1234`, and `factsSource: 'extracted'`, although the file has no currency symbol or code. `POST /api/pay` with those returned fields records a $12.34 USD payment. The UI considers the form complete, and its copy says unstated fields remain blank. This bypasses deliberate verification of a financially required fact.

**Expected API behavior:** Extraction should preserve currency as unknown when the text does not explicitly identify it. Include currency in extraction provenance/found-field information. Normalization must not silently backfill USD for an uploaded/manual record with an unknown currency. Payment should return an invalid or review outcome until a valid currency has been explicitly supplied. Generated sample invoices already identify USD and can keep their existing smooth flow. A bare dollar symbol is not a unique currency code either; a regional assumption, if supported, must be disclosed and confirmed.

**Expected UI behavior:** Show a blank/“Select currency” option and a clear “Currency not stated in this document” message. Disable payment until the user chooses/confirms it. Label that value as manually supplied, rather than extracted. An independent regression should assert missing currency cannot pay; after an explicit selection, the exact amount should pay with correct provenance.

**Evidence:** `reaudit-pay-2872c2e.json`, result `currency-default-not-explicit-in-upload`.

### Historical P2 (resolved in a0b08c7) — Manual completion/edits of extracted facts stay labeled extracted

**Location:** `apps/pay-me-twice/src/App.tsx`, `onFactsChange` and `onAmountChange` handlers.

Both preserve `factsSource: 'extracted'` whenever the previous record was extracted. Consequently, typing the missing amount from an incomplete document still leaves the form labeled “extracted from document,” and the payment API receives the wrong source label. The corrected missing-value gate prevents accidental sample amounts, but the evidence cannot distinguish the user's completion from the parser's work.

**Expected:** Track source per field, or at minimum mark an edited/completed record manual/mixed and disclose which facts were typed. Manual confirmation should not falsely elevate an unreadable or unparsed value into verified extraction. Root has already sent this provenance fix to the builder; this audit does not mark it repaired until the new commit is inspected.

## Original audit — historical evidence

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
