# Ramp private-event demo lineup

These are five separate prototypes, built for the private event Sharon identified. The public Luma event's rules were not applied. Fixture prices and transactions are samples. Use the app's actual mode label when explaining enforcement.

| Prototype | Opening line | Show in 30 seconds | What proves it works |
| --- | --- | --- | --- |
| Cart Tetris | “The cheapest prices made the most expensive cart.” | Start with $101 all-in from one vendor. Split the order to $81.50, inspect the $19.50 difference, then require delivery tomorrow and watch the bargain disappear. Approve and export. | Exact bounded allocation engine, shipping thresholds and delivery constraints; arithmetic visible per vendor. |
| Pay Me Twice | “Can you make this invoice get paid twice?” | Rename or reformat an already-paid invoice: show the duplicate evidence. Send parallel retries: one eligible bill gets one sandbox payment. Show that a genuine next-period invoice still passes. | Normalized facts plus document identity, review for uncertain data, transactional idempotent ledger. |
| BorrowFirst | “You're about to buy something your company already owns.” | Ask for three monitors: $675 all-new versus $255 with two transfers and one purchase. Confirm the asset owner, reserve, then show the frozen $420 potential reduction and remaining shopping list. | Attribute and route matching, owner confirmation, unique reservations and a defensible all-new baseline. |
| Budget Brawl | “Three agents. One budget. Nobody spends the same dollar twice.” | Launch concurrent $60 requests against $100. One holds funds, another awaits funds/approval, and an unauthorized gadget is denied. Approve, commit, replay: $60 spent, $40 available. | Shared transactional ledger with catalog pricing, permissions, expiry and request identities. Actors are scripted. |
| ExitLane | “The meeting was canceled. The bill wasn't.” | Cancel the example off-site: $550 is potentially refundable across linked bookings. Inspect each rule, advance the clock across a cutoff, approve a packet and simulate supplier outcomes. | Structured policy arithmetic, exact UTC cutoffs, stale approval checks and idempotent sandbox outcomes. |

## Picking the live demonstration

Start with **Cart Tetris** when we want an immediately inspectable engine. Let the visitor change the deadline or one price. **BorrowFirst** has the most familiar waste story; show owner confirmation and the final reservation, not just a search result. **Budget Brawl** gives the strongest visible race and permission-control demonstration.

Pay Me Twice works best as a challenge with a clear successful next-period control. ExitLane works best with the deadline visible and a deliberate clock change. Keep the opening short; explain implementation only after the audience has seen the result.

## Claims to keep precise

- Cart and Borrow show potential reductions against comparable sample quotes, not money already recovered.
- Pay blocks duplicate sandbox payments; it does not prove that every fraudulent invoice can be detected.
- Budget demonstrates enforcement through its instrumented sandbox. Browser mode is not proof of server or cross-device enforcement, and the operator sandbox is not a production authentication boundary.
- ExitLane shows estimated refunds until a labeled sandbox provider outcome. It never contacts a real supplier.
- None of the apps is a live Ramp integration or a live AI agent system. The algorithms and the local SQLite transactions are real; vendor data, actors and external actions are samples.

## Event-day check

Use the final per-app DEMO.md scripts and checked source revision. Open the hub, reset only sample data, verify the key flow once, and keep a local build available. Confirm the actual private event's presentation and build requirements before claiming eligibility or submitting an entry.
