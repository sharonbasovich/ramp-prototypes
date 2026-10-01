# Design fidelity ledger — ExitLane vs `exitlane-concept.png`

## Matched

| Concept element | Implementation |
| --- | --- |
| Manrope typeface, white background, navy header text, orange primary action, light-blue toolbar strip | `src/styles.css` tokens; `index.html` loads Manrope |
| Header: product mark + "Reset demo" | `Header.tsx` — brand mark, mode badge, Reset demo button |
| Headline: "The off-site was canceled. The bills weren't." | `App.tsx` hero |
| Toolbar: event select, "Cancel event" CTA, demo-clock datetime input, timezone, steppers | `Toolbar.tsx` — adds `+1h` / `+1d` / `Past room cutoff` clock steppers |
| Horizontal timeline: booked → canceled ("We're here") → processing → confirmations → final refunds | `Timeline.tsx` — five engine-driven nodes |
| Bookings table: Service \| Amount paid \| Cancellation fee \| Estimated refund \| Policy \| Status \| Action | `BookingsTable.tsx` — plus sublines for avoided charges / extra due / request state |
| Right column: Cancellation summary card | `SummaryCard.tsx` — cash vs avoided charges kept on separate lines |
| Right column: Provider confirmations card | `ConfirmationsCard` in `SummaryCard.tsx` — outcome rows with attempt history |
| Bottom: "Policy evidence and approval" banner + packet preview | Evidence banner in `App.tsx`; `PacketModal.tsx` preview table |
| Footer disclaimers (sample data, estimates, sandbox) | Footer + summary-card note + export `sandboxNotice` |

## Deliberate corrections (concept errors fixed)

| Concept issue | Correction |
| --- | --- |
| Provider confirmations rendered as if requests were already sent before execution | Confirmations card shows "not sent yet — sandbox" pre-state; nothing claims sent until a scripted outcome is recorded |
| Generated dates floated to the current date | All instants are fixture-bound UTC (`2025-04-25T14:00:00Z` demo clock); the demo clock is the only time source |
| Room cutoff ambiguous vs. the default clock | Room cutoff fixed to Fri 12:00 PM Toronto (`2025-04-25T16:00:00Z`, 24 h before Sat-noon check-in) so the default 10:00 AM clock is refundable and clock-advance demos the boundary crossing |
| "Amount paid" alone hides avoided future charges | Shuttle booking carries $40 paid / $140 unpaid so cash refund and avoided charges are visibly separate figures |

## Deviations

- Added columns' second line (policy tier, stale warnings) to make the
  stale-approval mechanic visible in the table itself.
- Details modal adds the full evidence surface (tier table, boundary operator,
  UTC + Toronto cutoff, request history, provider attempts) the spec requires.
- Mobile (<560px): toolbar wraps, cards stack, the bookings table scrolls
  horizontally inside its container; zero page-level overflow.
- Compaction pass (root visual audit): content widened toward the concept's
  ~1472px band, header/hero/toolbar/timeline/table rows/summary compacted,
  toolbar kept to one horizontal strip (timezone and clock controls wrap below
  it at narrow widths), and the Activity log moved into a collapsed
  `<details>` so all five bookings plus the summary and approval controls fit
  a 1536x1024 viewport.

## Measured geometry (post-compaction, emulated viewports)

| Metric | Concept | 1536x1024 actual | 1366x768 actual |
| --- | --- | --- | --- |
| Content band | x32, w1472 | x32→1489, w1457 (native 15px v-scrollbar; w1472 without it) | x32→1334 |
| Toolbar | single horizontal strip | single strip, y176–234, all controls on one row | single strip |
| Timeline card top | y272 | y248 (~24px higher — tighter header) | y293 |
| Bookings table bottom | y878 | y945 — all 5 rows above the fold | rows 1–2 fully visible; Equipment+ below fold (scrollH 1216) |
| Summary card | visible | y248–709, fully above fold | y293–755, fully above fold |
| Below fold | — | evidence banner, footer (~128px) | Equipment row bottom, Shuttle+Decor rows, confirmations, activity, banner, footer |

Mobile 390px: `docScrollW === innerWidth` — zero page-level overflow; only
internal horizontal scrollers (table wrap, one timeline label).

Screenshots: `docs/screenshots/desktop-initial.png` (exactly 1536x1024),
`desktop-1366.png` (exactly 1366x768), `mobile-initial.png` (390px @2x),
plus `desktop-packet-executed.png` / `desktop-stale.png` /
`desktop-failure-retry.png` / `desktop-booking-details.png` /
`desktop-clock-advanced.png` state shots.
