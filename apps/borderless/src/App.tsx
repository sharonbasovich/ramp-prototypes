import { useCallback, useEffect, useState } from 'react';
// @ts-ignore — engine is plain JS + JSDoc shared with node --test
import { createGuardState, resetGuard } from './engine/guard.mjs';
// @ts-ignore
import { createCostState, resetCost } from './engine/cost.mjs';
// @ts-ignore
import { createCheckState, resetCheck } from './engine/check.mjs';
import FxGuard from './tabs/FxGuard';
import CurrencyCheck from './tabs/CurrencyCheck';
import TrueCost from './tabs/TrueCost';

type TabId = 'guard' | 'check' | 'cost';

const TABS: { id: TabId; label: string; title: string; sub: string }[] = [
  {
    id: 'check',
    label: 'Currency Check',
    title: 'A dollar sign is not a currency.',
    sub: 'Resolve the invoice before choosing how to fund it.',
  },
  {
    id: 'guard',
    label: 'FX Guard',
    title: 'A €900 approval can break a $1,000 budget.',
    sub: 'Keep the invoice, payment and budget in their own currencies.',
  },
  {
    id: 'cost',
    label: 'True Cost',
    title: 'The cheaper price can make the pricier order.',
    sub: 'Compare the same purchase after conversion, shipping and payment fees.',
  },
];

function tabFromHash(): TabId {
  const h = window.location.hash.replace('#', '');
  return h === 'check' || h === 'cost' || h === 'guard' ? h : 'guard';
}

export default function App() {
  const [tab, setTab] = useState<TabId>(tabFromHash);
  const [guard, setGuard] = useState<any>(() => createGuardState());
  const [check, setCheck] = useState<any>(() => createCheckState());
  const [cost, setCost] = useState<any>(() => createCostState());

  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = (id: TabId) => {
    window.location.hash = id;
    setTab(id);
  };

  // mutate helpers: engines mutate a draft in place; shallow-clone to render
  const mutGuard = useCallback((fn: (s: any) => void) => {
    setGuard((prev: any) => { fn(prev); return { ...prev }; });
  }, []);
  const mutCheck = useCallback((fn: (s: any) => void) => {
    setCheck((prev: any) => { fn(prev); return { ...prev }; });
  }, []);
  const mutCost = useCallback((fn: (s: any) => void) => {
    setCost((prev: any) => { fn(prev); return { ...prev }; });
  }, []);

  const resetAll = useCallback(() => {
    setGuard((s: any) => resetGuard(s));
    setCheck((s: any) => resetCheck(s));
    setCost((s: any) => resetCost(s));
  }, []);

  const active = TABS.find((t) => t.id === tab)!;

  return (
    <>
      <header className="navbar">
        <div className="brand">Borderless</div>
        <div className="navbar-right">
          <span>Demo data · no payments</span>
          <span className="divider" aria-hidden="true" />
          <button className="btn-text" onClick={resetAll}>Reset demo</button>
        </div>
      </header>

      <div className="hero">
        <h1>{active.title}</h1>
        <p>{active.sub}</p>
      </div>

      <div className="tabs-wrap">
        <nav className="tabs" role="tablist" aria-label="Scenarios">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={t.id === tab}
              className="tab"
              onClick={() => go(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {tab === 'check' && <CurrencyCheck state={check} mut={mutCheck} reset={() => setCheck((s: any) => resetCheck(s))} />}
        {tab === 'guard' && <FxGuard state={guard} mut={mutGuard} reset={() => setGuard((s: any) => resetGuard(s))} />}
        {tab === 'cost' && <TrueCost state={cost} mut={mutCost} reset={() => setCost((s: any) => resetCost(s))} />}
      </div>

      <footer className="footer">
        Illustrative fixture quotes and charges. No Ramp connection, no real
        payments, no shared production budget — every scenario is a
        single-browser-tab sandbox.
      </footer>
    </>
  );
}
