# Pay Me Twice

Interactive duplicate-invoice defense sandbox for Sharon's private Ramp event.

> We already paid this invoice. You have 30 seconds to make us pay it again.

A visitor attacks a sample $480 paid invoice — rename the file, reformat the
layout, change the invoice number, or fire ten requests at once — and gets a
precise verdict with visible evidence. A legitimate recurring bill stays
payable. Sample data only; **no real payments**.

## Run

```bash
npm ci
npm run build     # vite → dist/
npm start         # http://localhost:5312 — serves dist + /api (node:sqlite)

npm test          # vitest: engine units + HTTP acceptance matrix (incl. 20-way race)
npm run typecheck # tsc --noEmit
npm run dev       # vite dev on 5312 (browser-sandbox mode)
                  # dev backend: `PORT=5392 npm run api` in another shell
```

Requires Node ≥ 22.14 (`node:sqlite`, `crypto.subtle`, `DecompressionStream`).
No API keys, no external services, no paid anything.

## Two honest modes

Every screen shows which engine is live:

- **SQLite backend sandbox — transactional ledger** (`npm start`): the same
  engine runs behind real HTTP with `node:sqlite`. Eligibility check and
  payment recording are one `BEGIN IMMEDIATE` transaction; uniqueness on
  `payments(supplier_norm, invoice_norm, currency)` and `requests(request_id)`
  is the final defense against races, retries, and distinct actors.
- **Browser sandbox — this tab only** (static hosting, e.g. GitHub Pages):
  the same engine runs against IndexedDB, made atomic by Web Locks plus a
  single readwrite transaction per request. It demonstrates the state machine
  in one browser — it does **not** claim cross-device or cross-origin
  enforcement.

If `/api/health` fails, the app silently degrades to browser mode and says so.

## What "duplicate" means here

Three signals, in order:

1. **Identical file content** — SHA-256 of the document bytes matches a paid
   document (renames don't matter).
2. **Paid payable identity** — `(supplier, invoice number, currency)`, with
   whitespace/case normalized but punctuation preserved so near-references
   can't collide destructively.
3. **Near duplicate → review** — same supplier, amount, currency and line-item
   signature with a *different* reference and no new billing period is a
   review hold, not an accusation: similarity alone is not proof. A new
   reference **with** a new billing period is a legitimate next bill and stays
   payable.

Nothing is ever auto-denied *and* auto-paid ambiguously: only `clear` verdicts
can record a payment; `review` and `unsupported` never pay.

## Documents

Sample documents are deterministic text renderings generated in
`engine/documents.mjs` and honestly labeled. Uploads accept text/PDF/image
files: text files and PDFs are parsed by a real extractor
(`engine/documents.mjs`, `pdfText` handles FlateDecode via zlib on the server
or `DecompressionStream` in the browser, and parses escaped literal strings
such as `(Total \(USD\) $17.25)`). Image-only/malformed files produce
an **Unsupported document** state — fields are never guessed; editable manual
facts are offered instead.

A new document never retains facts from a previous or sample invoice:
extraction fills only what the text states, everything else stays blank, and
pay is blocked until supplier, invoice number, amount **and currency** are
verified. A total with no currency code leaves currency unstated — it must
be picked explicitly; USD is never assumed. Editing extracted or sample
facts marks the record "document + manual edits" rather than silently
keeping the "extracted" label. In the "Invoice (as received)" panel,
uploads show their own extracted text as source evidence rather than a
fabricated paper, and the billing-period control accepts any real month
or "Not stated".

## Integrity notes

- All money is integer cents (`amountCents`); no floating-point currency math.
- Currencies never aggregate into a single total; the ledger reports per
  currency.
- "Duplicate sandbox payment blocked" counts prevented repeats — **not**
  measured savings, and never claimed as such.
- Dates come from an explicit fixture clock (Sep 3, 2026, +1 min per attempt),
  not the wall clock.
- Reset restores the seeded sandbox (one paid invoice) deterministically.
- Scripted scenarios are scripted; no AI/model is used or claimed.

## Layout

```
engine/    pure shared logic (engine.mjs, documents.mjs, seed.mjs)
server/    Node http + node:sqlite store (server.mjs, db.mjs)
src/       React UI + adapters (api.ts server/browser, idb.ts IndexedDB store)
tests/     vitest — engine units + independent HTTP acceptance matrix
docs/      screenshots + design review
```

## Scope and limitations

Sandbox demo of duplicate-invoice detection and transactional enforcement.
It is not fraud-proofing, not a real payment rail, and not novel over
established AP tooling — its strength is interactive adversarial testing with
visible ledger enforcement.
