# Private Ramp prototype suite — final review

Reviewed October 1, 2026 on Windows, Node 22.14.0. These are five separate prototypes for Sharon's private event. No public Luma event rules or eligibility were inferred, and no event submission was made.

## Verified implementation

| Prototype | Audited implementation | Passing tests | Main demonstration |
| --- | --- | ---: | --- |
| Cart Tetris | eb0122d | 48 | $101 single-vendor baseline → $81.50 split order; one-day delivery restores $101. |
| Pay Me Twice | a0b08c7 | 41 | An already-paid invoice is blocked; a genuine next-period bill can receive one sandbox payment. |
| BorrowFirst | df48f9e | 47 | Three monitors: $675 all-new → $255 with two transfers and one purchase, after owner confirmation. |
| Budget Brawl | 0e5e7b7 | 35 | Two concurrent $60 requests against $100: one holds funds, another stays pending; $200 unauthorized item is denied. |
| ExitLane | 7fd9f56 | 40 | $550 estimated cash refund before the room cutoff → $150 afterward; failed provider attempts can be retried only against valid approval. |

The final integrated checkout passed **setup, typecheck, 211 tests and production build across all five apps**. Full logs are retained locally in `output/ramp-handoff/final-checks/`. The root launcher started all five servers; each health endpoint reported SQLite. Separate retained HTTP probes verified idempotency, concurrent requests, restart persistence, quote expiry and stale approvals. Independent reports preserve historical defects and identify the repaired revision at the top; those historical sections are not current failures.

## Real-browser review

Codex's in-app browser verified the local SQLite flows and the Pages-style browser fallback. Native desktop review used 1536×1024; laptop checks used 1366×768, and mobile checks used 390×844. Tables may scroll inside their own containers; none of the five pages had horizontal document overflow in the checked mobile state. Desktop workflows remain reachable on a smaller laptop with ordinary vertical scrolling.

The five ImageGen concepts were created before implementation and compared with the implemented screens. The review used five points: page composition, typography/color, control grouping, result hierarchy and responsive behavior.

| App | Composition | Typography/color | Controls | Results | Responsive review |
| --- | --- | --- | --- | --- | --- |
| Cart | Left request, right allocation, lower cost comparison retained. | White/navy/blue and Manrope retained. | Deadline, quantities and approval are usable in the main flow. | Vendor costs and $19.50 potential reduction stay inspectable. | Primary actions visible on laptop; mobile stacks without document overflow. |
| Pay | Three panels and lower ledger retained; cards begin near the concept's top third. | Lavender/plum/purple, Plex Sans/Mono retained. | Extra adversarial scenarios added; month/year wraps instead of clipping. | Evidence and payment result remain adjacent; uploaded source is actual extracted text, not invented sample details. | Laptop may scroll to ledger; mobile stacks without document overflow. |
| Borrow | Request, allocation, review and equipment inventory retained. | White/green/mint and Manrope retained. | Owner confirmation and destination are explicit. | Confirmed plan is frozen at $255 instead of recomputing from already-reserved stock. | Desktop inventory and review visible; mobile stacks without document overflow. |
| Budget | Shared budget, three lanes and timeline retained; final width aligns with the wide concept. | Navy/cobalt/yellow and Plex Sans retained. | Launch moved above lanes; advanced catalog/TTL controls collapse below the ledger. | Held/spent/available amounts are separate; pending requests are not called savings or denials. | Main flow fits at 1536; smaller laptop uses vertical scrolling; mobile has no document overflow. |
| Exit | Blue clock strip, timeline/bookings and right summary retained, expanded from the narrow initial build. | White/navy/orange and Manrope retained. | Clock/cutoff, policy review, approval and retry are exposed. | Remaining potential, approved estimate, simulated confirmations, refund due and received cash are separate. | All five example bookings are inspectable at 1536; smaller screens scroll vertically without document overflow. |

Intentional departures from generated concepts correct their unsupported claims: actors are scripted rather than live AI; an approval threshold does not itself deny a purchase; dates are explicit fixtures; no requests are described as sent before sandbox execution; quotes require supplied currency and validity; potential reductions are not realized savings.

## Scope and practical limits

- Public Pages uses a clearly labeled **Browser sandbox**. It runs the same business rules but does not prove server or cross-device enforcement. Persistence uses each app's documented browser store.
- Local servers use actual SQLite transactions. Budget's operator sandbox is not production authentication between hostile agents.
- Data, suppliers, actors and external provider outcomes are samples. No real orders, charges, refunds, reservations, emails or cancellations occur. No live Ramp API or model is connected.
- Cart is a bounded optimizer; unsupported import sizes and expired quotes are refused. Some refusal feedback can be clearer.
- Pay supports explicit invoice facts and limited native PDF/text extraction; unreadable or incomplete documents require manual review. A three-letter currency key does not imply conversion support.
- Borrow needs current sample quotes, owner confirmation and compatible routes; reservation holds are temporary.
- Exit estimates only supported structured policies. Unreadable terms go to manual review; estimated refunds are not promised cash.

Use `RAMP-DEMO-LINEUP.md` and each app's `DEMO.md` for the opening hook and demonstration. Confirm the actual private event's rules and presentation format before selecting or submitting an entry.
