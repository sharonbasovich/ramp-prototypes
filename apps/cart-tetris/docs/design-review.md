# Design review — cart-tetris-concept.png vs rendered app

Compared `cart-tetris-concept.png` (1536×1024) against
`docs/screenshots/desktop-seed.png` taken at the same viewport.

## Reproduced faithfully

- Top bar: bold "Cart Tetris" wordmark left, "Reset demo" link right, hairline rule.
- Hero: 44px extrabold headline "The cheapest prices made the most expensive
  cart.", muted sub-line, "Import quotes" / "Use example quotes" buttons.
- Left card "Your shopping list" with "Need delivery by" select, item rows
  (name + detail), bordered −/qty/+ steppers, trash actions, "+ Add item",
  full-width primary "Find the cheapest order", "Demo data. No real purchases."
- Right card "Optimized vendor allocation": item × vendor grid, colored chips
  (Bulk Club green, QuickBox blue, North Supply gray), "Vendor order total" row.
- "Cost comparison" card: three stat tiles — "Best single vendor $101.00",
  "Optimized plan $81.50", green "You'll spend $19.50 less" — plus the two
  itemized breakdown tables and "Approve purchase plan" / "Export plan" row.
- Manrope, true-white background, slate palette, blue #2563eb primary, quiet
  card borders; no decorations above the headline.

## Deliberate corrections (required by BUILD-CONTRACT / SPEC-CART)

The generated image contains wrong arithmetic — spec-verified numbers are used
instead:

- Baseline is **QuickBox $101.00** (items $95.00 + $6.00 shipping), not the
  image's "North Supply $101.00 / $81.00 + $20.00".
- Optimized allocation is **Bulk Club: Coffee 4 + Snack bars 5 = $65.00 with
  free shipping** (subtotal ≥ $60.00 threshold) and **QuickBox: Cups 3 =
  $10.50 + $6.00 = $16.50**, total $81.50. The image splits Cups+Bars to
  QuickBox with wrong unit prices.
- Icons that render as tofu on headless/test browsers are inline SVGs.
- Added honest-function elements not present in the image: stale-plan banner,
  infeasibility panel, "Approval void" badge, the editable vendor-quotes grid
  (required for "price edited alters result"), the sandbox-mode footer badge.
- Delivery select offers 1/2/3/5 days so the deadline mechanic is exercisable.

## Responsive / a11y checks

- 390px mobile: single column, steppers/table cells reflow (see
  `mobile-top.png`, `mobile-results.png`).
- Keyboard: all controls are real buttons/inputs with `focus-visible` rings and
  aria-labels; skip-link present; `prefers-reduced-motion` honored.
