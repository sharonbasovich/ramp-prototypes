import { useState } from 'react';
import type { BookingRow } from '../types.ts';
import { fmtInstantFull, fmtMoney, fmtUtc, dollarsToMinor } from '../format.ts';
import { Modal, Pill, requestStatusPill } from './bits.tsx';

function boundaryText(tier: { boundary: string; cutoffInstant?: string | null }): string {
  if (tier.boundary === 'before' && tier.cutoffInstant) return `now < ${tier.cutoffInstant}`;
  if (tier.boundary === 'at_or_after' && tier.cutoffInstant) return `now ≥ ${tier.cutoffInstant}`;
  if (tier.boundary === 'always') return 'always applies';
  return 'unusable boundary';
}

export function BookingModal(props: {
  booking: BookingRow;
  clockIso: string;
  busy: boolean;
  onClose: () => void;
  onEditAmounts: (bookingId: string, patch: { committedMinor: number; paidMinor: number; unpaidMinor: number }) => void;
  onRetry: (b: BookingRow) => void;
  onReceipt: (b: BookingRow) => void;
}) {
  const b = props.booking;
  const a = b.assessment;
  const [editing, setEditing] = useState(false);
  const [c, setC] = useState(String(b.committedMinor / 100));
  const [p, setP] = useState(String(b.paidMinor / 100));
  const [u, setU] = useState(String(b.unpaidMinor / 100));
  const [err, setErr] = useState<string | null>(null);

  const save = () => {
    const cm = dollarsToMinor(c);
    const pm = dollarsToMinor(p);
    const um = dollarsToMinor(u);
    if (cm === null || pm === null || um === null) {
      setErr('All amounts must be non-negative dollar values.');
      return;
    }
    if (cm !== pm + um) {
      setErr(`Committed must equal paid + unpaid ($${(cm / 100).toFixed(2)} ≠ $${(pm / 100).toFixed(2)} + $${(um / 100).toFixed(2)}).`);
      return;
    }
    setErr(null);
    props.onEditAmounts(b.bookingId, { committedMinor: cm, paidMinor: pm, unpaidMinor: um });
    setEditing(false);
  };

  return (
    <Modal title={`${b.service} — ${b.provider}`} onClose={props.onClose} wide>
      <div className="detail-grid">
        <section>
          <h4>Booking</h4>
          <dl className="kv">
            <div><dt>Confirmation ref</dt><dd>{b.confirmationRef || '—'}</dd></div>
            <div><dt>Service</dt><dd>{b.serviceLabel}</dd></div>
            <div><dt>Status</dt><dd>{b.status}{b.canceledInstant ? ` · ${fmtInstantFull(b.canceledInstant)}` : ''}</dd></div>
            <div><dt>Version</dt><dd>v{b.version}</dd></div>
          </dl>
          <h4>Money (sample USD, integer cents)</h4>
          <dl className="kv">
            <div><dt>Committed total</dt><dd>{fmtMoney(b.committedMinor)}</dd></div>
            <div><dt>Amount paid</dt><dd>{fmtMoney(b.paidMinor)}</dd></div>
            <div><dt>Unpaid balance</dt><dd>{fmtMoney(b.unpaidMinor)}</dd></div>
          </dl>
          {b.status === 'active' && !editing && (
            <button className="btn outline sm" onClick={() => setEditing(true)}>
              Edit amounts
            </button>
          )}
          {editing && (
            <div className="edit-amounts">
              <label>Committed $<input value={c} onChange={(e) => setC(e.target.value)} inputMode="decimal" /></label>
              <label>Paid $<input value={p} onChange={(e) => setP(e.target.value)} inputMode="decimal" /></label>
              <label>Unpaid $<input value={u} onChange={(e) => setU(e.target.value)} inputMode="decimal" /></label>
              {err && <div className="form-error">{err}</div>}
              <div className="btn-row">
                <button className="btn primary sm" onClick={save} disabled={props.busy}>Save</button>
                <button className="btn ghost sm" onClick={() => setEditing(false)}>Cancel</button>
              </div>
              <p className="cell-sub dim">Changing amounts bumps the booking version and invalidates any approval.</p>
            </div>
          )}
        </section>
        <section>
          <h4>Cancellation assessment <span className="dim">at {fmtInstantFull(props.clockIso)}</span></h4>
          {a.status === 'assessed' ? (
            <>
              <dl className="kv">
                <div><dt>Applicable tier</dt><dd>{a.tierLabel}</dd></div>
                <div><dt>Boundary</dt><dd><code>{boundaryText({ boundary: a.boundary ?? '', cutoffInstant: a.cutoffInstant })}</code></dd></div>
                {a.cutoffInstant && (
                  <>
                    <div><dt>Cutoff (UTC)</dt><dd>{fmtUtc(a.cutoffInstant)}</dd></div>
                    <div><dt>Cutoff (Toronto)</dt><dd>{fmtInstantFull(a.cutoffInstant)}</dd></div>
                  </>
                )}
                <div><dt>Cancellation fee</dt><dd>{fmtMoney(a.feeMinor)}</dd></div>
                <div><dt>Estimated refund</dt><dd>{fmtMoney(a.refundMinor)} = max(paid − fee, 0)</dd></div>
                <div><dt>Extra payment due</dt><dd>{fmtMoney(a.extraPaymentMinor)} = max(fee − paid, 0)</dd></div>
                <div><dt>Future charges avoided</dt><dd>{fmtMoney(a.futureChargesAvoidedMinor)} (unpaid balance)</dd></div>
                <div className="net"><dt>Net benefit</dt><dd>{fmtMoney(a.netBenefitMinor)} = committed − fee</dd></div>
              </dl>
            </>
          ) : (
            <div className="callout warn">
              <Pill tone={a.status === 'invalid' ? 'red' : 'gray'}>{a.status === 'invalid' ? 'Invalid data' : 'Manual review'}</Pill>
              <p>{a.detail}</p>
            </div>
          )}
          <h4>Policy {a.policyVersion ? `(${a.policyId} ${a.policyVersion})` : ''}</h4>
          {b.policy ? (
            <>
              <p className="cell-sub">{b.policy.summary}</p>
              <p className="cell-sub dim">Source: {b.policy.sourceRef}</p>
              {!b.policy.supported && <div className="callout warn">This policy is marked unsupported — a person must review the terms. No refund is estimated.</div>}
              {b.policy.tiers.length > 0 && (
                <table className="tiers">
                  <thead><tr><th>Tier</th><th>Applies when</th><th>Fee</th></tr></thead>
                  <tbody>
                    {b.policy.tiers.map((t) => (
                      <tr key={t.tierId} className={a.tierId === t.tierId ? 'active-tier' : ''}>
                        <td>{t.label ?? t.tierId}{a.tierId === t.tierId ? ' (applies now)' : ''}</td>
                        <td>
                          <code>{boundaryText(t)}</code>
                          {t.cutoffInstant && <div className="cell-sub dim">{fmtInstantFull(t.cutoffInstant)}</div>}
                        </td>
                        <td>{t.fee.kind === 'fixed' ? fmtMoney(t.fee.amountMinor) : `${t.fee.percent}% of committed`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          ) : (
            <div className="callout warn">No cancellation policy is linked to this booking.</div>
          )}
        </section>
      </div>
      <section className="request-section">
        <h4>Cancellation request</h4>
        {b.request ? (
          <>
            <div className="request-head">
              {requestStatusPill(b)}
              <span className="cell-sub dim">idempotency key: <code>{b.request.idempotencyKey}</code></span>
            </div>
            <dl className="kv">
              <div><dt>Assessed at</dt><dd>{fmtInstantFull(b.request.assessedInstant)}</dd></div>
              <div><dt>Approved at</dt><dd>{b.request.approvedInstant ? fmtInstantFull(b.request.approvedInstant) : '—'}</dd></div>
              {b.request.staleReason && <div><dt>Stale reason</dt><dd>{b.request.staleReason}</dd></div>}
            </dl>
            {b.outcomes.length > 0 && (
              <table className="tiers">
                <thead><tr><th>Attempt</th><th>Outcome</th><th>Detail</th><th>Recorded</th></tr></thead>
                <tbody>
                  {b.outcomes.map((o) => (
                    <tr key={o.attempt}>
                      <td>{o.attempt}</td>
                      <td>{o.outcome === 'confirmed' ? <Pill tone="green">confirmed (simulated)</Pill> : <Pill tone="red">failed (simulated)</Pill>}</td>
                      <td>{o.detail}{o.ref ? ` · ref ${o.ref}` : ''}</td>
                      <td>{fmtInstantFull(o.recordedInstant)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="btn-row">
              {b.request.status === 'failed' && (
                <button className="btn primary sm" onClick={() => props.onRetry(b)} disabled={props.busy}>Retry sandbox provider</button>
              )}
              {b.request.status === 'executed' && b.request.refundReceivedMinor == null && (
                <button className="btn outline sm" onClick={() => props.onReceipt(b)} disabled={props.busy}>
                  Record simulated refund receipt
                </button>
              )}
            </div>
          </>
        ) : (
          <p className="cell-sub">Not part of the packet yet — review the packet to include this booking.</p>
        )}
      </section>
    </Modal>
  );
}
