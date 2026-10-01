# Pay Me Twice and Budget Brawl — implementation handoff

Prepared for Sharon's private Ramp event. Implementation is authorized now. These are two independent applications in `sharonbasovich/ramp-prototypes`; do not use assumptions about any public Ramp event's build or judging rules.

## Shared constraints

- App ownership: `apps/pay-me-twice/` and `apps/budget-brawl/` only. Root owns repository integration files and the launcher; do not edit other apps or root configuration without coordinating.
- React + Vite; Node 22.14. SQLite enforcement uses built-in `node:sqlite` on the server. Use integer minor currency units, never floating-point currency arithmetic.
- Pay Me Twice is reachable locally on port 5312; Budget Brawl on 5314. The implementation should coordinate its internal API wiring with the root launcher rather than inventing conflicting public ports.
- Each app also runs as a static public demonstration. Every screen makes its current mode visible: **Browser sandbox — this tab only** or **SQLite backend sandbox — transactional ledger**. Do not imply that a browser-only demo proves server enforcement, cross-tab coordination, real card issuance, or actual payment prevention.
- Scripted agents are explicitly labeled. A genuine model integration is optional and must not be claimed if absent. No sponsor credentials, cards, actual purchases, or private financial data are needed.
- Provide a deterministic reset, an initial explanatory screen, understandable verdicts, and a complete 30-second demo. All prices and invoices are clearly marked sample data.

## Pay Me Twice

### Premise and successful experience

**“We already paid this invoice. You have 30 seconds to make us pay it again.”**

The visitor chooses an attack: rename an invoice, change its layout, change its invoice number, or send several payment requests simultaneously. Their attempt receives a precise verdict and visible evidence. The final counterexample is a legitimate recurring invoice that the system allows.

Complete flow: upload/select invoice → inspect extracted facts beside the document → see **clear**, **known duplicate**, or **review required** → approve an eligible sandbox payment → inspect its ledger record. A replay returns the prior result. A document with unresolved extraction or matching ambiguity cannot pay automatically.

### Engine and data

Store invoice records, document hashes, normalized extracted fields, review decisions, payment requests, and a payment ledger. Invoice facts include supplier ID, invoice number, currency, amount in cents, line items, purchase-order reference, and service period. Normalize casing and redundant whitespace; avoid destructive invoice-reference normalization that makes distinct references collide.

- An identical document hash or a paid supplier/invoice identity is a definitive duplicate signal.
- Similar amounts/items with a changed invoice number become a review hold. Similarity alone does not prove a duplicate.
- A legitimate new service period with its own reference must remain payable, including when supplier, line items, and amount are unchanged.
- The backend makes eligibility checking and recording the successful payment one transaction. A database uniqueness constraint on the payable invoice identity and on request IDs provides the final defense against races and retries.
- Native PDF text extraction can assist. For unsupported/image-only documents, ask for editable facts or show review required. Do not silently hallucinate extracted fields.
- AI, if present, extracts or explains; it does not decide authorization. The simplest reliable MVP requires no model.

### MVP versus stretch

MVP: curated invoice variants, accessible upload/select control, editable fact review, three verdicts, visible matching evidence, sandbox approval, transactional payment ledger, concurrency challenge, recurring-invoice counterexample, reset, and mode labels.

Stretch: adversarial uploads, original/generated PDF comparison, human review override with recorded reason, more document formats. Do not spend time on real payment integrations.

### Thirty-second demo

1. 0–5s: “This sample $480 invoice has already been paid.”
2. 5–12s: Visitor chooses and submits a changed invoice.
3. 12–20s: Show the duplicate block or review hold and the fields supporting it.
4. 20–26s: Reset to an unpaid invoice and issue ten concurrent payment requests; exactly one succeeds.
5. 26–30s: Submit next month's legitimate bill: allowed.

Use **“duplicate sandbox payment blocked”** for the impact counter. A review hold is not a proven saving. Do not call the product fraud-proof or claim novelty over established invoice tools; its strong demonstration is interactive adversarial testing plus visible ledger enforcement.

### Independent acceptance-test matrix

Tests should inspect observable verdicts, response identities, and final persisted ledger state. The acceptance suite should construct its own input documents/records rather than importing the application's built-in demonstration scenarios or copying its matching functions.

| Scenario | Independent setup/action | Required observable outcome |
| --- | --- | --- |
| Renamed original | Pay an invoice, then upload identical bytes under another filename | Known duplicate; one payment remains |
| Reformatted identity | Same supplier/reference/currency/amount, reordered whitespace/layout | Known duplicate with cited identity; no second payment |
| Ambiguous changed reference | Same supplier/items/amount but another reference and missing service period | Review required; no automatic payment; no claim that the document is definitively fraudulent |
| Legitimate recurrence | Same supplier/items/amount, distinct reference and next-month service period | Payable; a second legitimate ledger entry exists |
| Unreadable invoice | Image-only or malformed input without verified manual facts | Actionable unsupported/review state; no payment and no invented facts |
| True request race | Twenty independent HTTP requests for one unpaid identity, using distinct request IDs | Exactly one success and one persisted payment; remaining results explain duplicate/conflict |
| Retry | Replay one already-successful request ID | Same payment/result identity; no additional ledger mutation |
| Currency isolation | Two invoices with different currencies | No mixed-currency total or false claim of a comparable aggregate saving |
| Rejected-request conservation | Trigger several duplicate/review attempts | Paid amount and successful-payment count do not change |
| Static disclosure | Run with the API absent | Browser sandbox works; limitation is visible before the concurrency challenge |

## Budget Brawl

### Premise and successful experience

**“Three AI agents share the last $100 on the company card. Who gets to spend it?”**

Agents pursue conflicting shopping tasks while the audience changes the budget, cancels a reservation, or requests an expensive shortcut. All spending is in a sample marketplace. The compelling feature is actual coordination under concurrency, not a spending-limit dashboard.

Complete flow: configure wallet/agent permissions → start independent requests concurrently → reserve funds → approve/reject gated requests → commit purchases → inspect spent, reserved, and available balances. Canceling a reservation releases funds exactly once.

### Engine and data

Maintain wallet, catalog, agent permissions, quotes, reservations, purchase ledger, request IDs, and decision events. The catalog is authoritative. Agents request item IDs and quantities; they cannot assert the price, invent discounts, approve themselves, or raise the wallet's limit.

Use a single database transaction to validate permission, compute the trusted amount, check the wallet, and reserve funds. Preserve the invariant:

`spentMinor + activeReservedMinor <= budgetMinor`

Reservation states are explicit; commit turns reserved into spent, cancel returns funds, and retries return the prior result without performing another transition. Quotes expire. Approval does not bypass either permissions or available funds. An approval waiting for funds is not treated as an active reservation unless funds were actually reserved.

The server must preserve the invariant across independent requests. The static browser implementation can demonstrate the same state machine within one tab; it must not claim cross-client guarantees. Scripted agent personalities are the default. An actual model can propose narrow tool requests if credentials are already available, but model errors cannot control price or authorization.

### MVP versus stretch

MVP: three agent personas, small sample catalog, one shared wallet, actual concurrent HTTP requests in backend mode, reserve/commit/cancel lifecycle, approval threshold, decision timeline, visible balances, reset, and mode/agent labels.

Stretch: a genuine model proposing requests, task priorities, quote changes, multiple wallets, and human assignment of scarce funds. Exclude real Ramp integrations and actual purchases from the initial scope.

### Thirty-second demo

1. 0–5s: “These two agents each want the last $60.” Start with $100.
2. 5–13s: Launch both requests concurrently. One gets a reservation; the other is denied because only $40 remains available.
3. 13–20s: A third agent requests an unapproved $200 gadget; explain the permission or approval decision.
4. 20–26s: Cancel the first reservation. The second agent can now reserve and complete its purchase.
5. 26–30s: Show the ledger: $100 budget, $60 spent, $0 reserved, $40 available.

The impact counter reports prevented over-budget requests and their sample requested amounts. It is not realized company savings. Describe the technical claim precisely: the backend enforces shared spending constraints despite mistaken agent requests.

### Independent acceptance-test matrix

Tests construct their own wallet/catalog/request inputs and inspect API outcomes plus final persisted state. Include a burst from distinct clients, not solely calls to a shared in-process helper.

| Scenario | Independent setup/action | Required observable outcome |
| --- | --- | --- |
| Competing reservations | $100 wallet; twenty parallel $60 requests with distinct IDs | Exactly one active reservation; $40 available; no negative balance |
| Reserve then commit | Reserve $60, then commit it | $60 spent/$0 reserved/$40 available; available is unchanged by commit |
| Replayed purchase | Repeat a successful commit/request ID | Same purchase ID; spent amount unchanged |
| Double cancellation | Cancel a $60 reservation twice | Funds return once; $100 available, never $160 |
| Untrusted price | Request a catalog item worth $60 while supplying a forged $1 amount | Server uses $60 or rejects the untrusted field; no underpriced purchase |
| Negative/invalid quantity | Negative, zero, non-integer, overflow, or unknown item | Clear validation error; wallet/ledger unchanged |
| Approval under scarcity | Approval is pending, another agent consumes funds, then approval occurs | Approval cannot overspend; clear denial/wait state |
| Expired quote | Advance/inject time past quote expiry | Request cannot commit using the expired quote; balances remain conserved |
| Commit/cancel race | Independent concurrent commit and cancel for one reservation | Exactly one terminal transition; either spent funds or returned funds, never both |
| Unauthorized agent | Agent requests forbidden item or modifies another agent's reservation | Denied; no ledger or wallet change |
| Clean reset | Reset while demonstration records exist, then run it again | New session has the configured initial balance; old IDs cannot mutate the new wallet |
| Static disclosure | Run without backend/model credentials | Functional single-tab demo; scripted-agent and browser-mode labels stay visible |

## Definition of ready

Both applications have a complete usable flow, visible data provenance and mode, responsive layout, keyboard-operable controls, an honest demo, working reset, passing independent acceptance tests, and no secret or real-payment dependency. In backend mode, the acceptance evidence must include a persisted ledger inspection after independent concurrent HTTP requests. Root coordinates packaging, deployment, and all integration files.
