# Design review — pay-me-twice-concept.png vs rendered app

Compared `pay-me-twice-concept.png` (1536x1024) against live captures in
`docs/screenshots/` (Chrome, 1536x1024 and ~390px mobile emulation).

## Faithful

- **Composition:** quiet brand header + "A safer way to handle supplier
  payments", right-aligned "Sandbox mode … / No real payments." note and an
  outlined **Reset sandbox** button; large headline "Pay once, even when a
  request arrives twice."; three-column workspace (Invoice details / Invoice
  as received / verdict); full-width **Sandbox payment ledger** with
  green-check counter; two-part footer.
- **Palette:** light lavender `#F7F6FD` page, dark plum `#2B174D` ink,
  `#7346C3` purple accents, muted red duplicate state, green recorded state,
  amber review state.
- **Type:** IBM Plex Sans (+ Plex Mono for hashes/IDs), self-hosted via
  `@fontsource` so it also works offline and on GitHub Pages.
- **Anatomy:** editable invoice fields, 2-column scenario grid, primary CTA,
  paper-style invoice sheet with supplier block / INVOICE / bill-to /
  item table / totals, verdict card with evidence rows and **Inspect
  evidence**, ledger table with pill result badges.

## Deliberate differences (functional, documented in BUILD-CONTRACT §Design)

- **Intro banner** ("The challenge…") — the spec requires an initial
  explanatory screen; ours is a dismissible banner. It pushes the ledger
  below the fold at 1536x1024; dismissing it restores near-concept height.
- **Six scenario buttons vs four** — the spec's attack list (rename, layout,
  changed reference, concurrency burst) plus the two required counterexamples
  (legitimate next-month bill, unreadable scan) need six; the concept's
  four-button grid was expanded.
- **Currency select next to Amount** — the acceptance matrix requires
  currency isolation; the engine enforces per-currency identity and never
  aggregates across currencies.
- **"September 2024" vs "September"** — the contract's explicit-fixture-date
  correction; all dates come from the fixture clock.
- **Stats line** — "N payments recorded · M duplicate sandbox payments
  blocked · K held for review" with the spec-required disclaimer that
  blocked duplicates are prevented repeats, not measured savings (concept's
  "9 retries returned the same result" is absorbed into this).
- **Result pills vs dot icons** — readable verdict badges ("Payment
  recorded" / "Duplicate blocked" / "Review required" / "Clear to pay" /
  "Unsupported document") instead of color dots; clearer for a11y.
- **Ledger notes** — carry actor + request context ("Blocked — already paid
  as PAY-0002 · actor Tab K9G · req 2") instead of "Retry N"; the evidence is
  more precise. Retry ordering still matches the concept's shape.
- **Duplicate icon** — `⊘` in a filled circle rather than `!`; the pink
  blocked treatment is kept.

## Issues found in browser testing and repaired

- Ledger badge printed lowercase `clear` for clear validations → added the
  missing `outcomeLabel('clear')` → "Clear to pay".
- Evidence modal showed "no hash" for hash-matched duplicates → the
  validated facts (with `docHash`) are now persisted into evidence state.
- Fixture timestamps rendered as UTC "2:14 PM" → formatted in
  America/New_York so the ledger reads "Sep 3, 2024, 10:14 AM" as intended.
- "Next month's real bill" previously composed on the *current* fields, so
  after the changed-reference scenario it produced `INV-1043A` with no period
  → review instead of clear. It now derives from the seeded invoice and
  always produces INV-1043 / October 2024.
- IBM Plex Sans previously relied on a Google Fonts link → self-hosted.

## Mobile (390px)

Topbar stacks, cards go single-column, the ledger table scrolls horizontally
inside its card, all controls remain reachable and keyboard-operable.
(`mobile-initial.png` is captured at 420 CSS px because the test box's window
has a minimum width; layout is identical at 390.)

## Known honest limitations (by design)

- Browser-sandbox mode is labeled "this tab only" and disclaims
  cross-device/cross-tab enforcement; only SQLite mode demonstrates real
  concurrent-request defense.
- "Duplicate sandbox payment blocked" is never presented as savings or
  fraud-proofing.
