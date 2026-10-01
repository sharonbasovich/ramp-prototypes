# Independent audit: Cart Tetris and root integration

## Current integration status — October 1

Root pushed eb0122d to the Cart branch, integrated it with all five apps, completed interactive desktop/mobile checks, and passed the full 48-test Cart suite plus all 211 suite tests. The earlier "not pushed" and "root must integrate" notes below describe the audit handoff before root completed those steps. See FINAL-QA.md for the assembled suite's current verification.

## Final gate — b09cc5a + authorized local hardening eb0122d

Latest reviewed Cart remote base: `b09cc5a6a525ff5e54a260b9e1b9c7c392d25137`. At root's request the auditor then fixed definite final defects on local branch **`codex/cart-final-hardening`**, commit **`eb0122d0db6e654c3f758ea92206cc910934fef9`**, with a clean worktree. **Not pushed; root must integrate/publish this five-file patch.** This section supersedes earlier audit sections.

**Gate: Cart's reproduced P1s are resolved. Integration is ready after the local hardening commit is applied; interactive desktop/mobile and published Pages checks remain root-owned.** No online-event actions or app/browser sessions were launched by this audit. Existing app servers5311–5315 were not restarted or stopped.

- Focused independent CSV checks: absent currency/quoted_at/valid_until columns reject; each blank required cell rejects; valid explicit `2026-09-01`/`2027-01-01` dates are preserved; injected future2027-01-02 clock rejects expired rows. No fabricated 30-day validity remains.
- Assembled workspace `output/ramp-prototypes` at inspection commit`5d413252809f355ddc9bc4a5caf9b1900b6ff445` contains all five app packages and all five `dist/index.html` files. Four plain Node start scripts are launched directly; BorrowFirst's compound build+Node script correctly uses npm fallback. Windows process-tree cleanup exists for wrapper children.
- Definite CI defect independently reproduced using PyYAML: unquoted `- name: Suite: install ...` caused “mapping values are not allowed here” at line72, column20. Local hardening quotes that name; parser now succeeds. CI's final suite explicitly installs/typechecks/tests/builds all five after verifying all five exist.
- Startup previously modified its iterable with `splice` after a failed build, skipping the next app's build. Local hardening uses a separate `ready` list. Independent VM executes the exact current `runStart` function with mocked launches: a first failed build still attempts all three apps and starts only the two successful apps; all failed builds exit1/start none; prebuilt apps start without rebuild. This test starts **zero real processes**.
- Material accepted-domain baseline precision case addressed: quote unit3500000000000001 ×3 creates an unsafe and one-cent-rounded baseline, while a second vendor's two100-cent units permit an exact safe split3500000000000201. Baseline now excludes unsafe line/subtotal/shipping totals instead of publishing an inexact comparison; two focused regression tests cover this and shipping overflow. This is an extreme-input limitation, not ordinary procurement pricing, but aligns both calculation paths' supported precision.
- README now accurately directs local users to `npm run hub` on localhost5300, explains why direct-file hub links do not route, gives PowerShell APP-filter syntax, explains missing-dist startup builds, and requires explicit rebuild after source changes.
- Verification: **21 tests in the changed regression file pass**, app typecheck passes, `git diff --check` passes, current CI YAML parses. Prior passing43-case whole suite and180-case independent oracle were not repeated; no engine optimization logic changed in this final patch. The npm runner consumed `-t` as a config flag, so the actual executed regression count was21, not an incorrectly claimed filtered subset.
- Final evidence: `cart-final-gate.mjs` and `cart-final-gate-results.json`, both outside application directories. The report preserves earlier SHA-specific evidence below.

Remaining nonblocking scope limitations: expiry feedback can still be clearer (guards safely refuse without a toast), and overflowing totals can show generic infeasibility rather than an explicit precision reason. App remains a bounded example-price sandbox, with no real procurement or model integration claims. No outstanding reproduced P1 remains in **b09cc5a plus eb0122d**.

---

## Latest re-audit — commit 93be16af011b287f8b2ab06f0e12e694be2d428b

This section supersedes the initial findings below where marked fixed. Application source remains untouched. Root/browser review remains responsible for interactive desktop/mobile behavior.

**Outcome:** The original critical arithmetic, identity, stale rendering, approval and Windows/hub defects are fixed in this commit. One previously requested validation fix remains: missing CSV quote provenance is still accepted and synthesized. Two minor numeric/persistence/feedback limitations remain as described below; they do not change the verified seed demonstration.

### Reproduced fixes / passing evidence

- Root changes **are present** (`scripts/run-apps.mjs`, 72 changed lines), even though commit title emphasizes app fixes.
- Windows root `npm run setup` exit0, `npm test` exit0 **43/43**, and `npm run build` exit0 including typecheck. Direct `node scripts/run-apps.mjs test` also passes, exercising the fallback Windows npm launcher outside an npm context.
- Seed still **10100 baseline → 8150 optimum → 1950 reduction**; deadline1 still10100/no Bulk Club; empty basket0. Independent per-unit oracle180 fresh cases agrees; 94,196,375-combination input safely returns `boundExceeded` in ~0.27ms.
- Zero-price good now costs shipping500, vendorCount1, and remains in JSON export. With minimum1 it becomes infeasible. Zero-price tier semantics tested by existing regression suite.
- Original CSV `123.5 / 1.9 / 1x / 10xyz`, mixed CAD/USD and earlier expired row rejects with exact row errors. Repeated vendor shipping/delivery conflicts, duplicate quote rows and colliding vendor-name IDs reject. Quote editor now retains/rejects decimal/blank/nonfinite data rather than truncating to valid integers.
- Duplicate JSON vendor IDs and mismatched quote-key/SKU identities reject; signature includes quote keys. Nine-digit price-ordering now chooses999999999 over1000000000 numerically. Unit1e308 rejects as unsafe.
- Independently called approval reducer for approve→change→restore: `revoked:true`, usablefalse. App runs reducer whenever current signature changes, preserving revocation through persisted state. Browser-event timing is root's interactive verification.
- Explicit injectable future clock (`2027-01-02`) causes solver to reject seed quotes expired2027-01-01. Already expired2020 quotes reject before search. Code independently confirms saved expired quotes are revalidated and replaced with seed on boot; compute, approval and export each validate again. **No genuine expired quote plan is exported through the UI guard.** Boot fallback is silent rather than explaining the expiry.
- **Executed server-side React rendering** of actual ResultsPanel with current quote set containing only `replacement-vendor`, but computed old seed plan: renders without exception, old vendor snapshot remains visible, new vendor absent, stale warning present. This is a no-browser runtime reproduction of the former stale-import crash.
- CSV export correctly escapes vendor name `Acme, "Inc."` with a newline; currency, quotedAt and validUntil now included. JSON full provenance retained.
- **Executed local hub HTTP check:** `/`200 with correct hub, all five `/<slug>/` paths302 to localhost5311–5315. Auditor started and stopped only its own hub process; no user/app browser touched. Relative asset paths and Pages workflow remain correct by local inspection. Root start now builds missing `dist/index.html` before launching; fresh-clone startup not independently simulated by deleting artifacts.

### Remaining P1 — missing CSV validity/currency provenance gets invented

Repro passed to `parseCsvQuoteSet` with `now = 2026-10-01T00:00:00Z`:

```csv
vendor,sku,unit_cents,stock,delivery_days,shipping_cents
A,w,100,1,1,0
```

Actual `errors: []`; sets currencyUSD, quotedAt to machine import time, validUntil to `Date.now()+30days` (audit result2026-10-31). This claims a supplier-validity window never supplied, allowing these quotes to bypass the expiration gate. The initial audit asked to reject missing provenance. Require currency and valid_until (and truthfully distinguish provided quote date from import time), reject blank cells/absent columns, or explicitly model unknown validity and prevent approval until user enters it. Injected `now` is currently ignored when inventing these fields.

### Remaining P2 — unsafe baseline aggregation and misleading error

Two units at the individually safe `Number.MAX_SAFE_INTEGER` price: optimizer correctly excludes unsafe aggregate, but `singleVendorBaseline` still returns unsafe18014398509481982 without validation/aggregate guards. The infeasible reason incorrectly names deadline/stock/minimum, though the cause is cents exceeding supported precision. Numeric baseline helper should enforce the same safe arithmetic/domain and report that limit. This requires absurd demo prices and is not a seed blocker.

### Remaining P2 — expiry feedback / direct-file hub documentation

Approval/export guards safely return on expired quotes but offer no message; their buttons can look active and inert until recompute. Saved expired quotes silently reset to seed rather than showing why. Also README's claim that `hub/index.html` can be opened directly is still false: relative slug links have no app directories under `hub/`; the HTTP hub now works. Prefer documenting `npm run hub` or changing direct-file link behavior. CSV metadata now has quote provenance but still omits the full assumptions included in JSON.

### Re-audit artifacts

- `cart-audit-results-93be16af.json`: exact independent repro outcomes and React stale-import SSR proof.
- `cart-hub-results-93be16af.json`: actual200/302 HTTP hub routes and owned-process shutdown evidence.
- `cart-independent-audit.mjs` updated to load current modules and retain old initial results in `cart-audit-results.json`.
- `cart-hub-audit.mjs`: bounded no-browser localhost hub test, refuses occupied port and never stops another process.

---

## Initial audit — retained historical findings (superseded by latest re-audit above)

Audit date: October 1, 2026 (America/Toronto). Read-only application review of `output/ramp-review-cart`, commit `1090a66b46a11c14e26587cc39ba95ea3319b551`, against `SPEC-CART.md` and `BUILD-CONTRACT.md`. No application source or browser controls changed. `npm ci` and build created only dependencies/build artifacts; independent audit artifacts are in `output/ramp-handoff`.

**Verdict: seed demonstration and typical optimizer math pass; repair the input-validation, order identity/zero-price, approval-expiry and local-suite integration issues before declaring the complete editable/importable flow done.**

## Verified passing checks

- Node `v22.14.0`; app `npm ci` exit 0; `npm test` exit 0 (27/27 cases, including its existing 150-case oracle); `npm run build` exit 0 (TypeScript and Vite).
- Independently evaluated seed: cheapest valid single vendor **10100 cents**, exact optimum **8150 cents**, potential spending reduction **1950 cents**. Bulk Club coffee+bars subtotal 6500/free shipping, QuickBox cups 1050+600 shipping.
- One-day deadline removes Bulk Club: optimum **10100**, all three lines assigned to QuickBox. Empty basket gives zero and no allocations.
- Independently written per-unit enumeration oracle (does not import/reuse the app oracle or pricing/shipping helpers) agrees on **180 held-out small random cases**: 1–4 vendors; 1–3 SKUs; quantities 0–2; stock shortages; absent delivery feasibility; thresholds; minimums; volume tiers. Zero-price orders also tested deliberately below and fail.
- Search bounds prevent explosion: 3 SKUs × 12 units × 4 vendors returns `boundExceeded` for **94,196,375** combinations versus 5,000,000 limit, in about 0.29 ms on this audit machine. No unbounded search was attempted. UI quantities bounded 0–12.
- Ordinary quantity/deadline/price changes alter the plan signature. The UI's dirty/result/approval checks prevent immediate export of the old plan after an ordinary input change. Imported validation failures do not call `onApply`.
- JSON export includes full quote provenance, assumptions, price/quantity/order arithmetic and truthful sandbox labels for valid seed input. Browser/server mode labels follow health-probe code; no unimplemented real purchasing/AI extraction claim found.
- Vite `base: './'` emits relative asset links, suitable for the declared Pages `/ramp-prototypes/cart-tetris/` path. Pages workflow copies `dist/` into each slug directory and hub into site root. CI discovers existing apps, tests/builds them, and default-main suite explicitly requires all five. Actual deployed GitHub Pages was not opened during this read-only offline audit; root owns final merged-suite verification.

## Findings and exact reproductions

### P1 — CSV import silently accepts invalid numbers, mixed currencies and expired row quotes

`src/engine/validate.ts:121–142` uses `parseInt` and overwrites set currency/validity with each row; it also retains only the first row's vendor shipping/delivery rules. `123.5`, `1.9`, `1x` and `10xyz` become 123, 1, 1 and 10, all accepted. Last USD row overrides earlier CAD; last future `valid_until` overrides expired earlier rows. Contradictory same-vendor metadata is silently ignored.

Paste/import:

```csv
vendor,sku,unit_cents,stock,delivery_days,shipping_cents,currency,valid_until
A,w,123.5,1.9,1x,0,CAD,2020-01-01
B,w,10xyz,3,1,0,USD,2027-01-01
```

Actual: `errors: []`, two vendors installed as USD/current quotes with truncated numeric values. Expected: reject atomically, identify row/column errors, require consistent currency/validity/vendor metadata, and never invent a new validity period for missing provenance. Quote-editor `num()` similarly truncates decimals with `Math.trunc` and turns a cleared required field into zero; reject invalid raw values instead of silently changing them.

### P1 — Zero-price allocated goods skip shipping/minimums and disappear from exports

`src/engine/optimize.ts:52,201,230`, `src/export.ts:43,95`, and ResultsPanel use `itemsCents > 0` to mean “vendor has an order.” Zero is an accepted quote price and may also be an accepted volume tier.

Repro: one `w`, qty 1; one vendor stock 12, unitCents 0, shippingCents 500, no free-shipping threshold, no minimum. Validation passes. Actual optimum **0**, vendorCount 0, export has `orders: []` despite basket/allocations containing `w`. Independent oracle expects **500** and one used order. Add `minOrderCents: 1`: actual remains optimal 0, but correct result is infeasible. Track used quantity separately from item subtotal, including baseline/render/export; or explicitly reject free items/tiers with a documented restricted scope.

### P1 — Duplicate/mismatched identifiers can create a corrupted approved order

`validateQuoteSet` does not reject duplicate `vendor.id`, a quote's `skuId` differing from its object key, or missing `skuId`. Two vendors both id `same`, each stock 1, prices 100/200, require qty 2: validation passes and produces two orders/allocations both id `same`. Rendering uses `.find`, export groups both allocations into each order, causing duplicate lines and wrong attribution. CSV slugs also collide for different names that normalize identically.

Repro for strict equivalence: `quotes.w = { skuId: 'different-product', unitCents: 100, stock: 12 }` is accepted and used to satisfy `w`. Validate unique nonempty canonical vendor IDs and exact quote-key/SKU identity; reject duplicates rather than merge/overwrite. Signature should include actual quote keys, not just their inner `q.skuId` values.

### P1 — Restored old inputs resurrect an approval; expired loaded quotes remain usable

`App.tsx:102–126` compares signatures but clears approval only on reset. Sequence: approve seed → change quantity → recompute (void shown) → restore old quantity → recompute. `approvalValid` becomes true again with the **old approval**, contrary to “input changes invalidate approval.” Clear approval on committed input mutation, not only while the signature differs.

`App` reloads persisted quote data without semantic validation; `solve`/baseline do not validate validity/currency/prices. Independent repro: set seed `validUntil` to `2020-01-01` and call `solve`; actual optimal8150. A valid import that expires while app is open/closed can likewise retain approval and export. Revalidate persisted data and quotes at compute, approval and export using an injectable clock. Do not simply rely on import-time validation.

### P1 — Root suite commands fail on Sharon's Windows host; local hub links are dead

`scripts/run-apps.mjs:59,82` spawn bare `npm`, not the Windows npm launcher. Verified `node scripts/run-apps.mjs test`: `test: 0/1 app(s) ok`, exit1, no app test execution. Direct `spawnSync('npm',['--version'])`: status null, `ENOENT / spawnSync npm ENOENT`. App-local PowerShell `npm test` works. Use a Windows-compatible child launch (prefer invoking npm CLI with the current Node binary) and surface launch errors; test setup/test/build/start on this host.

`hub/index.html:59–87` all links are `./<slug>/`, but local hub server at5300 only serves `/` and `/index.html` and returns404 for every app path (`scripts/run-apps.mjs:102–110`). Thus the documented local hub cannot launch apps running5311–5315; direct opening `hub/index.html` is also broken. Preserve relative URLs for Pages and route local mode to actual app ports (or proxy correct paths).

Root README's advertised `npm run setup && npm start` also does not build app `dist/` on a fresh checkout (`setup` only installs, app `start` only serves prebuilt dist). Git ignores dist. Document/setup the required build or have start build safely; otherwise a fresh installation yields503.

### P2 — Accepted large cents values break exact numeric ordering

`optimize.ts:239` sorts costs lexically using nine-character padding. Two valid safe prices 999999999 and1000000000 cents, one identical item, no shipping: actual picks1000000000, independent oracle999999999. Compare numeric totals directly before tie-breaking. `Number.isInteger` also accepts unsafe magnitude1e308; accepted unit price ×2 overflows and is misreported as stock/deadline/minimum infeasibility. Enforce safe integer domain and safe aggregate bounds across price/shipping/tier/quantity arithmetic.

### P2 — CSV purchase export lacks quoting and complete standalone provenance

`export.ts:100` joins raw vendor/item names with commas; a permitted vendor name `Acme, Inc` creates extra columns. Newlines/quotes also corrupt records. Proper CSV escaping is required. CSV has no currency/quotedAt/validUntil/assumptions comparable to JSON despite contract requiring itemized provenance/assumptions; add explicit comment metadata and safe escaping. JSON export has this metadata.

### P2 — Stale plan presentation mixes old math with new vendor definitions

App stores computed basket/deadline but ResultsPanel receives current `quoteSet`. After import replacing vendor IDs without recompute, old plan orders map to missing vendors; `vendors.find(...)!` followed by `v.name` can throw, blanking the app. A stale badge does not prevent rendering. Snapshot vendor/provenance definitions with computed results, or hide stale details until recompute.

## Audit artifacts and remaining checks

- `cart-independent-audit.mjs`: repeatable Node/TypeScript-transpiled independent checks; reads source only and writes results outside application directory.
- `cart-audit-results.json`: exact seed/deadline/bounds, malformed CSV, zero-price/minimum, duplicate identity, expired compute, money-ordering and held-out oracle results.
- Run: `node C:/Users/Sharon/Documents/ChatGPT/hackthenorth/output/ramp-handoff/cart-independent-audit.mjs` after app `npm ci`.
- Browser keyboard/mobile/import-reset/approval download interactions were not executed by this auditor (explicit no-browser instruction). Existing screenshots/review are builder evidence, not independent user-flow verification. Root should reproduce the stale-import crash and approval restoration sequence in UI after fixes.
- No regression suite written into the app and no application files edited. No online event, account, payment or supplier action performed.
