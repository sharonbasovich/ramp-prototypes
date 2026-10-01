# Design review — concept vs rendered

Reference: `budget-brawl-concept.png` (root). Rendered evidence:
`docs/screenshots/`.

## Matches

- Composition: quiet header (title + Reset sandbox), headline "Three agents.
  One budget. Nobody spends the same dollar twice.", single budget strip
  (editable budget + approval threshold, Budget/Spent/Reserved/Available
  stats, segmented bar), three vertical agent lanes, primary "Launch
  simultaneous requests" + "Replay duplicate request", authoritative
  transaction timeline with per-row actions, footer pair.
- Palette: true white `#FFFFFF`, navy `#172C55`, cobalt `#134ECB` primary
  button, warm yellow `#F3C849` reserved segment.
- Type: IBM Plex Sans with system fallbacks.
- Controls: selects, inputs, textareas, buttons — all code-native, all
  keyboard-operable; timeline scrolls inside its container on narrow screens.

## Deliberate corrections (required by BUILD-CONTRACT / spec)

- Lane chips say "scripted agent"; footer and subline say scripted agents —
  the concept's unqualified "AI agents" is not claimed.
- **Ben's insufficient-funds case** is rendered as "Awaiting approval · no
  funds held" — because a request above the approval threshold pends approval
  rather than being denied, even when funds don't fit. The detail text
  explains "$60 is above the $50 threshold and only $40 is available."
- **Cleo's "Not permitted"** now correctly reports a *permission-scope*
  denial ("Denied for permission scope, not for amount"). The concept's copy
  ("Exceeds approval threshold of $50") was the required functional fix.
- Added elements beyond the concept, all functional: mode badge (SQLite
  backend sandbox vs Browser sandbox — honesty requirement), Quote TTL
  input (spec's quote-expiry surface), per-lane "Send request" buttons
  (needed for the cancel→retry beat of the demo), "Prevented over-budget
  requests" impact line (spec's impact counter, labeled sample amounts),
  collapsible sample-catalog price editor (spec's editable-catalog surface).
- Status chips keep the concept's amber/red visual language but distinguish
  committed (green) and add explicit detail text per state.

## Differences accepted

- Concept bar labels "…reserved/…available" are preserved; a spent segment
  (navy) was added since the live invariant needs it.
- Screenshot viewport tested at ~1536x1024 and 390px emulation; 1366x768
  layout verified by the same responsive rules (strip wraps, lanes stack).

## Known minor

- On very narrow widths the mode badge + Reset wrap onto a second header
  line rather than overflowing (fixed during review).
