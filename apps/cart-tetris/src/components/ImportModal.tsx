import { useRef, useState } from 'react';
import type { QuoteSet } from '../engine/types';
import { CSV_TEMPLATE, parseQuoteImport } from '../engine/validate';
import { download } from '../export';

interface Props {
  onClose(): void;
  onApply(qs: QuoteSet): void;
}

export default function ImportModal({ onClose, onApply }: Props) {
  const [text, setText] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const apply = () => {
    const { quoteSet, errors: errs } = parseQuoteImport(text);
    if (errs.length > 0) {
      setErrors(errs);
      return;
    }
    setErrors([]);
    onApply(quoteSet!);
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setText(await f.text());
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Import quotes">
      <div className="modal">
        <h3>Import quotes</h3>
        <p className="modal-sub">
          Paste JSON or CSV (see template). Everything is validated before it replaces the current
          quotes — nothing is applied on failure. Prices are example pretax USD cents.
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder='{"currency":"USD","quotedAt":"2026-01-01","validUntil":"2027-01-01","vendors":[...]}'
          aria-label="Quote data"
        />
        <input
          ref={fileRef}
          type="file"
          accept=".json,.csv,text/csv,application/json"
          style={{ display: 'none' }}
          onChange={(e) => onFile(e.target.files?.[0])}
        />
        {errors.length > 0 && (
          <ul className="import-errors" role="alert">
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        )}
        <div className="modal-actions">
          <button className="btn primary" onClick={apply} disabled={!text.trim()}>
            Validate &amp; apply
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()}>
            Choose file
          </button>
          <button
            className="btn ghost"
            onClick={() => download('cart-tetris-quote-template.csv', CSV_TEMPLATE, 'text/csv')}
          >
            Download template
          </button>
          <button className="btn ghost" onClick={onClose} style={{ marginLeft: 'auto' }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
