# Budget Brawl — 30-second booth demo

Setup: `npm ci && npm run build && npm start`, open `http://localhost:5314`.
Click **Reset sandbox** so the wallet starts clean ($100, nothing spent).

| Time | Beat |
| --- | --- |
| 0–5s | "These three scripted agents share one $100 budget. Ada and Ben each want the last $60 monitor." Point at the gray budget bar: $100 available. |
| 5–13s | Click **Launch simultaneous requests**. Three real requests fire at once: **Ada → Awaiting approval** ($60 held — she's over the $50 threshold but the funds fit), **Ben → Awaiting approval, no funds held** (only $40 left — his request pends; it is *not* auto-denied), **Cleo → Denied — permission scope** (her $200 gadget simply isn't in her permissions; that's a scope denial, not a threshold issue). |
| 13–20s | Point at the bar: $60 reserved segment, $40 available. "The wallet — not the agents — decides. In the same instant, twenty requests would still produce exactly one reservation." |
| 20–26s | Click **Cancel** on Ada's row: $60 returns to the budget, once. Re-send Ben's lane → his $60 pends approval holding funds → **Approve** → **Commit** → purchase recorded. Optionally click **Replay duplicate request**: the original result comes back — no second charge, ledger unchanged. |
| 26–30s | Read the strip: **$100 budget · $60 spent · $0 reserved · $40 available.** "Spent + reserved never exceeds budget — enforced by SQLite transactions, not by trusting the agents." |

If asked about the mode badge: "SQLite backend sandbox" means real
transactional enforcement; "Browser sandbox — this tab only" is the same
engine without a server and is labeled as a single-tab demo.

Try it live: change the **Budget** or **Approval threshold** inputs, edit a
sample catalog price (commits on the old quote release as stale), or shorten
the quote TTL and let a reservation expire.
