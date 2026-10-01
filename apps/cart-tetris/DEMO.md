# Cart Tetris — 30-second booth demo

Setup: `npm start` then open http://localhost:5311 (or open the GitHub Pages
URL — the footer will honestly read "Browser sandbox").

| Time | Beat | What to show |
| --- | --- | --- |
| 0–5s | Hook | "Picking the cheapest sticker prices can give you the most expensive cart." Point at the headline and the $19.50 gap already on screen. |
| 5–12s | Visitor drives | Let them bump a quantity stepper or change "Need delivery by". The stale-note appears: inputs changed. |
| 12–22s | Calculate | Click **Find the cheapest order**. The allocation chips visibly move between North Supply / Bulk Club / QuickBox; the itemized breakdown proves exactly where each dollar goes (items, shipping, thresholds). |
| 22–27s | Tighten deadline | Set delivery to **Within 1 day** → recalculate: Bulk Club drops out, the bargain disappears ($81.50 → $101.00). |
| 27–30s | Approve & export | Click **Approve purchase plan**, then **Export plan** — an itemized purchase plan downloads. Touch a quantity: approval instantly voids. |

If asked: the optimizer is exact (exhaustive bounded enumeration cross-checked
by an independent brute-force oracle), and everything shown is example demo
data — no real purchases.
