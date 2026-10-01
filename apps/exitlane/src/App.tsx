import { useCallback, useEffect, useState } from 'react';
import { connectBackend } from './backend/browser.ts';
import { torontoInputToInstant, fmtInstant } from './format.ts';
import type { BackendApi, BookingRow, Snapshot } from './types.ts';
import { Header } from './components/Header.tsx';
import { Toolbar } from './components/Toolbar.tsx';
import { Timeline } from './components/Timeline.tsx';
import { BookingsTable } from './components/BookingsTable.tsx';
import { SummaryCard, ConfirmationsCard } from './components/SummaryCard.tsx';
import { BookingModal } from './components/BookingModal.tsx';
import { PacketModal } from './components/PacketModal.tsx';

export default function App() {
  const [backend, setBackend] = useState<BackendApi | null>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);
  const [detail, setDetail] = useState<BookingRow | null>(null);
  const [packetOpen, setPacketOpen] = useState(false);

  const refresh = useCallback(
    async (b?: BackendApi) => {
      const bk = b ?? backend;
      if (!bk) return;
      setSnap(await bk.state());
    },
    [backend],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const b = await connectBackend();
      if (cancelled) return;
      setBackend(b);
      setSnap(await b.state());
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const run = useCallback(
    async (fn: (b: BackendApi) => Promise<unknown>) => {
      if (!backend) return;
      setBusy(true);
      setNotice(null);
      try {
        const r = await fn(backend);
        const res = r as { ok?: boolean; error?: { detail: string } } | undefined;
        if (res && res.ok === false) {
          setNotice({ kind: 'error', text: res.error?.detail ?? 'Operation failed' });
        }
      } catch (e) {
        setNotice({ kind: 'error', text: String((e as Error)?.message ?? e) });
      } finally {
        await refresh();
        setBusy(false);
      }
    },
    [backend, refresh],
  );

  const onReset = () =>
    run(async (b) => {
      const s = await b.reset();
      setPacketOpen(false);
      setDetail(null);
      setNotice({ kind: 'info', text: 'Sandbox reset to the demo fixtures.' });
      return { ok: true, result: s };
    });

  const onCancelEvent = () =>
    run(async (b) => {
      await b.cancelEvent();
      await b.preparePacket();
      setPacketOpen(true);
      setNotice({ kind: 'info', text: 'Event canceled. Packet assembled — review and approve before sandbox execution. Nothing was sent.' });
      return { ok: true };
    });

  const onReview = () =>
    run(async (b) => {
      await b.preparePacket();
      setPacketOpen(true);
      return { ok: true };
    });

  const onSetClock = (torontoLocal: string) =>
    run(async (b) => {
      const iso = torontoInputToInstant(torontoLocal);
      if (!iso) return { ok: false, error: { code: 'bad', detail: 'Enter a valid date/time (Toronto).' } };
      const r = await b.setClock(iso);
      if (r.ok && r.result.staleBookings.length) {
        setNotice({
          kind: 'error',
          text: `Clock moved past a cutoff — approvals for ${r.result.staleBookings.join(', ')} are now stale and cannot execute.`,
        });
      }
      return r;
    });

  const onAdvance = (ms: number) => {
    if (!snap) return;
    const next = new Date(Date.parse(snap.clock.instant) + ms).toISOString();
    run(async (b) => {
      const r = await b.setClock(next);
      if (r.ok && r.result.staleBookings.length) {
        setNotice({
          kind: 'error',
          text: `Clock moved past a cutoff — approvals for ${r.result.staleBookings.join(', ')} are now stale.`,
        });
      }
      return r;
    });
  };

  const onApprove = () => run(async (b) => b.approvePacket());
  const onExecute = () => run(async (b) => b.executePacket());
  const onExecuteOne = (row: BookingRow) =>
    run(async (b) => (row.request ? b.executeRequest(row.request.requestId) : { ok: false, error: { code: 'x', detail: 'no request' } }));
  const onReceipt = (row: BookingRow) =>
    run(async (b) => (row.request ? b.markRefundReceived(row.request.requestId) : { ok: false, error: { code: 'x', detail: 'no request' } }));
  const onEditAmounts = (bookingId: string, patch: { committedMinor: number; paidMinor: number; unpaidMinor: number }) =>
    run(async (b) => b.editBookingAmounts(bookingId, patch));

  const onExport = () =>
    run(async (b) => {
      const packet = await b.exportPacket();
      const blob = new Blob([JSON.stringify(packet, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'exitlane-cancellation-packet.json';
      a.click();
      URL.revokeObjectURL(url);
      setNotice({ kind: 'info', text: 'Packet exported (JSON, simulated mode labeled).' });
      return { ok: true };
    });

  if (!snap) {
    return (
      <div className="app">
        <Header mode={null} onReset={() => {}} />
        <p>Loading sandbox…</p>
      </div>
    );
  }

  return (
    <div className="app">
      <Header mode={backend?.mode ?? null} onReset={onReset} />

      <section className="hero">
        <h1>The off-site was canceled. The bills weren't.</h1>
        <p>
          Cancel bookings, recover what you can, and avoid future charges. Follow the timeline, review the
          policies, approve the packet, then run the labeled sandbox.
        </p>
      </section>

      <Toolbar
        event={snap.event}
        clockIso={snap.clock.instant}
        busy={busy}
        onCancelEvent={onCancelEvent}
        onSetClock={onSetClock}
        onAdvance={onAdvance}
      />

      {notice && (
        <div className={`notice ${notice.kind}`} role="status">
          {notice.text}
        </div>
      )}

      <div className="layout">
        <div className="main-col">
          <Timeline nodes={snap.timeline} clockIso={snap.clock.instant} />

          <BookingsTable bookings={snap.bookings} onDetails={setDetail} onRetry={onExecuteOne} busy={busy} />

          <section className="evidence-banner" aria-label="Policy evidence and approval">
            <div className="evidence-icon" aria-hidden="true">
              <svg width="34" height="40" viewBox="0 0 34 40" fill="none">
                <rect x="1" y="1" width="32" height="38" rx="3" stroke="#1b5fa8" strokeWidth="2" fill="none" />
                <line x1="8" y1="11" x2="26" y2="11" stroke="#1b5fa8" strokeWidth="2" />
                <line x1="8" y1="18" x2="26" y2="18" stroke="#1b5fa8" strokeWidth="2" />
                <line x1="8" y1="25" x2="20" y2="25" stroke="#1b5fa8" strokeWidth="2" />
              </svg>
            </div>
            <div className="evidence-text">
              <strong>Policy evidence and approval</strong>
              <p>
                All cancellation requests include the event details and the reviewed structured policy terms.
                Sandbox provider outcomes and estimated refund amounts are recorded here — nothing is sent to a
                real provider.
              </p>
            </div>
            <button className="btn outline" onClick={onReview} disabled={busy}>
              View packet preview
            </button>
          </section>
        </div>

        <aside className="side-col">
          <SummaryCard
            totals={snap.totals}
            canReview={snap.event.status === 'canceled'}
            onReview={onReview}
            onExport={onExport}
            busy={busy}
          />
          {snap.event.status !== 'canceled' && (
            <p className="cell-sub dim side-note">Cancel the event to assemble the cancellation packet.</p>
          )}
          <ConfirmationsCard bookings={snap.bookings} />
          <section className="card activity-card" aria-label="Activity">
            <h2>Activity</h2>
            <ul className="activity">
              {snap.events.slice(0, 8).map((e) => (
                <li key={e.seq}>
                  <span className="cell-sub dim">{fmtInstant(new Date(e.ts).toISOString())}</span>
                  <span>{e.detail}</span>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>

      <footer className="footer">
        <span>Demo bookings. Sandbox cancellation only.</span>
        <span>Demo data. No real purchases.</span>
      </footer>

      {detail && (
        <BookingModal
          booking={snap.bookings.find((b) => b.bookingId === detail.bookingId) ?? detail}
          clockIso={snap.clock.instant}
          busy={busy}
          onClose={() => setDetail(null)}
          onEditAmounts={onEditAmounts}
          onRetry={onExecuteOne}
          onReceipt={onReceipt}
        />
      )}
      {packetOpen && (
        <PacketModal
          bookings={snap.bookings}
          clockIso={snap.clock.instant}
          mode={backend?.mode ?? 'browser'}
          busy={busy}
          onClose={() => setPacketOpen(false)}
          onApprove={onApprove}
          onExecute={onExecute}
          onExecuteOne={onExecuteOne}
          onExport={onExport}
        />
      )}
    </div>
  );
}
