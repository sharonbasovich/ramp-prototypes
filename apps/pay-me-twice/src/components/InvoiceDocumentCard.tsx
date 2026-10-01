import { BASE_INVOICE, periodLabel } from '../../engine/documents.mjs';
import { formatCents } from '../../engine/engine.mjs';
import type { InvoiceFacts } from '../types';

interface Doc {
  filename: string;
  bytes: Uint8Array;
  readable: boolean;
  text: string;
  kind: 'sample' | 'upload';
}

/** Paper-style render of the invoice under test — "as received". */
export default function InvoiceDocumentCard({ doc, facts }: { doc: Doc | null; facts: InvoiceFacts }) {
  const isUpload = doc?.kind === 'upload';
  return (
    <section className="card doc-card" aria-labelledby="doc-h">
      <div className="doc-head">
        <h2 id="doc-h">Invoice <span className="muted">(as received)</span></h2>
        <span className="doc-filename" title={doc?.filename}>{doc?.filename ?? '—'}</span>
      </div>
      {isUpload && doc.readable ? (
        // Uploads render their own extracted text — the paper template would
        // otherwise fabricate an address, bill-to, dates and tax the file
        // never stated.
        <>
          <div className="paper">
            <pre className="paper-text">{doc.text || '(no extracted text)'}</pre>
          </div>
          <p className="doc-origin muted small">
            Original text extracted from {doc.filename}. Fields it does not
            state are left blank in the form — nothing is filled in for it.
          </p>
        </>
      ) : doc && !doc.readable ? (
        <div className="paper paper-empty">
          <p className="paper-empty-icon" aria-hidden="true">▦</p>
          <p><strong>No readable text in this document.</strong></p>
          <p className="muted">
            Nothing was extracted or guessed. Fill in the invoice facts manually,
            or expect an “unsupported / review” verdict.
          </p>
        </div>
      ) : (
        <div className="paper">
          <div className="paper-top">
            <div>
              <p className="paper-supplier">{facts.supplier || '—'}</p>
              <p className="paper-lines">{BASE_INVOICE.supplierAddress}</p>
            </div>
          </div>
          <p className="paper-title">INVOICE</p>
          <div className="paper-meta">
            <dl>
              <div><dt>Invoice No.</dt><dd>{facts.invoiceNumber || '—'}</dd></div>
              <div><dt>Billing Period</dt><dd>{periodLabel(facts.period) || 'Not stated'}</dd></div>
              <div><dt>Issue Date</dt><dd>{BASE_INVOICE.issueDate}</dd></div>
              <div><dt>Due Date</dt><dd>{BASE_INVOICE.dueDate}</dd></div>
            </dl>
            <dl>
              <div><dt className="billto">Bill To</dt><dd>{BASE_INVOICE.billTo}</dd></div>
            </dl>
          </div>
          <table className="paper-items">
            <thead>
              <tr><th>Description</th><th>Qty</th><th>Rate</th><th>Amount</th></tr>
            </thead>
            <tbody>
              {facts.items.length ? facts.items.map((it, i) => (
                <tr key={i}>
                  <td>{it.description}</td>
                  <td>{it.qty}</td>
                  <td>{formatCents(it.rateCents, facts.currency)}</td>
                  <td>{formatCents(it.amountCents, facts.currency)}</td>
                </tr>
              )) : (
                <tr><td colSpan={4} className="muted">No line items</td></tr>
              )}
            </tbody>
          </table>
          <div className="paper-totals">
            <div><span>Subtotal</span><span>{formatCents(facts.amountCents ?? 0, facts.currency)}</span></div>
            <div><span>Tax</span><span>{formatCents(0, facts.currency)}</span></div>
            <div className="paper-total"><span>Total ({facts.currency})</span><span>{formatCents(facts.amountCents ?? 0, facts.currency)}</span></div>
          </div>
          <p className="paper-thanks">Thank you for your business.</p>
        </div>
      )}
    </section>
  );
}
