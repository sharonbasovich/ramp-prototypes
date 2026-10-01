import type { BookingRow } from '../types.ts';
import { fmtMoney } from '../format.ts';
import { assessmentStatusPill, assessmentSubline, requestStatusPill } from './bits.tsx';

export function BookingsTable(props: {
  bookings: BookingRow[];
  onDetails: (b: BookingRow) => void;
  onRetry: (b: BookingRow) => void;
  busy: boolean;
}) {
  return (
    <section className="card bookings-card" aria-label="Bookings and cancellation status">
      <h2>Bookings and cancellation status</h2>
      <div className="table-wrap">
        <table className="bookings">
          <thead>
            <tr>
              <th>Service</th>
              <th>Amount paid</th>
              <th>Cancellation fee</th>
              <th>Estimated refund</th>
              <th>Policy</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {props.bookings.map((b) => {
              const a = b.assessment;
              const stale = b.approvalStale || b.request?.status === 'stale';
              return (
                <tr key={b.bookingId} className={stale ? 'stale-row' : ''}>
                  <td>
                    <strong>{b.service}</strong>
                    <div className="cell-sub">{b.provider}</div>
                    <div className="cell-sub dim">{b.serviceLabel}</div>
                  </td>
                  <td>{fmtMoney(b.paidMinor)}</td>
                  <td>
                    {a.status === 'assessed' ? fmtMoney(a.feeMinor) : '—'}
                    {(a.futureChargesAvoidedMinor ?? 0) > 0 && (
                      <div className="cell-sub">avoids {fmtMoney(a.futureChargesAvoidedMinor)} owed</div>
                    )}
                    {(a.extraPaymentMinor ?? 0) > 0 && (
                      <div className="cell-sub warn">+{fmtMoney(a.extraPaymentMinor)} extra due</div>
                    )}
                  </td>
                  <td>{a.status === 'assessed' ? fmtMoney(a.refundMinor) : '—'}</td>
                  <td>
                    <div className="policy-cell">{a.policySummary ?? b.policy?.summary ?? 'No policy on file'}</div>
                    <button className="linklike" onClick={() => props.onDetails(b)}>
                      View policy
                    </button>
                  </td>
                  <td>
                    {assessmentStatusPill(b)}
                    <div className="cell-sub">{assessmentSubline(b)}</div>
                    {b.request && <div className="cell-sub">{requestStatusPill(b)}</div>}
                    {stale && <div className="cell-sub warn">Figures changed — re-review required</div>}
                  </td>
                  <td>
                    <button className="btn outline sm" onClick={() => props.onDetails(b)}>
                      View details
                    </button>
                    {b.request?.status === 'failed' && (
                      <button className="btn outline sm" onClick={() => props.onRetry(b)} disabled={props.busy}>
                        Retry
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="foot-note">
        Fees and refunds are <em>estimated</em> from the linked structured policies at the demo clock — never a
        promise from a provider.
      </p>
    </section>
  );
}
