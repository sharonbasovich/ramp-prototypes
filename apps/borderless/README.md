# Borderless

A static, browser-only sandbox demonstrating explainable currency controls for
cross-border bill pay — built for a private Ramp event. No API keys, no real
payments, no server-side state: every scenario runs entirely in your browser
tab against illustrative fixtures.

Three scenarios behind tabs (`#guard` is the default):

| Tab | Scenario | The point |
| --- | --- | --- |
| **Currency Check** `#check` | A `$1,250.00` invoice arrives with no ISO code | A symbol never establishes a currency — the app holds the invoice until you resolve the ISO code and numeric format explicitly, then runs a documented funding-currency preflight |
| **FX Guard** `#guard` | EUR 900.00 invoice, USD 1,000.00 budget, demo quote 1 EUR = 1.08 USD + USD 8 fee → USD 980.00 projected debit | An approval binds the exact snapshot (invoice + pair + rate + expiry + fee + budget + policy revision); an FX move to 1.12 (USD 1,016.00) or an expired quote revokes it permanently, and commit posts exactly one sandbox debit |
| **True Cost** `#cost` | Berlin EUR 850.00 → USD 935.00 + USD 90 ship + USD 25 fee = USD 1,050.00 vs Boston USD 1,000.00 + USD 20.00 = USD 1,020.00 | The cheapest sticker price loses once conversion, shipping and fees are included — USD 30.00 more expensive — and an unknown charge blocks selection instead of silently counting as zero |

## Run it

```bash
npm install
npm start          # serves dist/ on http://localhost:5316 (plain node:http, no API)
```

Development:

```bash
npm run dev        # vite dev server on :5316
npm run typecheck  # tsc --noEmit
npm test           # node --test tests/*.test.mjs — engine oracle vectors
npm run build      # vite build → dist/ (base './', deployable to Pages)
node scripts/cdp-shots.mjs   # headless-Chrome evidence capture → docs/screenshots
```

## Engine

`src/engine/*.mjs` — plain JavaScript modules imported by both the React app
and `node --test`, so the tested code is the shipped code.

- `money.mjs` — integer minor units as `bigint` (USD/CAD/EUR/GBP exponent 2,
  JPY 0, KWD 3). Money JSON = `{currency, minor: "<decimal string>"}`. Rational
  rates `{n, d}` bound to a direction; conversion is `m·n·10^t / (d·10^s)` with
  a single deterministic half-even rounding step. No `Number`/`float` money
  math, no mixed-currency arithmetic.
- `parse.mjs` — strict literal parsing: ISO code scan (conflicts reject),
  symbols only *narrow to candidates* (never establish currency), explicit
  en-US / de-DE / fr-FR formats (incl. NBSP + narrow-NBSP grouping), excess
  precision / signs / exponents / garbage reject.
- `route.mjs` — funding-currency preflight. Canadian Bill Pay requires CAD
  funding (documented source); a Canadian USD account is **blocked**, a CAD
  account returns *"funding-currency preflight passed"* (a simplified verified
  fixture, **not** a complete eligibility verdict); non-Canada entities get
  *"not evaluated"*.
- `guard.mjs` — quote approval ledger: fingerprint-bound snapshot, 2-minute
  DEMO validity, sticky revocation (reverting an edit never restores the
  approval), command-id idempotency, exactly one debit per approval.
- `cost.mjs` — landed-cost comparison: converts non-reporting components at
  the fixture rate, sums known charges, ranks complete quotes; an unknown
  charge is *not* zero and blocks selection.
- `check.mjs` — invoice normalization workflow: literal + explicit ISO +
  explicit format → parse → route preflight → save normalized record only when
  both pass.

## Honesty boundaries

- Fixture rates, quotes and charges are **illustrative** — this is not a Ramp
  quote lock, Ramp API, or claim about Ramp route availability.
- "Projected exposure difference is not 'money saved'"; totals are estimates
  computed from the supplied assumptions shown on screen.
- KWD/JPY appear only as generic high/low-precision currency examples — never
  as claims about Ramp's supported payout routes.
- The Canada CAD result is a funding-currency preflight on a simplified
  verified fixture — not a tax, compliance, or eligibility verdict.
- Every scenario exports honest JSON audit evidence (native + converted
  amounts, rate direction, timestamps, decisions, provenance) — export buttons
  on each decision trail.
