import type { BookingRow, Totals } from '../types.ts';
import { fmtMoney, fmtInstant } from '../format.ts';
import { Pill } from './bits.tsx';

export function SummaryCard(props: {
  totals: Totals;
  canReview: boolean;
  onReview: () => void;
  onExport: () => void;
  busy: boolean;
}) {
  const t = props.totals;
  const allDone = t.estimatedRefundableMinor === 0 && t.packetRefundableMinor > 0;
  const confirmed = t.confirmedCancellations ?? 0;
  const queued = t.queuedCancellations ?? 0;
  const failed = t.failedCancellations ?? 0;
  const confirmText =
    confirmed === 0
      ? `0${queued ? ` — ${queued} approved, not yet run` : ''}`
      : `${confirmed}${queued ? ` confirmed, ${queued} queued` : ' confirmed'}${failed ? `, ${failed} failed` : ''}`;
  return (
    <section className="card summary-card" aria-label="Cancellation summary">
      <h2>Cancellation summary</h2>
      <dl className="summary-rows">
        <div className="summary-row">
          <dt>Refundable if canceled now</dt>
          <dd className="big">{fmtMoney(t.estimatedRefundableMinor)}</dd>
        </div>
        {allDone && (
          <div className="summary-row">
            <dt className="cell-sub dim">Remaining potential is $0 — reviewed bookings already confirmed.</dt>
            <dd />
          </div>
        )}
        <div className="summary-row">
          <dt>Future charges avoided</dt>
          <dd>{fmtMoney(t.estimatedFutureChargesAvoidedMinor)}</dd>
        </div>
        <div className="summary-row">
          <dt>Extra cancellation charges due</dt>
          <dd>{fmtMoney(t.estimatedExtraChargesMinor)}</dd>
        </div>
        <div className="summary-row net">
          <dt>Net estimated benefit</dt>
          <dd>{fmtMoney(t.netEstimatedBenefitMinor)}</dd>
        </div>
      </dl>
      <p className="cell-sub dim">Remaining-potential figures count only still-active bookings.</p>
      <dl className="summary-rows confirmed">
        <div className="summary-row">
          <dt>Approved packet estimate</dt>
          <dd>{fmtMoney(t.packetRefundableMinor)}</dd>
        </div>
        <div className="summary-row">
          <dt>Cancellations (simulated)</dt>
          <dd>{confirmText}</dd>
        </div>
        <div className="summary-row">
          <dt>Refunds due (estimated)</dt>
          <dd>{fmtMoney(t.confirmedRefundsDueMinor)}</dd>
        </div>
        <div className="summary-row">
          <dt>Refunds received</dt>
          <dd>{fmtMoney(t.receivedRefundsMinor)}</dd>
        </div>
      </dl>
      <button className="btn primary" onClick={props.onReview} disabled={!props.canReview || props.busy}>
        Review cancellation packet
      </button>
      <button className="btn outline" onClick={props.onExport} disabled={props.busy}>
        Export requests
      </button>
    </section>
  );
}

export function ConfirmationsCard(props: { bookings: BookingRow[] }) {
  const rows = props.bookings.filter((b) => b.outcomes.length > 0 || b.status === 'cancel_confirmed');
  const preparedOnly = props.bookings.filter(
    (b) => b.request && ['prepared', 'approved', 'stale'].includes(b.request.status) && b.outcomes.length === 0,
  );
  return (
    <section className="card confirmations-card" aria-label="Provider confirmations">
      <h2>Provider confirmations</h2>
      {rows.length === 0 && preparedOnly.length === 0 && (
        <p className="cell-sub">
          No sandbox cancellation requests have run yet. Approving the packet queues simulated provider calls —
          nothing is sent to a real provider, ever. Results will appear here.
        </p>
      )}
      {preparedOnly.length > 0 && (
        <p className="cell-sub">
          {preparedOnly.length} request{preparedOnly.length === 1 ? '' : 's'} queued for the sandbox —{' '}
          <em>not sent</em>. Run execution to record simulated outcomes here.
        </p>
      )}
      <ul className="confirm-list">
        {rows.map((b) => {
          const last = b.outcomes[b.outcomes.length - 1];
          return (
            <li key={b.bookingId}>
              <div>
                <strong>{b.provider}</strong>
                <div className="cell-sub">
                  {last ? last.detail : 'Confirmed (simulated)'}
                </div>
                {b.request?.refundReceivedMinor != null && (
                  <div className="cell-sub">Simulated refund received: {fmtMoney(b.request.refundReceivedMinor)}</div>
                )}
                {last && <div className="cell-sub dim">attempt {last.attempt} · {fmtInstant(last.recordedInstant)} Toronto</div>}
              </div>
              <div className="confirm-right">
                {last?.outcome === 'confirmed' || b.status === 'cancel_confirmed' ? (
                  <Pill tone="green">Confirmed — simulated</Pill>
                ) : last?.outcome === 'failed' ? (
                  <Pill tone="red">Failed — retry available</Pill>
                ) : (
                  <Pill tone="gray">Pending</Pill>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
