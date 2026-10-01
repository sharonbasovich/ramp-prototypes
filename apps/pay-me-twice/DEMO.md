# Pay Me Twice — 30-second booth demo

Setup: `npm ci && npm run build && npm start` → http://localhost:5312
(SQLite backend sandbox — transactional ledger mode).

1. **0–5s** — Point at the seeded state: "This sample $480 invoice from
   Northline Studio was already paid — see the ledger, Sep 3, 10:14 AM."
2. **5–12s** — Pick **Same invoice, different filename**, click
   **Validate invoice**, then **Try to get paid**.
3. **12–20s** — Show the red **Duplicate blocked** card: matched supplier,
   invoice number, amount, and the paid ledger entry. Open
   **Inspect evidence** to show the content hash and normalized identity.
   "Identical bytes — the rename didn't matter."
4. **20–26s** — Click **Reset sandbox**, choose **Next month's real bill**
   (INV-1043, October 2026), validate → **Clear to pay**. Then pick
   **Send 10 requests at once**: exactly **1 of 10** concurrent requests
   records a payment; 9 are blocked as duplicates.
5. **26–30s** — Ledger shows both legitimate payments. "October paid once,
   September still paid once. Every retry returned the same result."

Optional extra (10s): **Changed invoice number** scenario → amber
**Review required** — "similarity isn't proof, so we hold instead of paying."

## What to say about honesty

- Sample data, sandbox dollars, no real payments — on screen at all times.
- Blocked duplicates are *prevented repeats*, not measured savings.
- Browser-sandbox mode (static hosting) is labeled "this tab only"; the
  cross-request guarantee being demonstrated live is the SQLite backend.
