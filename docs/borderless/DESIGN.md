# Borderless — implementation design

Primary reference: `concept-fx-guard.png` (1536 × 1024), built-in ImageGen. Use native code for text and controls; this image is a reference, not the app background.

One original app, three complete scenarios: Currency Check, FX Guard, True Cost. Deep links use `#check`, `#guard`, `#cost`. Default is FX Guard.

Tokens: warm white #fdfefd, forest ink #082e22, secondary #566360, line #d6dfda, lime wash #f3fce2, primary #194d35. System Segoe UI/Arial sans, tabular money. Main 1404px maximum with 32–66px page margins; 68px navbar. Header centered 48px/1.12 bold, supporting text 25px. Tabs left-aligned with green underline, 20px. Full-width scenario strip. Main two columns 60/40, gap 16px, 8px radius fine border; internal padding 24px. Large money 48px. No hero badges, gradients, floating decoration or sidebar. Ledger below, footer disclosure.

Accuracy correction to reference: before any sandbox commit, label the budget bar “projected debit”, not “spent”. Quote validity is **demo** validity, not a Ramp/provider promise. Footnote: illustrative quotes, no Ramp connection, no payments; browser sandbox is not a shared production budget.

The other tabs reuse this anatomy: scenario strip; 60/40 working form + result; evidence/decision trail. Secondary edit panels may expand below the primary screen to preserve clarity. Every action must work, including reset, validation, approve/invalidate/reapprove/sandbox commit once, native amount resolution, recomputation, audit export. Extra controls must be useful, not inert decoration.

Tab references: `concept-currency-check.png`, `concept-true-cost.png`. Both native 1536 × 1024, built-in ImageGen. The True Cost image invented an unrelated Send/Convert/Pay/Business/Resources navigation; reject that portion and use the canonical FX Guard header and left-aligned tabs across all screens. Its comparison table/result/ledger are accepted. Currency Check uses the canonical 60/40 ratio and header. Do not reproduce invented navigation, gradients or logos. Labels/rendered numbers follow verified engine state when the user edits.
