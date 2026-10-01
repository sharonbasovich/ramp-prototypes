# Design review — pay-me-twice-concept.png vs rendered app

Compared `pay-me-twice-concept.png` (1536x1024) against live captures in
`docs/screenshots/` (Chrome, 1536x1024 emulation and 390px mobile).

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
  explanatory screen; ours is a dismissible one-line banner. It no longer
  pushes the ledger below the fold: at 1536x1024 the card row starts at
  y≈179 (concept ≈159) and the entire ledger (y≈765→921) is visible.
- **Six scenario buttons vs four** — the spec's attack list (rename, layout,
  changed reference, concurrency burst) plus the two required counterexamples
  (legitimate next-month bill, unreadable scan) need six; the concept's
  four-button grid was expanded.
- **Currency select next to Amount** — the acceptance matrix requires
  currency isolation; the engine enforces per-currency identity and never
  aggregates across currencies.
- **Billing period is a real month input** — any real month (including the
  current one) can be entered, plus a **Not stated** checkbox for the
  no-period case; nothing inherits a sample period.
- **"September 2026" vs "September"** — the contract's explicit-fixture-date
  correction; all dates come from the fixture clock (base: Sep 3, 2026,
  10:14 AM America/New_York).
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

## "Invoice (as received)" evidence rules

- **Sample documents** render the styled paper sheet — a labeled synthetic
  preview of the seeded invoice ("Facts source: sample data").
- **Uploads** show the document's own extracted text verbatim with an
  origin note ("Original text extracted from <filename>. Fields it does
  not state are left blank…"). No address, bill-to, dates, or tax are
  invented for uploaded files, and the panel does not follow editable
  facts — it is source evidence.
- **Unreadable uploads** show the "no text could be extracted" empty state;
  all fact fields start blank for intentional manual entry.
- Upload/manual entry controls live in a collapsed **Upload or enter
  manually** disclosure to keep the card compact.

## Upload safety rules (audit fixes)

- A new document **never retains** prior or sample values for supplier,
  invoice number, amount, currency, or period. Extraction fills only what
  the text states; everything else stays blank and the form says which
  required facts are missing. A total with no currency code leaves
  currency unstated — the user must pick one explicitly; USD is never
  assumed.
- **Pay is blocked until verified**: supplier + invoice number + amount +
  currency must all be present before Validate / Try to get paid / Replay
  can run, with an inline note that missing facts are never backfilled.
- `factsSource` stays honest: extraction-filled fields are "extracted",
  fields the user typed are "manual", and editing extracted/sample facts
  marks the record "document + manual edits" (mixed) — never silently
  relabeled as pure extraction.
- The native PDF reader parses escaped literal strings (`\(`, `\)`, `\\`,
  octal escapes, line continuations, nested balanced parens) across `Tj`,
  `TJ`, and `'` operators, so `Total \(USD\) $17.25` extracts as $17.25.
- Regression coverage: engine + HTTP acceptance tests for the escaped-parens
  total with missing period, incomplete-text extraction leaving fields
  absent, and manually-entered incomplete facts being unpayable.

## Issues found in browser testing and repaired

- Ledger badge printed lowercase `clear` for clear validations → added the
  missing `outcomeLabel('clear')` → "Clear to pay".
- Evidence modal showed "no hash" for hash-matched duplicates → the
  validated facts (with `docHash`) are now persisted into evidence state.
- Fixture timestamps rendered as UTC "2:14 PM" → formatted in
  America/New_York so the ledger reads "Sep 3, 2026, 10:14 AM".
- "Next month's real bill" previously composed on the *current* fields, so
  after the changed-reference scenario it produced `INV-1043A` with no period
  → review instead of clear. It now derives from the seeded invoice and
  always produces INV-1043 / October 2026.
- IBM Plex Sans previously relied on a Google Fonts link → self-hosted.
- Grid items' min-content could force the one-column mobile track wider
  than the viewport (390px → scrollWidth 437 in QA) → tracks are now
  `minmax(0, 1fr)` at every breakpoint.
- The invoice paper's meta row (invoice block + bill-to) overflowed its
  card at 390px → it stacks vertically below 560px.

## Mobile (390px)

Topbar stacks, the workspace goes single-column via `minmax(0, 1fr)` tracks,
fact fields are one column below 560px, all inputs and controls have
`min-width: 0`, the invoice meta block stacks vertically, and the ledger
table scrolls horizontally inside its own card (by design). Verified at a
true 390px viewport: `documentElement.scrollWidth (375) <= innerWidth
(390)` — no horizontal page overflow and no stray inner scrollbars
(`mobile-initial.png`). Screenshots are captured at exact CSS viewport
dimensions (1536x1024, 1366x768, 390x844, device scale reset).

## Known honest limitations (by design)

- Browser-sandbox mode is labeled "this tab only" and disclaims
  cross-device/cross-tab enforcement; only SQLite mode demonstrates real
  concurrent-request defense.
- "Duplicate sandbox payment blocked" is never presented as savings or
  fraud-proofing.
