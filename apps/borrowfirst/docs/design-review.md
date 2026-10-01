# Design review — concept vs rendered

Compared `borrowfirst-concept.png` against
`docs/screenshots/desktop-initial.png` (1440px) and `mobile-390.png`.

## Matches

- Header: wordmark + Equipment/Locations nav, active-tab underline, Reset
  demo on the right.
- Hero: "Before you buy it, find what you already own." + supporting line.
- Three-column flow: 1. Your request / 2. Allocate equipment /
  3. Review and reserve, same field set and ordering.
- Baseline vs proposed block: all-new $675, proposed $255 with
  2×transfers + 1×new-monitor breakdown, mint "Potential spending avoided"
  box at $420, amber confirm-availability warning, primary
  "Confirm and reserve" + secondary "Export purchase list" buttons.
- Inventory table: Asset/Type/Size/Ports/Location/Available
  by/Status/Action columns, status chips (green Compatible/In plan, amber
  Owner confirmation required, red Unavailable/Not compatible, gray Too
  late/Reserved), per-row Use/Request/Unavailable actions.
- Palette: white surface, deep green #173A32 accents, mint #E1F1E9
  highlight, warm amber warning, muted ink text.
- Typography: Manrope throughout (vendored via @fontsource — offline-safe).

## Corrections applied on top of the concept (per BUILD-CONTRACT/SPEC)

- **People/Reports nav removed** — both were unimplemented destinations;
  the contract forbids inert nav. Only Equipment + Locations ship, and both
  switch views.
- **M-112 exclusion is evidence-backed** — the concept shows a bare red
  "Not compatible". Rendered UI adds a reason line under the chip:
  "Condition damaged — excluded". A 32" monitor is *not* inherently
  incompatible (M-204 at 27" qualifies); only damage/ports/deadline/
  availability/currency exclude.
- **"Purchase new" toggle starts on** — the concept renders it off while
  still quoting $255 (which assumes the purchase). Ours reflects the true
  plan: on, with an "Example quote" chip marking the price as demo data.
- **Explicit fixture dates** — "Friday" renders as "Friday · Oct 2" and
  arrivals show weekday+time, matching the frozen demo clock
  (2026-09-30 14:00 America/Toronto) instead of ambiguous relative text.
- **Added controls the spec requires**: Import assets (CSV), availability
  filter select, per-row exclusion reason lines, export download.
- **Mode chip in header** — "SQLite server sandbox" / "Browser sandbox"
  with honest scope text; the concept had none.
- **Reason strings are human-readable** — e.g. "Delivery Friday, Oct 2 ·
  12:00 p.m. EDT is after required-by Thursday, Oct 1 · 5:00 p.m. EDT"
  rather than raw ISO.

## Deviations kept (noted, not repaired)

- Concept uses photographic monitor thumbnails; rendered uses a neutral
  inline SVG icon — no external image assets, keeps the build
  self-contained and offline-safe.
- Monitor M-305 shows as "Unavailable (in use)" — matches concept chip;
  its port set differs from the concept's caption but the row is
  unavailable either way, so fixture detail stands.

## Mobile

`mobile-390.png` (390px): single-column stack, controls full width, table
scrolls horizontally, all actions reachable — verified with live browser
interaction, not just a resize.

## Audit-fix pass (October 1)

- Density tightened (header/hero/cards/fields/table) so the full three-card
  flow plus the inventory table fit at 1536×1024: `.table-card` starts at
  y685 (concept ~674), header + 4 inventory rows visible without scrolling.
- `forced-use.png`: quantity 3 with M-102 forced via "Use" — proposed $280
  (M-102 + M-101 + M-204, no purchases), honoring the forced asset and
  reallocating the remainder at minimum cost without overfilling.
- `kitchener-destination.png`: destination → Kitchener re-routes every
  transfer (per-asset, per-destination routes in fixtures), yielding an
  $80 all-internal plan instead of Waterloo's $255.
- `desktop-reserved.png`: post-reserve the confirmed $255 plan stays as
  the primary result while inventory rows correctly flip to Reserved —
  no silent recompute to an all-new $675 proposal.
- Header wraps (nav/mode chip/reset) so 390px has zero horizontal
  overflow (`scrollWidth = clientWidth = 375`).
- Port selector label corrected to "USB-C port" — a USB-C connector is
  not evidence of power-delivery capability, so the option only claims
  the port.
