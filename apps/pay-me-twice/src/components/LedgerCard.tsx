import { displayPeriod, formatCents } from '../../engine/engine.mjs';
import type { AppState } from '../types';

function resultClass(result: string) {
  if (result === 'Payment recorded') return 'res-ok';
  if (result === 'Duplicate blocked') return 'res-bad';
  if (result === 'Review required' || result === 'Unsupported document') return 'res-warn';
  return 'res-muted';
}

export default function LedgerCard({ state, stats }: { state: AppState | null; stats: AppState['stats'] | undefined }) {
  const attempts = state?.attempts ?? [];
  return (
    <section className="card ledger-card" aria-labelledby="ledger-h">
      <div className="ledger-head">
        <div>
          <h2 id="ledger-h">Sandbox payment ledger</h2>
          <p className="card-sub">Every validation and payment attempt is recorded. No real payments are made.</p>
        </div>
        <div className="ledger-stats">
          <p className="stat-main">
            <span className="stat-check" aria-hidden="true">✓</span>
            <strong>{stats?.paymentsRecorded ?? 0}</strong> payment{stats?.paymentsRecorded === 1 ? '' : 's'} recorded.
          </p>
          <p className="stat-sub">
            {stats?.duplicatesBlocked ?? 0} duplicate sandbox payment{(stats?.duplicatesBlocked ?? 0) === 1 ? '' : 's'} blocked
            {(stats?.reviewHolds ?? 0) > 0 ? ` · ${stats?.reviewHolds} held for review` : ''}
          </p>
          <p className="stat-note">Blocked duplicates are prevented repeats, not measured savings.</p>
        </div>
      </div>
      <div className="table-wrap">
        <table className="ledger-table">
          <thead>
            <tr>
              <th>Date / Time</th><th>Supplier</th><th>Invoice #</th><th>Billing Period</th>
              <th>Amount</th><th>Result</th><th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {attempts.map((a) => (
              <tr key={a.id}>
                <td className="nowrap">{a.at}</td>
                <td>{a.supplier}</td>
                <td className="mono">{a.invoiceNumber}</td>
                <td>{displayPeriod(a.period)}</td>
                <td className="nowrap">{a.amountCents != null ? formatCents(a.amountCents, a.currency || 'USD') : '—'}</td>
                <td><span className={`res-badge ${resultClass(a.result)}`}>{a.result}</span></td>
                <td className="muted">{a.note}</td>
              </tr>
            ))}
            {!attempts.length && (
              <tr><td colSpan={7} className="muted">No attempts yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
