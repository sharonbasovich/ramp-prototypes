import { formatCents } from '../engine/money';
import type { AllocationPlan, Reservation, ReserveFailure } from '../engine/types';

interface Props {
  plan: AllocationPlan | null;
  busy: boolean;
  reserveFailures: ReserveFailure[];
  confirmedReservations: Reservation[];
  confirmedCostCents: number | null;
  onReserve: () => void;
  onExport: () => void;
}

export default function ReviewPanel({
  plan,
  busy,
  reserveFailures,
  confirmedReservations,
  confirmedCostCents,
  onReserve,
  onExport,
}: Props) {
  const transferTotal = plan?.transfers.reduce((s, l) => s + l.costCents, 0) ?? 0;
  const purchaseTotal =
    plan?.purchases.reduce((s, l) => s + l.lineCostCents, 0) ?? 0;
  const purchaseUnits = plan?.purchases.reduce((s, l) => s + l.quantity, 0) ?? 0;

  const canReserve =
    !!plan && plan.status === 'ok' && confirmedReservations.length === 0 && !busy;

  return (
    <section className="card" aria-labelledby="rev-h">
      <h2 id="rev-h">3. Review and reserve</h2>
      {!plan && <p className="sub">Run a request to compare costs.</p>}

      {plan && (
        <>
          <div className="sum-row">
            <span className="label">
              All new purchase
              {plan.baseline && (
                <span className="hint">
                  {plan.baseline.purchases
                    .map((p) => `${p.quantity} × ${formatCents(p.unitCostCents, plan.currency)}`)
                    .join(' + ')}
                </span>
              )}
            </span>
            <span className="value">
              {plan.baseline ? formatCents(plan.baseline.costCents, plan.currency) : 'Not feasible'}
            </span>
          </div>
          {plan.baselineNote && (
            <p style={{ margin: '0 0 6px', fontSize: 12, color: 'var(--ink-3)' }}>
              {plan.baselineNote}
            </p>
          )}

          <div className="sum-row sum-total">
            <span className="label">Proposed solution</span>
            <span className="value">{formatCents(plan.totalCostCents, plan.currency)}</span>
          </div>
          {plan.transfers.length > 0 && (
            <div className="sum-row">
              <span className="label" style={{ paddingLeft: 12 }}>
                {plan.transfers.length} × transfer costs
              </span>
              <span>{formatCents(transferTotal, plan.currency)}</span>
            </div>
          )}
          {purchaseUnits > 0 && (
            <div className="sum-row">
              <span className="label" style={{ paddingLeft: 12 }}>
                {purchaseUnits} × new monitor{purchaseUnits === 1 ? '' : 's'}
              </span>
              <span>{formatCents(purchaseTotal, plan.currency)}</span>
            </div>
          )}
          {plan.shortage > 0 && (
            <div className="sum-row">
              <span className="label" style={{ paddingLeft: 12, color: 'var(--red)' }}>
                {plan.shortage} × unfulfilled (shortage)
              </span>
            </div>
          )}

          {confirmedReservations.length > 0 ? (
            <div className="confirmed-box" role="status">
              <div className="t">
                Confirmed purchasing plan ·{' '}
                {confirmedCostCents !== null ? formatCents(confirmedCostCents, plan.currency) : ''}
              </div>
              <div className="d">
                {confirmedReservations.length} asset
                {confirmedReservations.length === 1 ? '' : 's'} reserved in one transaction. This is a
                confirmed plan — not realized savings.
              </div>
              <ul>
                {confirmedReservations.map((r) => (
                  <li key={r.id}>
                    {r.assetId} · reservation {r.id}
                  </li>
                ))}
              </ul>
            </div>
          ) : plan.potentialAvoidedCents !== null && plan.potentialAvoidedCents > 0 ? (
            <div className="avoided-box">
              <div className="label">Potential spending avoided</div>
              <div className="amount">
                {formatCents(plan.potentialAvoidedCents, plan.currency)}
              </div>
              <div className="note">Becomes a confirmed plan only after you reserve.</div>
            </div>
          ) : (
            <div className="avoided-box none">
              <div className="label">No savings claim</div>
              <div className="amount">
                {plan.baseline === null
                  ? 'No feasible all-new baseline to compare against'
                  : plan.shortage > 0
                    ? 'Plan does not cover the full quantity'
                    : 'Reuse does not beat buying new here'}
              </div>
              <div className="note">We never show a number we cannot back.</div>
            </div>
          )}

          {reserveFailures.length > 0 && (
            <div className="err-box" role="alert">
              <div className="t">Reservation rejected — plan was stale or conflicted</div>
              <ul>
                {reserveFailures.map((f, i) => (
                  <li key={i}>{f.detail}</li>
                ))}
              </ul>
              <div style={{ marginTop: 6 }}>The plan above has been recalculated.</div>
            </div>
          )}

          {plan.conditional && confirmedReservations.length === 0 && (
            <div className="warn-box">
              <div>
                <div className="t">Confirm availability before reserving</div>
                <div className="d">
                  Items may no longer be available by the time you confirm. Use “Request from
                  owner” to confirm conditional assets first.
                </div>
              </div>
            </div>
          )}
          {!plan.conditional && plan.status !== 'infeasible' && confirmedReservations.length === 0 && (
            <div className="warn-box">
              <div>
                <div className="t">Confirm availability before reserving</div>
                <div className="d">
                  Items may no longer be available by the time you confirm — reservations are
                  revalidated before they are written.
                </div>
              </div>
            </div>
          )}

          <button
            className="btn btn-primary"
            disabled={!canReserve}
            onClick={onReserve}
            title={
              confirmedReservations.length > 0
                ? 'Already reserved'
                : plan.conditional
                  ? 'Owner confirmation is still required'
                  : plan.status === 'partial'
                    ? 'Resolve the shortage first'
                    : plan.status === 'infeasible'
                      ? 'Nothing feasible to reserve'
                      : 'Validate and reserve all selected assets in one transaction'
            }
          >
            {confirmedReservations.length > 0
              ? 'Reserved'
              : busy
                ? 'Reserving…'
                : 'Confirm and reserve'}
          </button>
          <div style={{ height: 10 }} />
          <button className="btn btn-secondary" onClick={onExport} disabled={!plan}>
            Export purchase list
          </button>
          <p style={{ margin: '12px 0 0', fontSize: 12, color: 'var(--ink-3)' }}>
            Example prices in {plan.currency}. Demo data — no real purchases.
          </p>
        </>
      )}
    </section>
  );
}
