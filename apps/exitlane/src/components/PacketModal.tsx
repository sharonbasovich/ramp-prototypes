import type { BookingRow } from '../types.ts';
import { fmtInstantFull, fmtMoney } from '../format.ts';
import { Modal, Pill, requestStatusPill } from './bits.tsx';

export function PacketModal(props: {
  bookings: BookingRow[];
  clockIso: string;
  mode: 'sqlite' | 'browser';
  busy: boolean;
  onClose: () => void;
  onApprove: () => void;
  onExecute: () => void;
  onExecuteOne: (b: BookingRow) => void;
  onExport: () => void;
}) {
  const executable = props.bookings.filter((b) => b.request && ['prepared', 'approved', 'stale', 'executed', 'failed'].includes(b.request.status));
  const excluded = props.bookings.filter((b) => b.request?.status === 'excluded' || b.status !== 'active' && !b.request);
  const notInPacket = props.bookings.filter((b) => !b.request && b.status === 'active');
  const prepared = executable.filter((b) => b.request!.status === 'prepared').length;
  const approved = executable.filter((b) => b.request!.status === 'approved').length;
  const stale = executable.filter((b) => b.request!.status === 'stale' || b.approvalStale).length;

  return (
    <Modal title="Cancellation packet — sandbox" onClose={props.onClose} wide>
      <p className="cell-sub">
        Assessed at <strong>{fmtInstantFull(props.clockIso)}</strong> (demo clock). Approving binds each request to the
        booking version, policy version, and figures below — any change makes the approval stale and blocks
        execution. Providers are scripted sandbox fakes; <strong>nothing is sent to a real provider</strong>.
      </p>
      {notInPacket.length > 0 && (
        <div className="callout warn">
          {notInPacket.map((b) => b.service).join(', ')} {notInPacket.length === 1 ? 'is' : 'are'} not in this packet —
          it was prepared before the packet was assembled or re-check is pending. Re-run prepare to include it.
        </div>
      )}
      <table className="tiers packet">
        <thead>
          <tr>
            <th>Booking</th>
            <th>Est. refund</th>
            <th>Extra due</th>
            <th>Avoided charges</th>
            <th>Net</th>
            <th>State</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {executable.map((b) => {
            const a = b.assessment;
            const r = b.request!;
            const staleNow = b.approvalStale || r.status === 'stale';
            return (
              <tr key={b.bookingId} className={staleNow ? 'stale-row' : ''}>
                <td>
                  <strong>{b.service}</strong>
                  <div className="cell-sub">{b.provider} · v{b.version} · {a.policyVersion ?? 'no policy'}</div>
                </td>
                <td>{a.status === 'assessed' ? fmtMoney(a.refundMinor) : '—'}</td>
                <td>{a.status === 'assessed' ? fmtMoney(a.extraPaymentMinor) : '—'}</td>
                <td>{a.status === 'assessed' ? fmtMoney(a.futureChargesAvoidedMinor) : '—'}</td>
                <td>{a.status === 'assessed' ? fmtMoney(a.netBenefitMinor) : '—'}</td>
                <td>
                  {requestStatusPill(b)}
                  {staleNow && <div className="cell-sub warn">Assessment changed since approval</div>}
                  {r.staleReason && <div className="cell-sub dim">{r.staleReason}</div>}
                </td>
                <td>
                  {r.status === 'failed' && (
                    <button className="btn outline sm" onClick={() => props.onExecuteOne(b)} disabled={props.busy}>
                      Retry
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
          {excluded.map((b) => (
            <tr key={b.bookingId} className="excluded-row">
              <td>
                <strong>{b.service}</strong>
                <div className="cell-sub">{b.provider}</div>
              </td>
              <td colSpan={4}>
                <span className="cell-sub">{b.assessment.detail}</span>
              </td>
              <td>{b.status !== 'active' ? <Pill tone="gray">Already canceled</Pill> : requestStatusPill(b)}</td>
              <td />
            </tr>
          ))}
        </tbody>
      </table>
      <div className="btn-row packet-actions">
        {prepared > 0 && (
          <button className="btn primary" onClick={props.onApprove} disabled={props.busy}>
            Approve packet ({prepared})
          </button>
        )}
        {approved > 0 && (
          <button className="btn primary" onClick={props.onExecute} disabled={props.busy}>
            Execute {approved} approved request{approved === 1 ? '' : 's'} (sandbox)
          </button>
        )}
        {stale > 0 && <Pill tone="red">{stale} stale — re-prepare &amp; re-approve</Pill>}
        <button className="btn outline" onClick={props.onExport} disabled={props.busy}>
          Export packet JSON
        </button>
      </div>
      <p className="cell-sub dim">
        Re-running execution replays recorded outcomes idempotently — a confirmed sandbox cancellation can never
        be counted twice. Failed providers keep their attempt history when retried.
      </p>
    </Modal>
  );
}
