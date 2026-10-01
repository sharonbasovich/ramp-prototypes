import { useMemo, useState } from 'react';
import type { QuoteSet } from '../engine/types';
import { validateQuoteSet } from '../engine/validate';

interface Props {
  quoteSet: QuoteSet;
  onApply(qs: QuoteSet): void;
}

/**
 * Editable vendor quote grid. Edits are drafted locally and applied atomically
 * after full validation — a bad value never partially replaces the live data.
 */
export default function QuotesPanel({ quoteSet, onApply }: Props) {
  const [draft, setDraft] = useState<QuoteSet | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const working = useMemo(() => draft ?? structuredClone(quoteSet), [draft, quoteSet]);
  const skus = useMemo(() => {
    const set = new Set<string>();
    for (const v of working.vendors) for (const k of Object.keys(v.quotes)) set.add(k);
    return [...set].sort();
  }, [working]);

  const patch = (fn: (qs: QuoteSet) => void) => {
    const next = structuredClone(working);
    fn(next);
    setDraft(next);
  };

  const apply = () => {
    const { quoteSet: qs, errors: errs } = validateQuoteSet(working);
    if (errs.length > 0) {
      setErrors(errs);
      return;
    }
    setErrors([]);
    setDraft(null);
    onApply(qs!);
  };

  const discard = () => {
    setDraft(null);
    setErrors([]);
  };

  const disp = (n: number): number | '' => (Number.isNaN(n) ? '' : n);

  // Keep the raw value so Apply-time validation can reject it — never
  // silently truncate decimals or turn a cleared field into 0.
  const num = (raw: string): number => {
    const t = raw.trim();
    if (t === '') return Number.NaN;
    const n = Number(t);
    return Number.isFinite(n) ? n : Number.NaN;
  };

  const numOrNull = (raw: string): number | null => (raw.trim() === '' ? null : num(raw));

  return (
    <section className="card details-card quotes" aria-label="Vendor quotes">
      <details className="quotes" open>
        <summary>
          Vendor quotes — example pretax prices (USD cents, no tax modeled)
          <span className="hint">editable · quoted {quoteSet.quotedAt} · valid until {quoteSet.validUntil}</span>
        </summary>

        <div className="quotes-grid">
          <table className="table">
            <thead>
              <tr>
                <th>Vendor</th>
                <th>Delivery (days)</th>
                <th>Shipping ¢</th>
                <th>Free‑ship ≥ ¢</th>
                <th>Min order ¢</th>
                {skus.map((s) => (
                  <th key={s}>{s} unit ¢ / stock</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {working.vendors.map((v, vi) => (
                <tr key={v.id}>
                  <td style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{v.name}</td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      aria-label={`${v.name} delivery days`}
                      value={disp(v.deliveryDays)}
                      onChange={(e) => patch((qs) => void (qs.vendors[vi].deliveryDays = num(e.target.value)))}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      aria-label={`${v.name} shipping cents`}
                      value={disp(v.shippingCents)}
                      onChange={(e) => patch((qs) => void (qs.vendors[vi].shippingCents = num(e.target.value)))}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      placeholder="none"
                      aria-label={`${v.name} free shipping threshold`}
                      value={v.freeShipThresholdCents == null || Number.isNaN(v.freeShipThresholdCents) ? '' : v.freeShipThresholdCents}
                      onChange={(e) =>
                        patch((qs) => void (qs.vendors[vi].freeShipThresholdCents = numOrNull(e.target.value)))
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      placeholder="none"
                      aria-label={`${v.name} minimum order`}
                      value={v.minOrderCents == null || Number.isNaN(v.minOrderCents) ? '' : v.minOrderCents}
                      onChange={(e) =>
                        patch((qs) => void (qs.vendors[vi].minOrderCents = numOrNull(e.target.value)))
                      }
                    />
                  </td>
                  {skus.map((s) => {
                    const q = v.quotes[s];
                    return (
                      <td key={s} style={{ whiteSpace: 'nowrap' }}>
                        {q ? (
                          <>
                            <input
                              type="number"
                              min={0}
                              aria-label={`${v.name} ${s} unit cents`}
                              value={disp(q.unitCents)}
                              onChange={(e) =>
                                patch((qs) => void (qs.vendors[vi].quotes[s].unitCents = num(e.target.value)))
                              }
                            />
                            <input
                              type="number"
                              min={0}
                              aria-label={`${v.name} ${s} stock`}
                              value={disp(q.stock)}
                              onChange={(e) =>
                                patch((qs) => void (qs.vendors[vi].quotes[s].stock = num(e.target.value)))
                              }
                            />
                          </>
                        ) : (
                          <span className="dash">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {errors.length > 0 && (
          <ul className="import-errors" role="alert">
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        )}

        <div className="modal-actions">
          <button className="btn primary" onClick={apply} disabled={draft === null}>
            Apply quote changes
          </button>
          <button className="btn ghost" onClick={discard} disabled={draft === null}>
            Discard
          </button>
          <span className="hint" style={{ color: 'var(--muted)', fontSize: 12.5 }}>
            Changes invalidate the current plan and any approval.
          </span>
        </div>
      </details>
    </section>
  );
}
