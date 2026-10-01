# Borderless: Ramp research and demo rationale

Verified against public primary Ramp sources on **October 1, 2026**. Borderless is an independent prototype with synthetic scenarios. Its controls and recommendations are product hypotheses, not evidence of defects in Ramp or claims about private event requirements.

## Recommendation

Lead with **FX Guard**, then demonstrate **Currency Check** and **True Cost** in the same app. FX Guard has the strongest connection to a documented Ramp payment behavior and an immediately understandable interaction: an invoice stays the same while the amount needed to fund it changes. Currency Check supports confidence in the inputs. True Cost broadens the story from a payment estimate to a purchasing decision.

The central pitch is: **“Before money moves, know exactly what you are paying, what changed since approval, and which offer is cheaper after every cost.”**

## What Ramp already does

Ramp is already an international finance platform. Do not pitch international payments, local cards, approval workflows, receipt extraction, automatic accounting, or a currency dropdown as inventions.

- **UK availability is current:** Ramp announced its UK launch on September 15, 2026, including cards, expenses, bill payments, and accounting automation. The March 2026 Europe announcement described future UK/EU availability. No equivalent official EU-wide launch announcement was located during this research, so use the current UK announcement and product-specific eligibility documentation instead of claiming uniform European availability. [UK launch](https://ramp.com/blog/uk-launch), [March Europe announcement](https://ramp.com/blog/ramp-is-launching-in-europe)
- **Global reach is product-specific:** Ramp's global page advertises local cards in 30+ countries and vendor payments to 185+ countries. Those counts do not mean every product, funding currency, entity, or accounting connection is supported everywhere. [Ramp Global](https://ramp.com/global/)
- **Local bank funding already exists:** Enterprise international Bill Pay supports CAD, GBP, and EUR funding accounts. Entity verification is required before payment; drafts and bank linking can precede it. Ramp already selects local versus international transfers using funding and payout currencies. [International debiting](https://support.ramp.com/international-debiting-on-ramp-bill-pay-overview)
- **Canadian Bill Pay has a specific funding rule:** It requires CAD funding. Canadian-domiciled USD accounts cannot currently fund Bill Pay, even though USD-invoiced bills can be paid from CAD accounts. Domestic CAD EFT has no additional fee. [Canadian Bill Pay](https://support.ramp.com/bill-pay-for-canadian-businesses/)
- **European eligibility varies by product:** PLN, SEK, and DKK issuing and eligible local reimbursements exist. Those currencies are not Bill Pay funding-account currencies. EUR entity eligibility also differs among cards, reimbursements, and Bill Pay. [EU/UK entity verification](https://support.ramp.com/eu-uk-entity-kyb-kyc-checks/)

## Keep the currency domains separate

| Domain | Meaning | Public Ramp behavior relevant to the prototype |
| --- | --- | --- |
| Entity currency | The currency configured for an entity or its financial/accounting context | An entity setting is not proof that a payment corridor or bank source is supported. |
| Card issuing / statement currency | The denomination of the issued card and statement balance | Original merchant and statement amounts can differ; Ramp makes both available. |
| Spend-limit currency | Currency used for an employee's limit or Spend Program | Amount and maximum-transaction controls follow the spend-limit currency. |
| Policy threshold currency | Currency used to evaluate a monetary policy threshold | Ramp documents USD evaluation for monetary approval/submission thresholds in multi-currency spend. |
| Invoice currency | Currency of the vendor obligation | Ramp fixes it when a bill is created; correcting it requires a new bill. |
| Funding currency | Currency debited from the company's eligible source | This can differ from invoice and vendor payout currencies. |
| Payout currency | Currency sent to the vendor's destination account | This and the source currency determine whether FX is involved. |
| Accounting / functional currency | Currency used in the ledger or accounting sync | Behavior depends on the accounting provider and sync settings. |

The first four rows concern cards and spend controls; the invoice/funding/payout rows concern Bill Pay. Ramp explicitly says **Local Currencies settings do not control Bill Pay**. [Multi-currency funds, cards, and Spend Programs](https://support.ramp.com/multi-currency-funds-cards-and-spend-programs), [International overview](https://support.ramp.com/international-overview/), [International transfers](https://support.ramp.com/international-transfers-on-ramp-bill-pay)

Card settlement is another capability surface: locally funded statements use eligible CAD/EUR/GBP bank accounts, while linked-account automatic payment is unavailable for AUD/JPY/MXN/SGD statements. Conditional wire paths exist. Do not copy Bill Pay eligibility rules into card-statement payment logic. [Locally funded statement payments](https://support.ramp.com/locally-funded-statement-payments/)

## 1. FX Guard — lead demonstration

**30-second pitch:** “You approved the same €900 invoice for an estimated $980. The funding estimate is now $1,016. Borderless detects that your $1,000 ceiling is exceeded and makes the earlier approval stale before you proceed.”

### Synthetic scenario

Both rates below mean **USD per EUR**. The USD 8 fee and USD 1,000 budget are demo inputs, not Ramp pricing or a private Ramp policy.

| State | Calculation | Estimated USD funding cost | Budget result |
| --- | --- | ---: | --- |
| Initial estimate | EUR 900 × 1.08 + USD 8 | 980.00 | USD 20.00 below budget |
| Refreshed estimate | EUR 900 × 1.12 + USD 8 | 1,016.00 | USD 16.00 over budget |
| Change | 1,016.00 − 980.00 | 36.00 | Earlier approval becomes stale |

Show the fixed vendor obligation, rate direction, fee currency, estimate timestamp, and approval basis together. Tie approval to a version of the full payment plan. Changing the quote, fee, funding source, invoice, or budget invalidates the prototype's earlier approval. An expired quote should require refresh; refreshing alone should not restore approval.

**Why this is relevant to Ramp:** Ramp documents that the pre-initiation exchange rate is an estimate and the applied rate is determined at payment initiation. This supports the importance of showing changed funding cost. It does not establish that Ramp lacks an approval safeguard. [International transfers](https://support.ramp.com/international-transfers-on-ramp-bill-pay)

**Quote validity:** No public Ramp FX quote-expiry duration was found. Any prototype timeout must be labelled as a demo rule. A production integration would use an authoritative provider-returned expiry and quote identifier if available, and would distinguish an estimate from a guaranteed rate.

**Value claim:** The fixture detects USD 36 of estimate movement and USD 16 of budget excess. Neither number is realized savings. Avoid “we saved $36” or “Ramp would have paid an unauthorized invoice.” Suitable measurements are changed plans detected, approval invalidations correctly enforced, and time to explain the cost change.

## 2. Currency Check — confidence before bill creation

**30-second pitch:** “An invoice says `$900`. That is not enough information to know whether it means USD, CAD, or AUD. Borderless asks for an ISO currency, parses the supplied locale, and checks the proposed funding account before a bill is created.”

The prototype should require a supported, explicit ISO currency whenever the symbol is ambiguous. Locale controls how an amount is parsed; it does not authorize guessing its currency. Keep the original source text visible, reject conflicting currency indicators, and use the selected currency's supported minor-unit precision. Arithmetic should operate on exact amounts rather than floating-point display strings.

Demonstrate two separate findings:

1. Resolve an ambiguous `$` to an explicitly selected currency; show the normalized amount and the source evidence.
2. For the synthetic Canadian Bill Pay configuration, block a Canadian-domiciled USD source and explain that CAD funding is required. Selecting CAD funding can permit a USD-invoiced bill; the invoice is not silently redenominated.

**Why this is relevant to Ramp:** Invoice-currency selection matters before creation because it cannot subsequently be edited in Ramp. The Canadian funding restriction is a documented capability rule. [International transfers](https://support.ramp.com/international-transfers-on-ramp-bill-pay), [Canadian Bill Pay](https://support.ramp.com/bill-pay-for-canadian-businesses/)

**Hypothesis:** An explicit currency interpretation and a source-linked capability explanation can reduce correction work. The prototype does not demonstrate that Ramp's OCR misreads symbols, that its UI permits invalid funding, or that these exact checks are absent.

**Value claim:** Measure time to resolve inputs, ambiguous cases correctly withheld, and manual corrections avoided in a defined test set. “100 bills × 3 minutes = 5 hours” is a workload estimate only if the three-minute baseline is stated or measured; it is not an observed customer result.

## 3. True Cost — compare complete purchasing costs

**30-second pitch:** “The European offer looks cheaper at €850. After conversion, shipping, and fees, it costs $1,050. The US offer totals $1,020. Borderless makes the $30 difference visible before purchase.”

### Synthetic scenario

| Offer | Calculation | Estimated USD total |
| --- | --- | ---: |
| European vendor | EUR 850 × 1.10 USD/EUR + USD 90 shipping + USD 25 fee | 1,050.00 |
| US vendor | USD 1,000 + USD 20 shipping | 1,020.00 |
| Difference | 1,050.00 − 1,020.00 | 30.00 |

Every rate, shipping charge, fee, and offer in this fixture is synthetic. Show all included components and mark unknown components as incomplete. Do not call a comparison “complete” when duties, taxes, or other material costs are unknown. The prototype is a purchasing comparison hypothesis; it does not claim that Ramp lacks procurement or vendor intelligence.

**Value claim:** USD 30 is the illustrated avoidable incremental cost under the supplied assumptions. It becomes realized savings only after the buyer selects the less costly equivalent offer and final costs confirm the estimate. Differences in product specifications, delivery dates, service terms, and quality must remain visible rather than being collapsed into price alone.

## Integration assumptions and scope

- The demo runs on fixtures and makes no payments. None of its rates is live, executable, or guaranteed.
- Bill metadata would need explicit invoice currency, vendor payout details, entity ownership, source-account country/currency, and product eligibility. Authentication and actual account capabilities would be authoritative in a real integration.
- A quote adapter would need the exact currency pair, direction, debit amount, payout amount, fees, quote identifier, timestamp, guarantee status, and expiry when supplied. Missing guarantees remain unknown.
- Real approval controls would need server-side state, permissions, idempotency, and validation immediately before payment initiation. A browser-only state machine illustrates the interaction but cannot secure payment execution.
- Currency Check's ISO/locale/minor-unit behavior is an independent implementation choice. Confirm the supported currency list and numeric schema against the actual integration before production use.
- The public docs do not prove a particular API exposes executable FX quotes, maximum-debit approvals, or all required eligibility fields. An integration adapter is an assumption pending API and partner validation.
- Coverage is keyed by product, entity jurisdiction, plan, onboarding/verification, accounting setup where applicable, funding-account country/currency, and payout corridor. Do not infer one from another.
- These proposed checks should reuse Ramp's existing controls and eligibility information wherever integration permits. Claims about additional value require user testing or product confirmation.

## Optional next idea: payment funding opportunity planner

A future portfolio view could identify already available, eligible lower-cost funding choices and explain why each is valid. It should respect entity ownership, account eligibility, balances, deadlines, and liquidity constraints; moving funds is not automatically free.

One precise illustration uses Ramp's documented **USD 20 external-bank SWIFT USD fee**, waived when funded from Ramp Checking: **50 eligible wires × USD 20 = USD 1,000** of fee difference. This is an example workload, not measured savings, a universal account option, or a new Ramp rail. Recipient/intermediary charges can still apply. [International transfers](https://support.ramp.com/international-transfers-on-ramp-bill-pay)

The proposed extension is detecting opportunities across a payment run. Ramp already provides the underlying payment methods and local-funding capabilities.

## Evidence boundaries

Public sources support the capability and currency distinctions above. They do not establish private event rules, available hackathon APIs, internal implementation defects, rates offered to a specific customer, or the absence of similar internal features. Treat Borderless as a concrete conversation starter with explainable inputs, deterministic arithmetic, and testable product hypotheses.
