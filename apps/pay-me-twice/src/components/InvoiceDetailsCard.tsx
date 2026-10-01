import { CURRENCIES } from '../../engine/engine.mjs';
import { SCENARIOS } from '../../engine/documents.mjs';
import type { InvoiceFacts } from '../types';

export default function InvoiceDetailsCard({
  facts, amountText, scenario, busy, uploadNote, canValidate, canReplay,
  onFactsChange, onAmountChange, onScenario, onValidate, onPay, onReplay, onUploadClick,
}: {
  facts: InvoiceFacts;
  amountText: string;
  scenario: string;
  busy: boolean;
  uploadNote: string;
  canValidate: boolean;
  canReplay: boolean;
  onFactsChange: (patch: Partial<InvoiceFacts>) => void;
  onAmountChange: (text: string, cents: number | null) => void;
  onScenario: (id: string) => void;
  onValidate: () => void;
  onPay: () => void;
  onReplay: () => void;
  onUploadClick: () => void;
}) {
  return (
    <section className="card details-card" aria-labelledby="details-h">
      <h2 id="details-h">Invoice details</h2>
      <p className="card-sub">Edit the invoice facts, then choose a scenario and validate.</p>

      <div className="fields">
        <label className="field">
          <span>Supplier</span>
          <input
            value={facts.supplier}
            onChange={(e) => onFactsChange({ supplier: e.target.value })}
          />
        </label>
        <label className="field">
          <span>Invoice number</span>
          <input
            value={facts.invoiceNumber}
            onChange={(e) => onFactsChange({ invoiceNumber: e.target.value })}
          />
        </label>
        <label className="field">
          <span>Billing period</span>
          <span className="period-row">
            <input
              type="month"
              value={facts.period}
              disabled={facts.period === ''}
              onChange={(e) => onFactsChange({ period: e.target.value })}
            />
            <label className="period-none">
              <input
                type="checkbox"
                checked={facts.period === ''}
                onChange={(e) =>
                  onFactsChange({ period: e.target.checked ? '' : '2026-09' })
                }
              />
              Not stated
            </label>
          </span>
        </label>
        <label className="field">
          <span>Amount</span>
          <span className="amount-row">
            <select
              aria-label="Currency"
              value={facts.currency}
              onChange={(e) => onFactsChange({ currency: e.target.value })}
            >
              {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
            </select>
            <input
              inputMode="decimal"
              value={amountText}
              onChange={(e) => {
                const t = e.target.value;
                const n = Number(t);
                onAmountChange(t, /^\d+(\.\d{1,2})?$/.test(t) && Number.isFinite(n)
                  ? Math.round(n * 100) : null);
              }}
            />
          </span>
        </label>
      </div>
      {amountText !== '' && facts.amountCents == null && (
        <p className="field-error" role="alert">Amount must be a number like 480.00.</p>
      )}
      <p className="fact-source">
        Facts source: {facts.factsSource === 'extracted' ? 'extracted from document' :
          facts.factsSource === 'manual' ? 'manual entry' : 'sample data'}
      </p>

      <h3 className="scenario-h">Validation scenario</h3>
      <p className="card-sub">Simulate how the same or similar invoice might arrive.</p>
      <div className="scenario-grid" role="group" aria-label="Validation scenarios">
        {SCENARIOS.map((s) => (
          <button
            key={s.id}
            className={`scenario-btn${scenario === s.id ? ' selected' : ''}`}
            onClick={() => onScenario(s.id)}
            disabled={busy}
            title={s.hint}
          >
            {s.label}
          </button>
        ))}
      </div>
      <p className="scenario-hint">{SCENARIOS.find((s) => s.id === scenario)?.hint ?? 'Upload your own file below.'}</p>

      <button className="btn btn-primary" onClick={onValidate} disabled={busy || !canValidate}>
        {scenario === 'burst' ? 'Send 10 requests at once' : 'Validate invoice'} →
      </button>
      {!canValidate && (
        <p className="field-error" role="alert">
          Complete supplier, invoice number and amount first — missing facts are never backfilled from a previous document.
        </p>
      )}

      <div className="secondary-actions">
        <button className="btn btn-ghost" onClick={onPay} disabled={busy || !canValidate}>
          Try to get paid
        </button>
        <button className="btn btn-ghost" onClick={onReplay} disabled={busy || !canValidate || !canReplay}
          title={canReplay ? 'Re-send the last request ID — expect the identical result' : 'Make a payment request first'}>
          Replay last request
        </button>
      </div>

      <details className="upload-details">
        <summary>Upload or enter manually</summary>
        <div className="upload-row">
          <button className="btn btn-outline" onClick={onUploadClick} disabled={busy}>
            Upload invoice (PDF / text / image)
          </button>
          <p className="upload-note">
            Text and PDF files are parsed locally. Image-only scans get no invented fields —
            anything the file doesn't state stays blank for you to confirm.
            {uploadNote && <><br /><strong>{uploadNote}</strong></>}
          </p>
        </div>
      </details>
    </section>
  );
}
