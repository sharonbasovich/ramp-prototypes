# Borderless — design review

Concept sources (`docs/borderless/`): `concept-fx-guard.png` (canonical chrome),
`concept-currency-check.png`, `concept-true-cost.png`, `DESIGN.md` tokens.
Per the coordinator's correction, the canonical FXGuard header/tabs are used
throughout; only TrueCost's comparison/result/ledger body was adopted — its
invented nav was dropped.

## Canonical chrome (all tabs)

| Element | Concept | Implemented |
| --- | --- | --- |
| Navbar | brand left, "Demo data · no payments" divider, "Reset demo" | ✅ matches |
| Hero | 48px centered title, 25px muted subtitle, per-tab headline | ✅ per-tab headlines |
| Tabs | 20px, left-aligned, green underline on active | ✅ `#check`/`#guard`/`#cost` deep links, `guard` default |
| Scenario strip | full-width muted bar, scenario label + actions | ✅ per-scenario label + reset/edit |
| Split | 60/40 form card + pale-lime result panel | ✅ `grid 3fr 2fr`, `--lime` panel |
| Decision trail | full-width ledger with timestamps | ✅ all tabs + Export audit JSON |
| Footer | honesty disclosure | ✅ "no Ramp connection, no real payments…" |
| Tokens | `#fdfefd`/`#082e22`/`#f3fce2`/`#194d35`, 8px radius, 24px padding, 1404px max | ✅ `styles.css` vars |
| Corrections | bar label "**projected debit**" not "spent" | ✅ bar label + separate *Ledger spent* row showing the actual committed amount |

## FX Guard body

| Concept | Implemented |
| --- | --- |
| Money flow: EUR invoice → expected USD debit | ✅ `EUR 900.00 → USD 980.00` |
| Rows: converted / fee / budget / headroom | ✅ + "Over budget by" (negative headroom, red) |
| Result panel: headroom big number over budget bar | ✅ `USD 20.00` headroom; over-budget shows `−USD 16.00` + red bar at cap |
| Currency attachment rows | ✅ invoice EUR / funding USD / budget USD + quote validity, ledger spent, approval status |
| Buttons: approve / commit / simulate / expire | ✅ + inline "Edit scenario inputs" disclosure (per brief: meaningful edit controls below main display) |
| Honest status line | ✅ status per state: none/current/committed/revoked/stale/expired/over-budget |

## Currency Check body

| Concept | Implemented |
| --- | --- |
| Fixture chips for each invoice case | ✅ 5 fixtures incl. malformed |
| Literal textarea + explicit currency/format selects | ✅ "Choose explicitly…" placeholders |
| Entity + funding account selectors | ✅ Canada/US/GB/DE entities, 4 funding accounts |
| Result states | ✅ Review required / Invoice normalized (big resolved money) / Held / Cannot accept + funding eligibility row |
| Canada USD block with documented reason | ✅ on-screen reason + support.ramp.com link |
| Saved normalized invoice ledger | ✅ below trail |

## True Cost body

| Concept | Implemented |
| --- | --- |
| Comparison table: supplier / original / converted / shipping / fees / total | ✅ native + converted shown separately; winner row highlighted |
| Result panel: USD 30.00 difference | ✅ sticker winner vs complete winner + supplied-costs rows |
| Select lowest complete cost | ✅ snapshot + trail row |
| Editable assumptions | ✅ per-vendor per-charge editors + fixture rate; "unknown" checkbox (never zero) |

## Evidence screenshots (`docs/screenshots/`)

1536×1024: `desktop-guard-seed` · `desktop-guard-approved` · `desktop-guard-committed` · `desktop-guard-simulated-overbudget` · `desktop-guard-edit-back-still-revoked` · `desktop-guard-expired` · `desktop-check-held` · `desktop-check-normalized-blocked` · `desktop-check-preflight-saved` · `desktop-cost-comparison` · `desktop-cost-selected`.
1366×768: `desktop-1366-guard`. Mobile 390×844: `mobile-guard` · `mobile-check` · `mobile-cost` (all verified `scrollWidth ≤ 390`, no horizontal overflow).
