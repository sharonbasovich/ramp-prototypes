# Borderless — build notes

Status: **complete** on `codex/borderless-builder` (based on
`codex/ramp-borderless` @ b521654 + oracle @ bcdfb57). Ready for root audit +
merge into the suite.

## What ships

`apps/borderless/` — React 18 + Vite + TypeScript static sandbox, three tabs
(`#guard` default, `#check`, `#cost`), plain `node:http` server for `dist/`,
no API/SQLite/secrets. All state is in-browser.

| Piece | Where |
| --- | --- |
| bigint money + half-even convert | `src/engine/money.mjs` |
| strict literal/ISO/format parser | `src/engine/parse.mjs` |
| Canada CAD-funding preflight | `src/engine/route.mjs` |
| approval/commit ledger | `src/engine/guard.mjs` |
| landed-cost comparison | `src/engine/cost.mjs` |
| invoice normalization flow | `src/engine/check.mjs` |
| tabs + chrome | `src/App.tsx`, `src/tabs/*.tsx`, `src/styles.css` |
| static server | `server/serve.mjs` (`npm start` → :5316) |
| oracle test suites | `tests/*.test.mjs` (93 tests) |
| evidence driver | `scripts/cdp-shots.mjs` → `docs/screenshots/` |

## Verification

- `npm run typecheck` — clean
- `npm test` — 93/93 (`node --test`), covers every ACCEPTANCE.md oracle row:
  half-even unlike-exponent FX, all parse holds/rejects (NBSP, decimal comma,
  precision, conflicts), sticky revocation incl. revert-and-attempted-currency,
  expiry boundary T±1ms, single commit + replay, unknown≠zero, sticker-loser
- `npm run build` — clean; `npm start` serves `dist/` on :5316 (base `./`)
- `node scripts/cdp-shots.mjs` — all browser-flow checks green; screenshots in
  `apps/borderless/docs/screenshots/` (1536×1024, 1366×768, 390px — all three
  tabs verified `scrollWidth ≤ 390`)

## Key semantics (auditor anchors)

- Approval fingerprint binds invoice + pair + rate n/d + expiry + fee + budget
  + policyRevision + epoch; commit re-checks fingerprint/expiry/budget/epoch,
  is command-id idempotent, one debit per approval.
- Revocation is sticky: `approval.revoked` survives input revert and
  clock-back; `expiryObserved` is terminal per quote.
- Country ≠ native currency (per correction): the Canada route is a
  funding-currency preflight only — label "funding-currency preflight passed",
  USD funding blocked with documented source, non-Canada "not evaluated".
- Symbols never establish currency; `resolvedCurrency`/`numericFormat` are
  explicit user choices with provenance preserved in the audit export.
- Unknown charge ≠ zero — incomplete quotes block selection; explicit 0 is known.
- DESIGN.md correction applied: bar reads "projected debit"; actual committed
  spend shown separately as "Ledger spent".

## Honesty boundaries (kept)

Fixtures illustrative; not a Ramp quote lock/API/route claim; no tax/compliance
claims; "projected exposure difference is not money saved"; KWD/JPY are generic
precision examples only.

## Known limitations

- Browser-tab state only (per brief — no shared/production budget semantics).
- Edit fields apply on blur/Enter (per fixture-style controls).
