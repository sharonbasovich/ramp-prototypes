# Borderless acceptance oracle

This document defines expected behavior independently of the implementation. All amounts, rates, fees, timestamps, and funding routes below are illustrative sandbox fixtures. Passing these cases does not establish a Ramp integration, provider quote, production budget, or live currency-support claim.

The one app contains Currency Check (`#check`), FX Guard (`#guard`, default), and True Cost (`#cost`). Tests must invoke the pure engine directly as well as exercise the complete browser flows. Record the actual API names and test results when code becomes available; do not mark these cases passed from inspection alone.

## Monetary invariants

- A monetary value always contains an explicit currency and an integer count of that currency's minor units. A bare integer is insufficient context.
- The sandbox metadata uses exponent 2 for USD, CAD, EUR, and GBP, exponent 0 for JPY, and exponent 3 for KWD. JPY/KWD vectors exercise generic monetary arithmetic; they must not be presented as supported Ramp payment or funding routes.
- Rates mean **target major units per one source major unit**. Store rates as exact decimal-derived rational numbers, never binary floating-point amounts. For source minor units `m`, rational rate `n/d`, and source/target exponents `s/t`, the unrounded target minor units are `m * n * 10^t / (d * 10^s)`.
- Conversion rounds once to the target minor unit using half-even. Exact halfway results go to the even integer. Invoice amount parsing never rounds excess precision into acceptance.
- Summation, comparison, and budget checks use exact integers. Export/persistence preserve integers and rational components as decimal strings if the internal representation is BigInt.
- Formatting is a display operation. It must not alter stored value, infer currency, or turn a rejected literal into an accepted amount.
- Rejected input produces no invoice, approval, selected vendor, or sandbox payment record. Preserve its original literal and an actionable explanation.

## Currency Check: direct parsing cases

These are direct engine calls, not only UI scenario buttons. Invoice currency evidence and `numericFormat` are independent inputs. The native/reporting currency column below is optional surrounding context only: if the parser has no such field, omit it from the invocation rather than introducing one. If present elsewhere in the app, it does not provide missing invoice currency evidence or select a numeric format. Do not infer functional/native currency from entity country.

| Invoice currency evidence | Optional native/reporting context | Numeric format | Exact original amount | Expected result |
| --- | --- | --- | --- | --- |
| ISO USD | CAD | en-US | `1,234.56` | Accept USD `123456` minor units; optional CAD context does not change the invoice currency. |
| ISO EUR | USD | de-DE | `1.234,56` | Accept EUR `123456`; no multiplication/division caused by native currency. |
| ISO EUR | CAD | fr-FR | `1 234,56` (U+202F grouping) | Accept EUR `123456`. |
| ISO EUR | CAD | fr-FR | `1 234,56` (U+00A0 grouping) | Accept EUR `123456` if both supported French grouping spaces are documented; otherwise reject explicitly. Never interpret as `1234` or `12345600`. |
| ISO USD | USD | en-US | `1234` | Accept USD `123400`. |
| ISO JPY | USD | en-US | `1,234` | Accept JPY `1234`; display no synthetic two-digit fraction. |
| ISO KWD | USD | en-US | `1.234` | Accept KWD `1234`; display three fractional digits. |
| ISO KWD | CAD | de-DE | `1,234` | Accept KWD `1234`, not `1234000`. |
| ISO USD | CAD | en-US | `1.234` | Reject excess USD fractional precision; no rounding to USD `123`. |
| ISO JPY | CAD | en-US | `123.45` | Reject fractional JPY amount; no truncation to `123`. |
| ISO KWD | CAD | en-US | `1.2345` | Reject excess KWD fractional precision. |
| `$` only | CAD | en-US | `$1,234.56` | Hold for currency resolution. Native CAD is not proof that this invoice is CAD. |
| `$` only, user explicitly resolves CAD | CAD | en-US | `$1,234.56` | Accept CAD `123456`; record the manual resolution. |
| `¥` only | USD | en-US | `¥1,234` | Hold for explicit currency resolution; no automatic JPY choice. |
| ISO EUR | USD | unresolved | `1.234,56` | Hold for numeric-format resolution; native USD must not choose en-US. |
| ISO KWD | CAD | unresolved | `1,234` | Hold: en-US grouping means KWD `1234000`, de-DE decimal means KWD `1234`. Offer the choices without choosing silently. |
| none | USD | en-US | `123.45` | Hold for invoice currency; native USD must not silently supply it. |

The U+202F French case is required. The U+00A0 case above deliberately permits either a documented supported alias or explicit rejection; silent misinterpretation fails. For all other listed accepted cases the integer result is mandatory.

Adversarial rejections, with no partial regex matches: `12,34.56` under en-US, `1.23.456,78` under de-DE, `1,234.56junk`, `1e3`, `Infinity`, `NaN`, empty input, conflicting invoice ISO codes, and an amount containing both a positive and negative sign. Reject a negative payable invoice if credits are outside the declared scope. Do not accidentally accept it as positive.

Test a value larger than JavaScript's safe integer, such as USD literal `90071992547409.93` -> minor string `9007199254740993`. The engine must either preserve it exactly or reject it under an explicit documented size limit; a rounded or neighboring integer fails. Numeric amount fields imported from JSON must not silently lose precision before validation.

Required browser flow: import the ambiguous KWD `1,234` fixture, observe the hold, choose de-DE, obtain KWD `1.234`, switch to en-US, obtain KWD `1,234.000`, and inspect the changed minor-unit evidence. Import the `$` fixture, resolve CAD, and export original text, ISO currency, numeric format, resolved minor units, and provenance. If the app exposes native/reporting currency, changing only that context must not change the invoice's original amount or ISO currency. Its absence from the parser does not fail this oracle.

## Exact FX and half-even oracle

Every rate below is a fixture, not a market quote. Expected results are target minor-unit integers.

| Source money | Target | Rate | Exact pre-round target minor units | Expected target minor units |
| --- | --- | --- | --- | --- |
| USD `1` | CAD | `0.5` | `0.5` | `0` |
| USD `3` | CAD | `0.5` | `1.5` | `2` |
| USD `5` | CAD | `0.5` | `2.5` | `2` |
| USD `7` | CAD | `0.5` | `3.5` | `4` |
| JPY `1` | KWD | `0.0025` | `2.5` | `2` |
| JPY `3` | KWD | `0.0025` | `7.5` | `8` |
| KWD `125` | USD | `1` | `12.5` | `12` |
| KWD `135` | USD | `1` | `13.5` | `14` |
| USD `1` | JPY | `50` | `0.5` | `0` |
| USD `3` | JPY | `50` | `1.5` | `2` |
| EUR `90000` | USD | `1.08` | `97200` | `97200` |
| EUR `90000` | USD | `1.12` | `100800` | `100800` |

Also reject zero/negative rational denominators, non-positive exchange rates, unsupported metadata, and an FX pair that does not match the supplied source and target currencies. Identity conversion must retain the exact source minor units. No automatic reversal of an incorrectly supplied quote direction is permitted.

## FX Guard: approval, staleness, and commit

Start with USD `100000` budget minor units (USD 1,000.00), no prior spend or holds, EUR `90000` invoice minor units (EUR 900.00), EUR->USD `1.08`, and an explicit USD `800` fee (USD 8.00).

1. Converted invoice is USD `97200`. Projected debit is `97200 + 800 = 98000` (USD 980.00). Projected remaining budget is USD `2000` (USD 20.00). The budget bar says **projected debit** before commit; spent remains zero.
2. Explicit approval records the invoice money, native/budget USD, EUR->USD pair and exact rate, fee currency/amount, projected debit, and quote identity/validity. Approval succeeds only for the displayed snapshot.
3. Edit the rate to `1.12`. The converted invoice becomes USD `100800`; debit becomes USD `101600` (USD 1,016.00), exceeding the budget by USD `1600` (USD 16.00). Existing approval becomes stale/revoked. Commit is blocked and the ledger remains unchanged. Show both the rate change and budget shortfall; approval cannot override insufficient budget.
4. Edit the rate back to `1.08`. Projected debit becomes USD 980.00 again, but approval remains revoked. Commit stays blocked until explicit fresh approval of a valid quote.
5. Refresh/reapprove a valid USD 980.00 snapshot, then commit. Exactly one sandbox payment/ledger record for USD `98000` is created. Spent becomes USD `98000`; remaining becomes USD `2000`. Replay/double-click/concurrent submission with the same command ID cannot create another debit.
6. Editing the original amount, currency, fee, FX direction, or native/budget currency after approval revokes it. Reverting any of those fields does not restore it. An earlier reset epoch/approval must not authorize a command in a new sandbox.

Use an injectable deterministic clock. The fixture quote has **two minutes of demo validity**, not a provider validity guarantee:

| Clock event | Timestamp | Expected status |
| --- | --- | --- |
| Issue quote | `2026-10-01T14:00:00.000Z` | `expiresAt = 2026-10-01T14:02:00.000Z` |
| Immediately before expiry | `2026-10-01T14:01:59.999Z` | Quote valid; approved unchanged snapshot may commit if funds fit. |
| Exactly at expiry | `2026-10-01T14:02:00.000Z` | Quote expired; commit blocked; no ledger debit. |
| Immediately after expiry | `2026-10-01T14:02:00.001Z` | Quote expired; commit blocked. |
| Clock moves back after expiry was observed | earlier than expiry | Revoked approval does not self-heal; require a fresh quote/approval. |

Use separate resets for boundary commit cases so an earlier valid commit cannot hide an expired-quote defect behind idempotent replay. The commit engine, not just the disabled browser button, must enforce expiry and snapshot validity. If approval uses an asynchronous callback, edit the rate while approval is pending and confirm the old callback cannot approve the new snapshot.

## True Cost: supplied landed charges and comparable totals

The required base fixture has identical goods and delivery scope across the two quotes. Reporting/native currency is USD. All non-goods charges in this fixture are explicit USD amounts.

| Vendor | Original goods | Exact EUR->USD rate | Converted goods | Shipping | Other supplied landed charge | Total |
| --- | --- | --- | --- | --- | --- | --- |
| Berlin | EUR 850.00 (`85000`) | `1.10` | USD 935.00 (`93500`) | USD 90.00 (`9000`) | USD 25.00 (`2500`) | USD 1,050.00 (`105000`) |
| Boston | USD 1,000.00 (`100000`) | identity | USD 1,000.00 (`100000`) | USD 20.00 (`2000`) | explicit USD 0.00 | USD 1,020.00 (`102000`) |

Expected recommendation: **Boston**, USD `3000` (USD 30.00) cheaper than Berlin's complete landed estimate. Goods-only conversion makes Berlin USD 65.00 cheaper; ignoring charges chooses the wrong vendor. Never compare EUR 850 and USD 1,000 as if the raw numbers shared a unit. Do not claim USD 65.00 as realized savings. The USD 25.00 charge is supplied sample data, not an inferred legal tax/duty rate.

Required recomputation and rejection cases:

- Change Berlin shipping to explicit USD 0.00: Berlin total becomes USD `96000` (USD 960.00); Berlin wins by USD `6000` (USD 60.00) versus Boston. The displayed breakdown, selection eligibility, and export must all update.
- Restore shipping to USD 90.00, then change EUR->USD to `1.00`: Berlin total becomes USD `96500` (USD 965.00); Berlin wins by USD `5500` (USD 55.00).
- Restore the base fixture, then make Berlin's USD 25.00 charge **unknown**. The quote is incomplete; do not coerce missing/blank/null/unknown to zero or rank/select it as cheapest. Suppress a definitive full-comparison cheapest recommendation until the unknown cost is supplied, or explicitly exclude the incomplete quote with a visible reason. A known subtotal is not a final landed total.
- Explicit zero is known; missing is unknown. This distinction must survive export and reset/reload.
- If charges support their own currencies, convert each with the appropriate exact pair and exponent; do not label a EUR charge as USD or convert an already-converted USD charge twice.
- Any supported shipping-free threshold/minimum order must be applied to the original vendor-currency subtotal before conversion. Unsupported tax rules or unavailable FX pairs must block a complete total, not become invented assumptions.
- Identical known totals produce a visible tie; no fabricated savings or undocumented winner. Invalid/negative payable costs cannot become a cheapest vendor.

## Funding route and native-currency boundaries

These direct policy calls must be independent of the invoice parser and rate arithmetic. For this product the documented Canada restriction concerns **CAD funding**, not the entity's accounting functional/native currency. Do not infer functional/native currency from country or reject a Canadian entity merely because its functional/native currency is USD.

A successful result below means **simplified funding-currency preflight passed**, not full verified product eligibility. A potentially available CAD route still assumes independently verified eligibility, including an eligible Ontario business, the required ERP/vendor conditions, and payment on behalf of the entity itself. The sandbox does not verify those prerequisites.

| Entity country | Optional functional/native context | Funding currency | Expected preflight decision |
| --- | --- | --- | --- |
| Canada / CA | CAD | USD | Block because funding is USD: this simplified product preflight requires CAD funding. No approval or commit despite a mathematically valid USD conversion. |
| Canada / CA | CAD | CAD | Simplified funding-currency preflight passed; full eligibility is unverified, and other amount/quote/budget checks still apply. |
| Canada / CA | USD | CAD | Simplified funding-currency preflight passed. Native USD is not a reason to reject; full eligibility remains unverified. |
| Canada / CA | USD | USD | Block because funding is USD, not because native USD is inconsistent with Canada. |
| Canada / CA | CAD | KWD | Block unsupported sandbox funding route. Generic KWD parsing/conversion is not a route-support claim. |

The UI must describe this as a simplified documented funding-currency preflight and distinguish entity country, functional/native currency when present, invoice currency, reporting currency, and funding currency. Successful generic ISO arithmetic alone must never imply Ramp supports that currency or route. Export must include funding currency, the preflight decision, and any functional/native currency actually supplied by the app, not only a converted total. It must not invent a functional/native currency or present a preflight pass as verified full eligibility.

## Browser completion and evidence

- Test desktop and 390 px mobile. Use the deep links, keyboard focus, each input, reset, approval, quote refresh/expiry, commit once, and audit export; controls must produce visible state changes.
- Show browser sandbox, illustrative rates/charges, no Ramp connection, and no real payments. Browser state must not be described as a shared production budget.
- After import/edits, a failed action keeps its reason visible and leaves the ledger unchanged. Successful commit records original currency/amount, converted debit, fee, FX evidence, quote validity, and approval identity.
- Reset restores the known fixture and clears only this app's sandbox state. A late callback from before reset cannot alter the new sandbox.
- Export is structured and inspectable, preserves exact integer/rational values and unresolved fields, and agrees with the rendered results. It must not export a revoked approval as usable or an unknown quote as complete.
- Capture browser evidence for currency ambiguity resolved, USD 1,016 stale/over-budget blocked, edit-back still revoked, the USD 980 single commit, and Boston's USD 30 comparison advantage. Report actual engine tests, typecheck/build, and observed browser results with any failures; no unrun checks marked passed.
