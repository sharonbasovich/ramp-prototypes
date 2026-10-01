import type { ReactNode } from 'react';
import type { BookingRow } from '../types.ts';
import { fmtMoney } from '../format.ts';

export function Modal(props: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={props.title}>
      <div className={`modal${props.wide ? ' wide' : ''}`}>
        <div className="modal-head">
          <h3>{props.title}</h3>
          <button className="btn ghost" onClick={props.onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">{props.children}</div>
      </div>
    </div>
  );
}

export function Pill(props: { tone: 'green' | 'amber' | 'red' | 'gray' | 'blue'; children: ReactNode; title?: string }) {
  return (
    <span className={`pill ${props.tone}`} title={props.title}>
      {props.children}
    </span>
  );
}

export function requestStatusPill(b: BookingRow) {
  const r = b.request;
  if (b.status === 'cancel_confirmed') return <Pill tone="green">Canceled — simulated</Pill>;
  if (!r) return <Pill tone="gray">Not in packet</Pill>;
  switch (r.status) {
    case 'prepared':
      return <Pill tone="blue">In packet</Pill>;
    case 'approved':
      return <Pill tone="blue">Approved</Pill>;
    case 'stale':
      return <Pill tone="red">Stale — re-review</Pill>;
    case 'executed':
      return <Pill tone="green">Confirmed — simulated</Pill>;
    case 'failed':
      return <Pill tone="red">Provider failed</Pill>;
    case 'excluded':
      return r.reason === 'already_canceled' ? (
        <Pill tone="gray">Already canceled</Pill>
      ) : r.reason === 'invalid' ? (
        <Pill tone="red">Invalid data</Pill>
      ) : (
        <Pill tone="amber">Manual review</Pill>
      );
    default:
      return <Pill tone="gray">{r.status}</Pill>;
  }
}

export function assessmentStatusPill(b: BookingRow) {
  const a = b.assessment;
  if (b.status === 'cancel_confirmed') return <Pill tone="green">Canceled — simulated</Pill>;
  if (a.status === 'manual_review') return <Pill tone="amber">Manual review</Pill>;
  if (a.status === 'invalid') return <Pill tone="red">Invalid data</Pill>;
  const refund = a.refundMinor ?? 0;
  const avoided = a.futureChargesAvoidedMinor ?? 0;
  const extra = a.extraPaymentMinor ?? 0;
  const fee = a.feeMinor ?? 0;
  if (fee === 0 && refund > 0) return <Pill tone="green">Refundable</Pill>;
  if (refund > 0) return <Pill tone="amber">Partly refundable</Pill>;
  if (avoided > 0 || extra > 0) return <Pill tone="amber">Avoids charges</Pill>;
  return <Pill tone="red">Too late</Pill>;
}

export function assessmentSubline(b: BookingRow): string {
  const a = b.assessment;
  if (b.status === 'cancel_confirmed') return 'Sandbox provider confirmed.';
  if (a.status !== 'assessed') return a.reason ?? 'Needs review.';
  const parts: string[] = [];
  if ((a.refundMinor ?? 0) > 0) parts.push(`${fmtMoney(a.refundMinor)} estimated refund`);
  if ((a.futureChargesAvoidedMinor ?? 0) > 0) parts.push(`${fmtMoney(a.futureChargesAvoidedMinor)} future charges avoided`);
  if ((a.extraPaymentMinor ?? 0) > 0) parts.push(`${fmtMoney(a.extraPaymentMinor)} extra due`);
  if (!parts.length) return 'Outside policy window.';
  return parts.join(' · ') + '.';
}
