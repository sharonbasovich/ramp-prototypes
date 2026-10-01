import { useEffect, useRef } from 'react';
import type { InvoiceFacts, PaymentRow } from '../types';
import type { VerdictView } from './VerdictCard';
import { normalizeInvoiceNumber, normalizeSupplier, displayPeriod, formatCents } from '../../engine/engine.mjs';

interface Doc { filename: string; readable: boolean; text: string }

/**
 * Functional evidence inspector: matched fields, normalized identities,
 * document hash, and the ledger entry it collided with.
 */
export default function EvidenceModal({
  view, facts, doc, payments, onClose,
}: {
  view: VerdictView;
  facts: InvoiceFacts;
  doc: Doc | null;
  payments: PaymentRow[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const matchedUid =
    view.kind === 'verdict' ? view.verdict.matchedPaymentUid
    : view.kind === 'pay' ? view.result.verdict.matchedPaymentUid ?? view.result.paymentUid
    : view.paymentUid;
  const matched = payments.find((p) => p.paymentUid === matchedUid);

  const title =
    view.kind === 'verdict' ? view.verdict.title
    : view.kind === 'pay' ? `Payment request · ${view.result.outcome}`
    : 'Concurrency burst';
  const detail =
    view.kind === 'verdict' ? view.verdict.detail
    : view.kind === 'pay' ? (view.result.detail ?? view.result.verdict.detail)
    : `${view.total} concurrent requests → ${view.recorded} recorded, ${view.blocked} blocked.`;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal" role="dialog" aria-modal="true" aria-labelledby="ev-h"
        ref={ref} tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2 id="ev-h">Evidence — {title}</h2>
          <button className="btn btn-ghost" onClick={onClose} aria-label="Close">×</button>
        </div>
        <p className="muted">{detail}</p>

        <h3>What we compared</h3>
        <table className="ev-table">
          <tbody>
            <tr><th>Supplier</th><td>{facts.supplier || '—'}</td><td className="mono">norm: {normalizeSupplier(facts.supplier) || '—'}</td></tr>
            <tr><th>Invoice number</th><td>{facts.invoiceNumber || '—'}</td><td className="mono">norm: {normalizeInvoiceNumber(facts.invoiceNumber) || '—'}</td></tr>
            <tr><th>Amount</th><td>{facts.amountCents != null ? formatCents(facts.amountCents, facts.currency) : '—'}</td><td className="mono">{facts.amountCents ?? '—'} cents {facts.currency}</td></tr>
            <tr><th>Billing period</th><td>{displayPeriod(facts.period)}</td><td className="mono">{facts.period || 'not stated'}</td></tr>
            <tr><th>Document</th><td>{doc?.filename ?? '—'}</td><td className="mono">{facts.docHash ? `sha256 ${facts.docHash.slice(0, 16)}…` : 'no hash'}</td></tr>
            <tr><th>Facts source</th><td>{facts.factsSource}</td><td className="mono">{doc?.readable === false ? 'unreadable document' : 'document readable'}</td></tr>
          </tbody>
        </table>

        {matched && (
          <>
            <h3>Colliding ledger entry</h3>
            <table className="ev-table">
              <tbody>
                <tr><th>Ledger entry</th><td>{matched.paymentUid}</td><td className="mono">{matched.paidAt}</td></tr>
                <tr><th>Supplier</th><td>{matched.supplier}</td><td className="mono">norm: {matched.supplierNorm}</td></tr>
                <tr><th>Invoice number</th><td>{matched.invoiceNumber}</td><td className="mono">norm: {matched.invoiceNorm}</td></tr>
                <tr><th>Amount</th><td>{formatCents(matched.amountCents, matched.currency)}</td><td className="mono">{matched.amountCents} cents {matched.currency}</td></tr>
                <tr><th>Billing period</th><td>{displayPeriod(matched.period)}</td><td className="mono">{matched.period || '—'}</td></tr>
                <tr><th>Paid via</th><td>{matched.actor}</td><td className="mono">request {matched.requestId.slice(0, 18)}…</td></tr>
              </tbody>
            </table>
          </>
        )}

        {doc?.text && (
          <>
            <h3>Extracted document text</h3>
            <pre className="ev-doc">{doc.text}</pre>
          </>
        )}
        <p className="muted small">
          All sample data. “Blocked” means a duplicate sandbox payment was prevented —
          it is not a measured saving and not fraud-proofing.
        </p>
      </div>
    </div>
  );
}
