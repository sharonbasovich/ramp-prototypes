/**
 * Sample document generation + genuine text extraction for Pay Me Twice.
 *
 * Generated sample documents are deterministic text renderings of invoice
 * facts (labeled honestly in the UI). Uploads may also be real PDFs: a minimal
 * extractor pulls text out of PDF content streams (FlateDecode supported via
 * an injected inflate), and unparseable/image-only documents return
 * supported:false rather than invented fields.
 */

import { MONTH_NAMES, monthToPeriod, normalizeFacts } from './engine.mjs';

export const BASE_INVOICE = {
  supplier: 'Northline Studio',
  invoiceNumber: 'INV-1042',
  currency: 'USD',
  amountCents: 48000,
  period: '2024-09',
  issueDate: 'Sep 1, 2024',
  dueDate: 'Sep 30, 2024',
  supplierAddress: '123 Market Street\nPortland, OR 97204\nhello@northlinestudio.co',
  billTo: 'Acme Co\n456 Pine Street\nSan Francisco, CA 94105',
  items: [{ description: 'Creative services', qty: 1, rateCents: 48000, amountCents: 48000 }],
  factsSource: 'seed',
  docSupported: true,
};

function money(cents, currency = 'USD') {
  return `${currency === 'USD' ? '$' : currency + ' '}${(cents / 100).toFixed(2)}`;
}

export function periodLabel(period) {
  if (!/^\d{4}-\d{2}$/.test(period || '')) return '';
  const [y, m] = period.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

/** Canonical sample document text. */
export function renderCanonicalDoc(f) {
  const fa = normalizeFacts({ ...BASE_INVOICE, ...f });
  const lines = [
    fa.supplier.toUpperCase(),
    ...(BASE_INVOICE.supplierAddress || '').split('\n'),
    '',
    'INVOICE',
    '',
    `Supplier: ${fa.supplier}`,
    `Invoice No.: ${fa.invoiceNumber}`,
    `Billing Period: ${periodLabel(fa.period) || 'not stated'}`,
    `Issue Date: ${BASE_INVOICE.issueDate}`,
    `Due Date: ${BASE_INVOICE.dueDate}`,
    `Bill To: Acme Co, 456 Pine Street, San Francisco, CA 94105`,
    '',
    'Description          Qty    Rate        Amount',
    ...fa.items.map(
      (it) =>
        `${it.description.padEnd(20)} ${String(it.qty).padStart(3)}  ${money(it.rateCents, fa.currency).padStart(9)}  ${money(it.amountCents, fa.currency).padStart(10)}`
    ),
    '',
    `Subtotal ${money(fa.amountCents, fa.currency)}`,
    `Tax ${money(0, fa.currency)}`,
    `Total (${fa.currency}) ${money(fa.amountCents, fa.currency)}`,
    '',
    'Thank you for your business.',
  ];
  return lines.join('\n');
}

/** Same facts, deliberately different wording/order — the "new layout" attack. */
export function renderAltLayoutDoc(f) {
  const fa = normalizeFacts({ ...BASE_INVOICE, ...f });
  return [
    '*** STATEMENT OF SERVICES ***',
    `From: ${fa.supplier}`,
    `To: Acme Co`,
    '',
    `Amount due (${fa.currency}): ${money(fa.amountCents, fa.currency)}`,
    `Invoice #${fa.invoiceNumber}`,
    `For services rendered: ${periodLabel(fa.period) || 'not stated'}`,
    `Issued ${BASE_INVOICE.issueDate} · payable until ${BASE_INVOICE.dueDate}`,
    '',
    ...fa.items.map(
      (it) => `Line: ${it.description} | qty ${it.qty} | unit ${money(it.rateCents, fa.currency)} | total ${money(it.amountCents, fa.currency)}`
    ),
    '',
    'Please remit within terms.',
  ].join('\n');
}

/** Changed-reference attack doc: new number, period deliberately absent. */
export function renderChangedRefDoc(f) {
  const fa = normalizeFacts({ ...BASE_INVOICE, ...f, period: '' });
  return [
    fa.supplier.toUpperCase(),
    'REVISED BILLING STATEMENT',
    '',
    `Supplier: ${fa.supplier}`,
    `Invoice No.: ${fa.invoiceNumber}`,
    `Issue Date: ${BASE_INVOICE.issueDate}`,
    `Bill To: Acme Co, 456 Pine Street, San Francisco, CA 94105`,
    '',
    'Description          Qty    Rate        Amount',
    ...fa.items.map(
      (it) =>
        `${it.description.padEnd(20)} ${String(it.qty).padStart(3)}  ${money(it.rateCents, fa.currency).padStart(9)}  ${money(it.amountCents, fa.currency).padStart(10)}`
    ),
    '',
    `Total (${fa.currency}) ${money(fa.amountCents, fa.currency)}`,
  ].join('\n');
}

/** Fake image-only bytes — no extractable text by design. */
export function unreadableBytes() {
  const head = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const body = new Uint8Array(512);
  for (let i = 0; i < body.length; i++) body[i] = (i * 31 + 7) & 0xff;
  const out = new Uint8Array(head.length + body.length);
  out.set(head); out.set(body, head.length);
  return out;
}

export const SCENARIOS = [
  { id: 'renamed', label: 'Same invoice, different filename', hint: 'Identical bytes arrive as a new upload.' },
  { id: 'relayout', label: 'Same invoice, new layout', hint: 'Reformatted document, same supplier and invoice number.' },
  { id: 'changed-ref', label: 'Changed invoice number', hint: 'Same amounts, new reference, no billing period.' },
  { id: 'burst', label: 'Send 10 requests at once', hint: 'Ten concurrent payment requests, distinct request IDs.' },
  { id: 'next-month', label: 'Next month’s real bill', hint: 'New invoice number for October — should be payable.' },
  { id: 'unreadable', label: 'Unreadable scan', hint: 'Image-only document: no facts get invented.' },
];

const enc = new TextEncoder();

/**
 * Produce { filename, bytes, facts, note } for a scenario applied to facts.
 * 'burst' reuses current facts — the client fires 10 requests itself.
 */
export function buildScenarioDocument(scenarioId, currentFacts) {
  const f = normalizeFacts({ ...BASE_INVOICE, ...currentFacts });
  switch (scenarioId) {
    case 'renamed':
      return {
        filename: 'northline_inv1042_v2.pdf',
        bytes: enc.encode(renderCanonicalDoc(f)),
        facts: { ...f, docSupported: true },
        note: 'Identical file content under a new filename.',
      };
    case 'relayout':
      return {
        filename: 'northline_inv1042_layoutB.pdf',
        bytes: enc.encode(renderAltLayoutDoc(f)),
        facts: { ...f, docSupported: true },
        note: 'Reordered wording and layout, same identity.',
      };
    case 'changed-ref': {
      // Derives from the base invoice so the attack is deterministic.
      const f0 = normalizeFacts({ ...BASE_INVOICE });
      const facts = { ...f0, invoiceNumber: `${f0.invoiceNumber}A`, period: '', docSupported: true };
      return {
        filename: 'northline_revised_statement.pdf',
        bytes: enc.encode(renderChangedRefDoc(facts)),
        facts,
        note: 'New reference, no billing period — matches on everything else.',
      };
    }
    case 'next-month': {
      // The real next bill of the seeded invoice — always INV-1043 / October.
      const f0 = normalizeFacts({ ...BASE_INVOICE });
      const facts = {
        ...f0,
        invoiceNumber: nextInvoiceNumber(f0.invoiceNumber),
        period: nextPeriod(f0.period),
        docSupported: true,
      };
      return {
        filename: 'northline_inv_oct.pdf',
        bytes: enc.encode(renderCanonicalDoc(facts)),
        facts,
        note: 'Distinct reference and a new service period.',
      };
    }
    case 'unreadable':
      return {
        filename: 'northline_scan_photo.png',
        bytes: unreadableBytes(),
        facts: { ...f, docSupported: false, docHash: '' },
        note: 'Image-only document — extraction finds no text.',
      };
    case 'burst':
    default:
      return {
        filename: `${(f.supplier || 'invoice').toLowerCase().replace(/\s+/g, '_')}_${f.invoiceNumber.toLowerCase()}.pdf`,
        bytes: enc.encode(renderCanonicalDoc(f)),
        facts: { ...f, docSupported: true },
        note: 'Current invoice facts, fired ten times concurrently.',
      };
  }
}

function nextInvoiceNumber(num) {
  const m = /^(.*?)(\d+)(\D*)$/.exec(num || 'INV-0');
  if (!m) return `${num}-2`;
  return `${m[1]}${Number(m[2]) + 1}${m[3]}`;
}

function nextPeriod(period) {
  const m = /^(\d{4})-(\d{2})$/.exec(period || '');
  if (!m) return '';
  let y = Number(m[1]); let mo = Number(m[2]) + 1;
  if (mo > 12) { mo = 1; y += 1; }
  return `${y}-${String(mo).padStart(2, '0')}`;
}

/* ------------------------------------------------------------------ */
/* Extraction                                                          */
/* ------------------------------------------------------------------ */

const MONEY_RE = /\$?\s*([\d,]+(?:\.\d{2})?)/;

function cents(raw) {
  const n = Number(String(raw).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/**
 * Parse labeled invoice fields out of plain text. Returns only what the text
 * actually states — missing fields stay missing (they become review signals).
 */
export function extractFields(text) {
  const facts = {};
  const lines = String(text).split(/\r?\n/);

  const grab = (res) => {
    for (const re of res) {
      for (const line of lines) {
        const m = re.exec(line);
        if (m) return m[1].trim();
      }
    }
    return null;
  };

  const supplier = grab([
    /^Supplier\s*:\s*(.+)$/i,
    /^From\s*:\s*(.+)$/i,
    /^Billed by\s*:\s*(.+)$/i,
  ]);
  if (supplier) facts.supplier = supplier.replace(/\s+/g, ' ');

  const inv = grab([
    /Invoice\s*(?:No\.?|Number)\s*[:#]?\s*([A-Za-z0-9][\w\-\/ ]*)$/i,
    /Invoice\s*#\s*([A-Za-z0-9][\w\-\/]*)/i,
    /Reference\s*[:#]?\s*([A-Za-z0-9][\w\-\/ ]*)$/i,
  ]);
  if (inv) facts.invoiceNumber = inv.trim();

  const period = grab([
    /(?:Billing|Service)\s*[Pp]eriod\s*:\s*([A-Za-z]+\s+\d{4})/,
    /For services rendered\s*:\s*([A-Za-z]+\s+\d{4})/i,
  ]);
  if (period) facts.period = monthToPeriod(period);

  const totalRes = [
    /Total\s*\(?\s*([A-Z]{3})\s*\)?\s*[:.]?\s*\$?\s*([\d,]+\.\d{2})/i,
    /Amount due\s*\(?\s*([A-Z]{3})\s*\)?\s*[:.]?\s*\$?\s*([\d,]+\.\d{2})/i,
    /^Total\s*[:.]?\s*\$?\s*([\d,]+\.\d{2})/i,
  ];
  for (const line of lines) {
    for (const re of totalRes) {
      const m = re.exec(line);
      if (m) {
        const cur = m.length > 2 ? m[1] : null;
        const raw = m.length > 2 ? m[2] : m[1];
        facts.currency = /^[A-Z]{3}$/.test(cur || '') ? cur : 'USD';
        const c = cents(raw);
        if (c != null) facts.amountCents = c;
        break;
      }
    }
    if (facts.amountCents != null) break;
  }

  // Line items: "desc qty $rate $amount" or "Line: desc | qty n | unit $r | total $a"
  const items = [];
  for (const line of lines) {
    let m = /^(.*?)\s{2,}(\d+)\s+[\s$]*([\d,]+\.\d{2})\s+[\s$]*([\d,]+\.\d{2})\s*$/.exec(line);
    if (!m) m = /^Line:\s*(.*?)\s*\|\s*qty\s*(\d+)\s*\|\s*unit\s*([\d,.$]+)\s*\|\s*total\s*([\d,.$]+)/i.exec(line);
    if (m && !/description/i.test(m[1])) {
      const qty = Number(m[2]);
      const rate = cents(m[3]);
      const amount = cents(m[4]);
      if (qty > 0 && rate != null && amount != null) {
        items.push({ description: m[1].trim(), qty, rateCents: rate, amountCents: amount });
      }
    }
  }
  if (items.length) facts.items = items;

  const found = ['supplier', 'invoiceNumber', 'amountCents', 'period'].filter((k) => facts[k] != null && facts[k] !== '');
  return { fields: facts, found };
}

/** Pull literal strings out of PDF content streams. inject: async inflate(bytes). */
export async function pdfText(bytes, inflate) {
  const src = new TextDecoder('latin1').decode(bytes);
  const out = [];
  const streamRe = /stream\r?\n([\s\S]*?)endstream/g;
  let sm;
  while ((sm = streamRe.exec(src))) {
    let chunk = sm[1];
    // Try FlateDecode when the bytes don't look like text operators.
    if (!/BT|Tj|TJ/.test(chunk) && inflate) {
      try {
        const comp = Uint8Array.from(chunk, (c) => c.charCodeAt(0));
        chunk = new TextDecoder('latin1').decode(await inflate(comp));
      } catch {
        continue;
      }
    }
    for (const tm of chunk.matchAll(/\(([^()]*)\)\s*Tj/g)) out.push(unescapePdf(tm[1]));
    for (const tm of chunk.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
      const joined = Array.from(tm[1].matchAll(/\(([^()]*)\)/g), (x) => unescapePdf(x[1])).join('');
      if (joined) out.push(joined);
    }
  }
  return out.join('\n');
}

function unescapePdf(s) {
  return s.replace(/\\([nrtbf()\\])/g, (_, c) =>
    ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' })[c] ?? c
  );
}

function looksLikePdf(bytes) {
  return bytes.length > 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

function mostlyText(bytes) {
  if (!bytes.length) return false;
  let printable = 0;
  for (let i = 0; i < Math.min(bytes.length, 2048); i++) {
    const b = bytes[i];
    if (b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127)) printable++;
  }
  return printable / Math.min(bytes.length, 2048) > 0.85;
}

/**
 * Ingest document bytes. Returns { supported, text, fields, docHashInput } —
 * supported:false means "no readable text", never invented fields.
 * `inflate` is an async (Uint8Array)=>Uint8Array (zlib FlateDecode).
 */
export async function extractDocument(bytes, filename, inflate) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let text = '';
  if (looksLikePdf(u8)) {
    text = await pdfText(u8, inflate);
  } else if (mostlyText(u8)) {
    text = new TextDecoder().decode(u8);
  }
  if (!text.trim()) {
    return { supported: false, text: '', fields: {}, found: [], filename };
  }
  const { fields, found } = extractFields(text);
  return { supported: true, text, fields, found, filename };
}
