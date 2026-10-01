import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BasketItem, QuoteSet, SolveResult, Vendor, VendorOrder } from './engine/types';
import { solve, singleVendorBaseline } from './engine/optimize';
import { planSignature } from './engine/signature';
import { validateQuoteSet } from './engine/validate';
import type { Approval } from './approval';
import { isApprovalUsable, reduceApprovalOnSignature } from './approval';
import { SEED_DEADLINE_DAYS, SEED_ITEMS, SEED_QUOTE_SET, SKU_CATALOG } from './data/seed';
import type { PersistedState, StoreAdapter } from './store/adapter';
import { MODE_LABEL } from './store/adapter';
import { probeServer, createServerStore } from './store/server';
import { createBrowserStore } from './store/browser';
import ShoppingList from './components/ShoppingList';
import ResultsPanel from './components/ResultsPanel';
import QuotesPanel from './components/QuotesPanel';
import ImportModal from './components/ImportModal';
import { buildExportJson, buildExportCsv, download } from './export';

interface Computed {
  result: SolveResult;
  baseline: { vendor: Vendor; order: VendorOrder } | null;
  sig: string;
  computedAt: string;
  /** Inputs exactly as they were when this result was computed, so a stale
   * plan never mixes old math with new labels or vendor identities. */
  items: BasketItem[];
  deadlineDays: number;
  quoteSet: QuoteSet;
}

export default function App() {
  const [store, setStore] = useState<StoreAdapter | null>(null);
  const [items, setItems] = useState<BasketItem[]>(SEED_ITEMS);
  const [deadline, setDeadline] = useState<number>(SEED_DEADLINE_DAYS);
  const [quoteSet, setQuoteSet] = useState<QuoteSet>(SEED_QUOTE_SET);
  const [approval, setApproval] = useState<Approval | null>(null);
  const [computed, setComputed] = useState<Computed | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);

  const currentSig = useMemo(
    () => planSignature(items, deadline, quoteSet),
    [items, deadline, quoteSet],
  );

  const compute = useCallback((its: BasketItem[], dl: number, qs: QuoteSet) => {
    // Revalidate quotes at compute time too — an expired or tampered set must
    // never produce a solvable plan, regardless of how it arrived.
    const quoteErrors = validateQuoteSet(qs).errors;
    const result: SolveResult =
      quoteErrors.length > 0
        ? { status: 'infeasible', reasons: quoteErrors.map((e) => `quotes invalid: ${e}`) }
        : solve({ items: its, deadlineDays: dl, quoteSet: qs });
    setComputed({
      result,
      baseline:
        result.status === 'optimal' && quoteErrors.length === 0
          ? singleVendorBaseline({ items: its, deadlineDays: dl, quoteSet: qs })
          : null,
      sig: planSignature(its, dl, qs),
      computedAt: new Date().toISOString(),
      items: its.map((i) => ({ ...i })),
      deadlineDays: dl,
      quoteSet: structuredClone(qs),
    });
  }, []);

  // Boot: pick a store honestly — the server mode is only claimed after a real
  // /api/health round-trip succeeds; otherwise the browser sandbox is used.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const healthy = await probeServer();
      const adapter: StoreAdapter = healthy ? createServerStore() : createBrowserStore();
      if (cancelled) return;
      setStore(adapter);
      try {
        const saved = await adapter.load();
        if (saved && !cancelled) {
          // A persisted quote set that no longer validates (e.g. expired while
          // stored) is dropped back to the seed fixture rather than trusted.
          const savedQs =
            saved.quoteSet &&
            Array.isArray(saved.quoteSet.vendors) &&
            validateQuoteSet(saved.quoteSet).errors.length === 0
              ? saved.quoteSet
              : SEED_QUOTE_SET;
          if (Array.isArray(saved.items) && saved.items.length > 0) setItems(saved.items);
          if (Number.isInteger(saved.deadlineDays)) setDeadline(saved.deadlineDays);
          setQuoteSet(savedQs);
          if (saved.approval && typeof saved.approval.signature === 'string') setApproval(saved.approval);
          compute(
            saved.items ?? SEED_ITEMS,
            saved.deadlineDays ?? SEED_DEADLINE_DAYS,
            savedQs,
          );
        } else {
          compute(SEED_ITEMS, SEED_DEADLINE_DAYS, SEED_QUOTE_SET);
        }
      } catch {
        compute(SEED_ITEMS, SEED_DEADLINE_DAYS, SEED_QUOTE_SET);
      }
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // An approval is revoked — irreversibly — the moment the inputs stop
  // matching its signature. Restoring the old values does not resurrect it.
  useEffect(() => {
    setApproval((a) => reduceApprovalOnSignature(a, currentSig));
  }, [currentSig]);

  // Debounced persistence of sandbox state.
  useEffect(() => {
    if (!loaded || !store) return;
    const state: PersistedState = { items, deadlineDays: deadline, quoteSet, approval };
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      store.save(state).catch((e) => setSaveError(`could not save sandbox state: ${e.message}`));
    }, 250);
    return () => window.clearTimeout(saveTimer.current);
  }, [items, deadline, quoteSet, approval, loaded, store]);

  const dirty = computed === null || computed.sig !== currentSig;
  const approvalValid =
    isApprovalUsable(approval, currentSig) && !dirty && computed?.result.status === 'optimal';

  const runCompute = () => compute(items, deadline, quoteSet);

  const resetDemo = async () => {
    setItems(SEED_ITEMS.map((i) => ({ ...i })));
    setDeadline(SEED_DEADLINE_DAYS);
    setQuoteSet(SEED_QUOTE_SET);
    setApproval(null);
    setSaveError(null);
    compute(SEED_ITEMS, SEED_DEADLINE_DAYS, SEED_QUOTE_SET);
    try {
      await store?.clear();
    } catch {
      /* clearing persistence is best-effort */
    }
  };

  const approvePlan = () => {
    // Approval also revalidates: an expired/mutated quote set must never be
    // approved even if a still-valid plan was computed earlier.
    if (!computed || validateQuoteSet(computed.quoteSet).errors.length > 0) return;
    setApproval({ signature: currentSig, approvedAt: new Date().toISOString() });
  };

  const exportPlan = (format: 'json' | 'csv') => {
    // Export also revalidates: a quote set that expired between compute and
    // export must not produce a plan document.
    if (!approvalValid || computed?.result.status !== 'optimal' || !approval) return;
    if (validateQuoteSet(computed.quoteSet).errors.length > 0) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    if (format === 'json') {
      download(
        `cart-tetris-plan-${stamp}.json`,
        JSON.stringify(buildExportJson({ items, deadline, quoteSet, computed, approval }), null, 2),
        'application/json',
      );
    } else {
      download(
        `cart-tetris-plan-${stamp}.csv`,
        buildExportCsv({ items, deadline, quoteSet, computed, approval }),
        'text/csv',
      );
    }
  };

  return (
    <div className="page">
      <a className="skip-link" href="#results">Skip to results</a>
      <header className="topbar">
        <div className="brand">Cart Tetris</div>
        <button className="reset" onClick={resetDemo}>Reset demo</button>
      </header>

      <section className="hero">
        <div>
          <h1>The cheapest prices made the most expensive cart.</h1>
          <p className="sub">Compare vendors, optimize your order, and see exactly where to buy each item.</p>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => setImportOpen(true)}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M8 10.5V2M4.5 5.5 8 2l3.5 3.5M2.5 11v2.5h11V11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Import quotes
          </button>
          <button
            className="btn"
            onClick={() => {
              setQuoteSet(SEED_QUOTE_SET);
            }}
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M3 2.5h10v11H3zM5.5 5h5M5.5 8h5M5.5 11h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Use example quotes
          </button>
        </div>
      </section>

      <main className="grid">
        <ShoppingList
          items={items}
          deadline={deadline}
          catalog={SKU_CATALOG}
          onItems={setItems}
          onDeadline={setDeadline}
          onCompute={runCompute}
        />
        <div id="results">
          <ResultsPanel
            items={items}
            quoteSet={quoteSet}
            computed={computed}
            dirty={dirty}
            approval={approval}
            approvalValid={approvalValid}
            onApprove={approvePlan}
            onExport={exportPlan}
          />
        </div>
      </main>

      <QuotesPanel quoteSet={quoteSet} onApply={setQuoteSet} />

      <footer className="page-foot">
        <span className="badge">{MODE_LABEL[store?.mode ?? 'browser']}</span>
        <span>
          {store?.mode === 'server'
            ? 'State persists in a local SQLite file on this machine only.'
            : 'State persists in this browser only (IndexedDB, single origin).'}
        </span>
        <span>Demo data. Example pretax quotes in USD — no tax modeled, no real purchases.</span>
        {saveError && <span className="badge warn">{saveError}</span>}
      </footer>

      {importOpen && (
        <ImportModal
          onClose={() => setImportOpen(false)}
          onApply={(qs) => {
            setQuoteSet(qs);
            setImportOpen(false);
          }}
        />
      )}
    </div>
  );
}
