# Independent audit: Cart Tetris and root integration

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
