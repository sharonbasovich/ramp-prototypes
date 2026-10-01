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
