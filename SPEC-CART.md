# Cart Tetris

Premise: The cheapest prices made the most expensive cart. A real small-catalog order optimizer exposes shipping fees, thresholds, and delivery constraints.

## Complete flow

Edit basket quantities and deadline -> validate quotes -> find cheapest feasible allocation -> compare against cheapest feasible single-vendor baseline -> inspect item/shipping totals -> approve the current plan -> export its exact order instructions. Input changes invalidate approval. No real purchase.

## Required seed quotes (USD cents; clearly demo data)

Exact identical SKU across vendors. Coffee quantity 4, cups quantity 3, snack bars quantity 5. Three-day default deadline.

| Vendor | Coffee unit | Cups unit | Bars unit | Shipping | Free shipping threshold | Delivery |
| --- | --- | --- | --- | --- | --- | --- |
| North Supply | 1200 | 400 | 600 | 1800 | none | 1 day |
| Bulk Club | 1000 | 1500 | 500 | 1800 | 6000 | 2 days |
| QuickBox | 1300 | 350 | 650 | 600 | 20000 | 1 day |

No tax has been modeled; explicitly say prices are example pretax quotes. Empty vendor orders incur zero shipping. Threshold applies to item subtotal and is inclusive. The best single-vendor baseline is QuickBox: 5200 + 1050 + 3250 + 600 = 10100. The optimum should be Bulk Club coffee+bars = 6500 with free shipping; QuickBox cups = 1050+600=1650; total 8150, reduction1950. Show exactly how the result is calculated. The concept image contains incorrect vendor/line allocations: use these verified fixture calculations. Tightening deadline to 1 day excludes Bulk Club and should remove that bargain. Do not hardcode the output; solve all supported inputs.

## Real engine

Use exact bounded exhaustive allocation or dynamic programming over units to allow meaningful vendor splits. Budget an honest limit (e.g.3SKUs,3vendors, each0..12units; bound search via DP/branch-and-bound). Treat shipping/thresholds/minimum order/discounts correctly. A reasonable first pass allocates each SKU wholly to one vendor, but that alone is insufficient if imported volume tiers allow unit splitting; document/implement exact supported semantics. Verify with a separate brute-force oracle over small cases. Provide deterministic tie-breaking. Quote schema has SKU, equivalence, cents, inventory, vendor delivery, shipping fee, free-shipping/minimum threshold, currency, quotedAt/validUntil. Reject expired or missing prices, nonfinite numbers, negative/fractional quantity, incompatible currency. CSV/JSON import is checked before replacing existing data; downloadable template.

Keep equivalence strict for MVP; no silent substitutions. Budget doesn't magically create a feasible plan. If no plan meets deadline/stock/budget show the actual blocking constraints. Export a fully itemized JSON/CSV purchase plan only after approval and include fixture/provenance/assumptions. 'Cheaper plan' or 'potential spending reduction' never claims completed savings.

## Meaningful acceptance tests

- Seed minimum8150 versus baseline10100; 1-day deadline excludes2-day vendor; emptybasket total0; impossibledeadline/stock yields infeasible.
- Shipping only on used vendor; inclusive threshold equality; slightly below threshold; changing qty causes genuine different computation.
- A case where cheapest unit prices lose to shipping; compare optimizer against independentoracle with random smallcases.
- Inputchanged after approval prevents stale export; expiredquotes/mixedcurrency/tamperednumeric rejected.
- Priceedited and imported quotes alter result. Reset returns seed. Mobile and keyboard walkthrough work.

## 30-second booth demonstration

0-5s: 'Picking the cheapest sticker prices can give you the most expensive cart.'
5-12s: Visitor chooses quantities or delivery deadline.
12-22s: Calculate; allocation visibly moves, itemized same-basket comparison proves result.
22-30s: Tighten deadline, watch result change, approve and download plan.

Stretch only after above passes: volume-discount tiers, four-vendor quotes, CSV purchase-order format, procurement approver queue. No scraping or real finance accounts required.
