import { useCallback, useEffect, useRef, useState } from 'react';
import { allocate } from './engine/allocate';
import { defaultRequest } from './engine/fixtures';
import { buildExport, exportToCsv } from './engine/export';
import type { AllocationPlan, EquipmentRequest, Reservation, ReserveFailure, World } from './engine/types';
import { createBackend, type Backend } from './backend/client';
import Header from './components/Header';
import RequestPanel from './components/RequestPanel';
import AllocationPanel from './components/AllocationPanel';
import ReviewPanel from './components/ReviewPanel';
import InventoryTable from './components/InventoryTable';
import LocationsView from './components/LocationsView';

export default function App() {
  const [backend, setBackend] = useState<Backend | null>(null);
  const [world, setWorld] = useState<World | null>(null);
  const [view, setView] = useState<'equipment' | 'locations'>('equipment');
  const [request, setRequest] = useState<EquipmentRequest>(defaultRequest());
  const [plan, setPlan] = useState<AllocationPlan | null>(null);
  const [excludedAssets, setExcludedAssets] = useState<Set<string>>(new Set());
  const [includedAssets, setIncludedAssets] = useState<Set<string>>(new Set());
  const [excludedQuotes, setExcludedQuotes] = useState<Set<string>>(new Set());
  const [confirmed, setConfirmed] = useState<{
    reservations: Reservation[];
    costCents: number;
    plan: AllocationPlan;
  } | null>(null);
  const [reserveFailures, setReserveFailures] = useState<ReserveFailure[]>([]);
  const [banner, setBanner] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const requestSeq = useRef(0);

  // Boot: detect backend (SQLite only after a real /api/health), load world.
  useEffect(() => {
    let cancelled = false;
    void createBackend().then(async (b) => {
      const w = await b.loadState();
      if (cancelled) return;
      setBackend(b);
      setWorld(w);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const replan = useCallback(
    (req: EquipmentRequest, w: World, exclA: Set<string>, inclA: Set<string>, exclQ: Set<string>) => {
      const next = allocate(req, w, w.demoNow, {
        excludeAssetIds: [...exclA],
        includeAssetIds: [...inclA],
        excludeQuoteIds: [...exclQ],
      });
      setPlan(next);
      setStatusMsg(
        next.status === 'ok' || next.status === 'conditional'
          ? `Plan ready: ${next.transfers.length} transfers, ${next.purchases.reduce((s, p) => s + p.quantity, 0)} purchases, total ${(next.totalCostCents / 100).toFixed(2)} ${next.currency}.`
          : `Plan ${next.status}: shortage ${next.shortage}.`,
      );
    },
    [],
  );

  // Re-run the allocation whenever inputs, overrides, or the world change.
  useEffect(() => {
    if (world) replan(request, world, excludedAssets, includedAssets, excludedQuotes);
  }, [world, request, excludedAssets, includedAssets, excludedQuotes, replan]);

  const changeRequest = (next: EquipmentRequest) => {
    setRequest(next);
    setConfirmed(null);
    setReserveFailures([]);
    setBanner(null);
  };

  const runFind = () => {
    if (!world) return;
    requestSeq.current += 1;
    setRequest((r) => ({ ...r, id: `req-${requestSeq.current}` }));
    setConfirmed(null);
    setReserveFailures([]);
    replan(request, world, excludedAssets, includedAssets, excludedQuotes);
  };

  const toggleAsset = (assetId: string, on: boolean) => {
    setExcludedAssets((prev) => {
      const next = new Set(prev);
      if (on) next.delete(assetId);
      else next.add(assetId);
      return next;
    });
    if (!on) {
      setIncludedAssets((prev) => {
        const next = new Set(prev);
        next.delete(assetId);
        return next;
      });
    }
    setConfirmed(null);
  };

  const toggleQuote = (quoteId: string, on: boolean) => {
    setExcludedQuotes((prev) => {
      const next = new Set(prev);
      if (on) next.delete(quoteId);
      else next.add(quoteId);
      return next;
    });
    setConfirmed(null);
  };

  const useAsset = (assetId: string) => {
    setExcludedAssets((prev) => {
      const next = new Set(prev);
      next.delete(assetId);
      return next;
    });
    setIncludedAssets((prev) => new Set(prev).add(assetId));
    setConfirmed(null);
    setBanner({ kind: 'info', text: `${assetId} forced into the plan.` });
  };

  const ownerConfirm = async (assetId: string) => {
    if (!backend) return;
    const w = await backend.ownerConfirm(assetId);
    setWorld(w);
    setBanner({
      kind: 'info',
      text: `Simulated owner confirmation recorded for ${assetId} (demo — no message was actually sent).`,
    });
  };

  const reserve = async () => {
    if (!backend || !plan || !world) return;
    setBusy(true);
    setReserveFailures([]);
    try {
      const result = await backend.reserve(request, plan);
      setWorld(result.world);
      if (result.ok) {
        setConfirmed({ reservations: result.reservations, costCents: plan.totalCostCents, plan });
        setBanner({
          kind: 'info',
          text: `${result.reservations.length} asset(s) reserved atomically for ${request.id}. Confirmed purchasing plan — not realized savings.`,
        });
      } else {
        setReserveFailures(result.failures);
        setBanner({
          kind: 'error',
          text: 'Reservation rejected — the plan was recalculated against current inventory.',
        });
      }
    } catch (err) {
      setBanner({ kind: 'error', text: `Reservation failed: ${String(err)}` });
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!backend) return;
    const w = await backend.reset();
    setWorld(w);
    setExcludedAssets(new Set());
    setIncludedAssets(new Set());
    setExcludedQuotes(new Set());
    setConfirmed(null);
    setReserveFailures([]);
    setRequest(defaultRequest());
    setBanner({ kind: 'info', text: 'Demo fixtures restored.' });
  };

  const doExport = () => {
    if (!plan || !world || !backend) return;
    // Export the approved allocation — after reserving, that's the frozen
    // confirmed plan, not the recomputed one against reduced inventory.
    const exportPlan = confirmed?.plan ?? plan;
    const doc = buildExport(
      exportPlan,
      world,
      confirmed?.reservations ?? [],
      backend.mode,
      world.demoNow,
    );
    const csv = exportToCsv(doc);
    const blob = new Blob([JSON.stringify(doc, null, 2) + '\n\n' + csv], {
      type: 'text/plain',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `borrowfirst-plan-${exportPlan.request.id}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importCsv = async (text: string) => {
    if (!backend) return;
    try {
      const result = await backend.importCsv(text);
      setWorld(result.world);
      const parts = [`Imported ${result.added} asset${result.added === 1 ? '' : 's'}`];
      if (result.errors.length > 0) parts.push(`${result.errors.length} row(s) skipped: ${result.errors[0]}${result.errors.length > 1 ? '…' : ''}`);
      setBanner({ kind: result.errors.length > 0 ? 'error' : 'info', text: parts.join(' — ') });
    } catch (err) {
      setBanner({ kind: 'error', text: `Import failed: ${String(err)}` });
    }
  };

  return (
    <div className="app-shell">
      <Header
        view={view}
        onNavigate={setView}
        modeLabel={backend?.modeLabel ?? 'Detecting mode…'}
        mode={backend?.mode ?? 'sandbox'}
        modeDetail={backend?.modeDetail ?? ''}
        onReset={reset}
      />

      {view === 'equipment' ? (
        <>
          <div className="hero">
            <h1>Before you buy it, find what you already own.</h1>
            <p>
              Search across your organization to reuse equipment, reduce costs and avoid
              unnecessary purchases.
            </p>
          </div>

          {banner && (
            <div className={`banner ${banner.kind}`} role={banner.kind === 'error' ? 'alert' : 'status'}>
              <span>{banner.text}</span>
              <button aria-label="Dismiss" onClick={() => setBanner(null)}>
                ×
              </button>
            </div>
          )}

          <div className="flow-grid">
            {world && (
              <RequestPanel
                request={request}
                locations={world.locations}
                onChange={changeRequest}
                onFind={runFind}
              />
            )}
            {world && (
              <AllocationPanel
                plan={plan}
                world={world}
                excludedAssets={excludedAssets}
                excludedQuotes={excludedQuotes}
                onToggleAsset={toggleAsset}
                onToggleQuote={toggleQuote}
                onOwnerConfirm={ownerConfirm}
              />
            )}
            <ReviewPanel
              plan={plan}
              busy={busy}
              reserveFailures={reserveFailures}
              confirmedReservations={confirmed?.reservations ?? []}
              confirmedCostCents={confirmed?.costCents ?? null}
              onReserve={reserve}
              onExport={doExport}
            />
          </div>

          {world && (
            <InventoryTable
              plan={plan}
              world={world}
              onUse={useAsset}
              onOwnerConfirm={ownerConfirm}
              onImport={importCsv}
            />
          )}
        </>
      ) : (
        world && <LocationsView world={world} />
      )}

      <p className="footer-note">
        <strong>Demo data. No real purchases.</strong> {backend?.modeLabel ?? '…'} —{' '}
        {backend?.mode === 'sqlite'
          ? 'state lives in a local node:sqlite database; reservations commit transactionally.'
          : 'state lives in this browser only (localStorage + Web Locks); no server, no cross-device atomicity.'}{' '}
        Owner confirmations, prices, inventory and arrivals are labeled examples.
      </p>
      <div className="sr-status" aria-live="polite">
        {statusMsg}
      </div>
    </div>
  );
}
