# BorrowFirst and ExitLane implementation handoff

The user authorized starting all five Ramp prototypes for a different private Ramp event. Build these two now. Do not depend on the public Luma event's format, judging, or build-window assumptions. These are separate original prototypes inside `sharonbasovich/ramp-prototypes`.

## Ownership and runtime

- BorrowFirst owns `apps/borrowfirst`; its local full-stack server uses port **5313**.
- ExitLane owns `apps/exitlane`; its local development server uses port **5315**.
- Use React, Vite, and **Node 22.14**. BorrowFirst uses Node's `node:sqlite` for local persistence and atomic reservation changes.
- Root owns shared integration files, root package scripts, shared launcher, deployment configuration, and the prototype index. Do not edit those files without coordination.
- Both applications need a self-contained **static in-browser sandbox mode** for the public demo. Display the active mode persistently. A static BorrowFirst demo cannot claim cross-browser or multi-user atomic reservation protection.
- Payments, provider outcomes, inventory, quotes, and refunds in demonstration fixtures must be visibly labeled as examples or simulations. Never initiate real purchases, transfers, cancellations, emails, or refunds.
- No new accounts, secrets, credentials, or paid services are needed for these MVPs. An AI dependency is optional and should not sit on the critical demo path.
- Money is represented as integer minor units with an explicit currency; dates are ISO instants with offsets plus display timezone. No floating-point currency arithmetic or silently mixed currencies.

## BorrowFirst

### Premise and complete flow

**“You are about to buy equipment your company already owns.”** A request becomes a compatible allocation, then a confirmed reservation, then a shopping list containing only the missing equipment.

Demo: request three monitors for Friday. Two confirmed compatible spares cost $15 each to transfer; a new monitor costs $225. With visibly labeled example prices, the all-new baseline is $675 and the mixed plan is $255, a potential $420 reduction. Change the deadline to tomorrow; a remote spare becomes infeasible and the plan updates. Confirm availability and reserve the eligible items. Export one remaining purchase and the transfer instructions.

### Real engine

Filter assets and purchase options by category, explicit compatibility requirements, condition, availability, and arrival deadline. Run an exact assignment search over the small fixture inventory, minimizing feasible purchase and transfer costs. Do not label a heuristic as globally optimal. Assets have unique IDs and can be allocated only once.

Core records:

- `Asset`: ID, category, specifications, location, owner, condition, availability, confirmation timestamp, version.
- `Request`: ID, quantity, minimum specifications, destination, required-by instant, status.
- `PurchaseOption`: compatible specifications, integer unit/shipping costs, currency, delivery instant, quote provenance, expiry.
- `TransferOption`: asset ID, integer cost, earliest arrival.
- `Allocation`: request ID, selected assets and purchases, costs, quote versions, inventory versions, unresolved confirmations.
- `Reservation`: ID, asset ID, request ID, status, expiry, confirmation and transaction timestamps.

In local full-stack mode, reservation creation must revalidate the whole allocation inside one SQLite transaction and commit all required assets together. If any selected asset is unavailable, stale, or already held, reject without a partial reservation and offer recalculation. Expired or released holds stop blocking subsequent requests. Clearly distinguish a suggested allocation, an unconfirmed asset, an active hold, and a confirmed reservation.

### MVP and scope

One equipment category, six to twelve assets, two locations, one or two purchase options, deadline/compatibility controls, owner confirmation, transactional reservations, resettable fixtures, and a downloadable purchase/transfer list. The request screen and allocation board should explain why every item qualified and why excluded items failed.

Stretch: competing request queue, CSV ingestion, multiple categories, richer transfer routing, and reviewed natural-language request parsing. AI may propose editable requirements; code makes compatibility and reservation decisions.

### Savings and limitations

Baseline is the cheapest feasible all-new plan using the same valid quotes, quantities, specifications, delivery constraints, and currency. Potential spending avoided is baseline minus the proposed purchase and transfer costs. Until confirmation and reservation succeed, show **potential spending avoided**. Afterward, show a **confirmed purchasing plan**, not realized savings. If no feasible new baseline exists, or quotes are invalid, display no savings claim. Inventory truthfulness is the primary dependency; an ordinary searchable inventory list is insufficient.

## ExitLane

### Premise and complete flow

**“Canceling the off-site takes one click. Forgetting its bookings costs money.”** Select a canceled event, inspect its linked obligations and current cancellation outcomes, prioritize deadlines, review the policies, approve the packet, execute against labeled sandbox providers, and record each result separately.

Demo: an example off-site has a room, catering order, and equipment rental. The application shows fully refundable, partly refundable, and too-late bookings with itemized arithmetic. Advance the explicitly labeled demonstration clock across a cutoff; one refund shrinks. Reset the clock and approve cancellation requests. Sandbox confirmations appear, while a simulated provider failure remains pending and is excluded from confirmed recovery.

### Real engine

Evaluate reviewed, structured cancellation tiers deterministically. Each tier specifies its exact boundary operator, cutoff instant, cancellation cost, policy version, and source reference. Missing or unsupported rules require manual review; never invent a refund. Recalculate immediately before execution. A changed policy, financial amount, booking status, or expired cutoff invalidates stale approval.

Core records:

- `Event`: ID, start instant, display timezone, linked booking IDs, cancellation status.
- `Booking`: ID, provider, committed total, amount paid, unpaid balance, service time, confirmation reference, version, status.
- `Policy`: ID/version, structured tiers, boundary operators, cutoff instants, source reference, supported flag.
- `Assessment`: applicable tier, expected refund, future charges avoided, extra cancellation charge, net benefit, next cutoff, uncertainty.
- `CancellationRequest`: ID, booking ID, approved booking/policy versions, assessed instant, idempotency key, approval, provider outcome.

### MVP and scope

One event, three to five bookings, fixed or percentage cancellation fees, a deadline timeline, source-backed policy cards, financial breakdown, approval, downloadable request packet, and a resettable sandbox execution flow. Do not send real messages or cancel real bookings. Support success, failure, and retry without double counting. Keep the static public demo entirely functional without credentials or network dependencies.

Stretch: structured CSV import, additional event dependencies, calendar reminder export, and provider-specific draft messages. AI can explain a policy or propose extracted fields, but a person must review those fields before the calculator treats them as authoritative.

### Savings and limitations

For a booking with committed cost `C`, amount paid `P`, unpaid balance `U`, and total cancellation cost `F`, require `C = P + U`. Refund is `max(P - F, 0)`; extra payment is `max(F - P, 0)`; net benefit is refund plus `U` minus extra payment, equivalent to `C - F`. This assumes the structured policy describes the complete remaining obligation.

Label unconfirmed outcomes **estimated recoverable cash** and **estimated future charges avoided**. Provider cancellation confirmation is not proof that cash has reached an account. Keep confirmed cancellation, estimated refund due, and received refund separate. Sandbox confirmations must always remain labeled simulated. Preserve negative benefits instead of rounding them to zero.

## Independent adversarial acceptance matrix

These cases specify expected outcomes independently of implementation. Test through the production engine/API and important user flows; avoid testing a second copy of the same implementation logic. Record which cases pass in local full-stack mode and which are demonstrable in static sandbox mode. The local concurrency cases are mandatory for BorrowFirst's atomicity claim.

### BorrowFirst

| ID | Input or adversarial action | Required independent outcome |
| --- | --- | --- |
| B01 | Three compatible monitors; two spares at $15 transfer each; new monitors $225 each; no extra shipping | Baseline $675, proposed cost $255, potential reduction $420; one purchase and two transfers, not three purchases |
| B02 | A visually identical spare has HDMI only; request requires USB-C power delivery | Exclude the spare and explain the incompatible requirement; matching names do not override specifications |
| B03 | A free remote spare arrives one minute after the deadline | Exclude it even if it would lower cost; show the arrival violation |
| B04 | Two different local clients submit reservations for the same asset simultaneously | Exactly one succeeds; the other gets a conflict and recalculation path; database has only one active reservation |
| B05 | A plan needs two assets; another client takes the second immediately before reservation | Reject the complete plan; the first asset must remain unreserved by the losing request |
| B06 | Inventory version changes after review, including condition changing to damaged | Revalidate and reject stale incompatible allocation; approval alone cannot preserve stale inventory |
| B07 | Hold expires, then a different request tries the asset | New request can reserve it; refreshes or retries do not resurrect the expired hold |
| B08 | Purchase quote expires before approval | Invalidate baseline and savings; require a current quote before presenting a comparable confirmed plan |
| B09 | Request requires five assets, inventory provides two and valid purchase provides three | Return a feasible mixed plan with exact quantity five; no duplicate asset IDs and no unexplained shortage |
| B10 | A purchase price is USD while transfer costs are CAD; no conversion provided | Reject cost aggregation and savings comparison; never quietly treat currencies as equal |
| B11 | A spare is found but owner availability is unconfirmed | Label conditional, keep it out of confirmed reservations until confirmation; no realized-savings claim |
| B12 | Deadline is impossible for every all-new option but internal assets can arrive | Show the feasible internal plan without claiming a numeric reduction against an infeasible baseline |
| B13 | Static demo opened in two browser tabs | Persistently label local sandbox scope; do not claim server-backed multi-user atomicity or guaranteed cross-tab coordination |
| B14 | Reset or export after a confirmed plan | Reset visibly restores fixtures; export matches the displayed plan, costs, missing purchases, and mode label |

### ExitLane

| ID | Input or adversarial action | Required independent outcome |
| --- | --- | --- |
| E01 | `C=$300`, `P=$100`, `U=$200`, `F=$150` | Refund $0, future charges avoided $200, extra payment $50, net benefit $150; do not claim a $200 refund |
| E02 | `C=$200`, `P=$200`, `U=$0`, `F=$50` | Estimated refund $150, extra payment $0, net benefit $150; not confirmed cash recovery before receipt |
| E03 | Cancellation tier uses `now < cutoff`; evaluate one second before and exactly at cutoff | Earlier instant uses that tier; exact cutoff does not; behavior follows the displayed boundary |
| E04 | Two timezone displays refer to the same cutoff instant | Same assessment in both; daylight-saving display differences do not change the instant or apply a tier twice |
| E05 | Review at a refundable instant; advance clock beyond cutoff; attempt execution | Stale approval rejected and updated assessment shown before any sandbox provider action |
| E06 | Provider fails after approval | Booking stays failed/pending; neither confirmed canceled total nor received-refund total increases |
| E07 | Repeat the same approved request, then retry a failed provider | Idempotency prevents duplicate cancellation and double counting; retry preserves the request history |
| E08 | Policy absent, unsupported, or contradictory | Manual review required; no automatic refund figure or executable cancellation request |
| E09 | `C=$100`, `P=$20`, `U=$80`, `F=$130` | Refund $0, extra payment $110, net benefit -$30; show the negative result and require attention |
| E10 | Financial input has `C != P + U`, negative paid amount, or mixed currency | Reject invalid assessment with a specific explanation; do not manufacture a balancing amount |
| E11 | Booking already canceled before the event-wide action | Exclude repeat execution; preserve its previous outcome without counting it a second time |
| E12 | Policy version or booking cost changes after approval | Approval invalidated even if clock has not changed; updated source and arithmetic require review |
| E13 | Export a packet containing confirmed, failed, unsupported, and not-yet-approved bookings | Export distinguishes every state, estimates, provider outcome, policy version, timestamp, and sandbox mode |
| E14 | Simulated cancellation succeeds but no refund receipt is recorded | Show simulated cancellation confirmed and estimated refund due; received cash remains zero |

### Shared demonstration quality checks

| ID | Action | Required outcome |
| --- | --- | --- |
| Q01 | Fresh page load with network disconnected after static assets load | Main fixture workflow completes in sandbox without AI, provider credentials, or external data requests |
| Q02 | Visitor looks at the screen for five seconds | Problem, active mode, next action, and whether money is estimated or confirmed are readable without explanation |
| Q03 | Run the 30-second demonstration twice | Reset produces the same starting state; arithmetic and displayed outcomes remain reproducible |
| Q04 | Inspect client bundle, exports, fixture JSON, console, and screenshots | No secrets or invented personal records; no claim of real payment/refund/cancellation in the sandbox |
| Q05 | Direct link to either app from the root prototype index | Correct isolated app loads; page refresh and assets work under its deployment base path |
| Q06 | Keyboard-only operation and narrow viewport | Required fields, approval, conflicts, reset, and export remain usable; status changes are announced accessibly |

## Delivery evidence requested from builders

Return the commit SHA, local run command, exact app URL, completed acceptance IDs with meaningful evidence, remaining limitations, and a 30-second demo script. Include at least one screenshot of the normal flow and one of the strongest failure/conflict state. State explicitly which money and provider outcomes are simulated. Do not report a prototype as deployed, externally connected, or financially effective without verification.
