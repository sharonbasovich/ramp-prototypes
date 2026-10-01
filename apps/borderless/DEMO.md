# Borderless — 30-second booth script

Goal: show one explainable currency control per tab. Every claim is visible on
screen; nothing requires a backend.

## FX Guard (default tab, `#guard`)

> "Here's a EUR 900 invoice against a USD 1,000 budget. The demo quote is
> 1 EUR = 1.08 USD plus an $8 fee — **projected debit USD 980.00**, twenty
> dollars of headroom."

1. **Approve quote** → the approval binds that exact snapshot (invoice, pair,
   rate, expiry, fee, budget).
2. **Commit sandbox payment** → one debit in the decision trail. Click again —
   still one debit.
3. **Simulate FX move** → rate becomes 1.12, projected debit **USD 1,016.00**
   — over budget, and the approval is permanently revoked. Reverting the rate
   to 1.08 does *not* restore it.
4. **Expire quote** → the DEMO clock passes the 2-minute validity; commit is
   blocked until you refresh the quote and re-approve.

> "The approval doesn't authorize a budget overage or a stale price — it can
> only pay exactly what was approved."

## Currency Check (`#check`)

> "A dollar sign is not a currency. `$1,250.00` is USD *or* CAD — the app
> refuses to guess."

1. Try **Validate invoice** — held: no currency, no format.
2. Choose **CAD** + **English** → parses to CAD 125,000 minor units, but the
   Canada·USD funding account is **blocked** — Canadian Bill Pay requires CAD
   funding (documented on-screen with the source link).
3. Switch to **Canada · CAD** → *"funding-currency preflight passed"* — a
   simplified verified fixture, not an eligibility verdict. **Save normalized
   invoice** records a sandbox record.

## True Cost (`#cost`)

> "Berlin looks cheaper — EUR 850 vs USD 1,000 — until you finish the math."

1. The table shows EUR 850 → USD 935 converted, +90 shipping +25 fee = USD 1,050
   vs Boston's USD 1,020. The sticker winner is Berlin; the **complete** winner
   is Boston by **USD 30.00**.
2. **Choose lowest complete cost** records a review snapshot.
3. **Edit assumptions** → blank a charge to *unknown*: it is not treated as
   zero — the quote goes incomplete and selection is blocked until the charge
   is supplied.

All three trails export honest JSON audit evidence — every number above is a
fixture shown in the audit export.
