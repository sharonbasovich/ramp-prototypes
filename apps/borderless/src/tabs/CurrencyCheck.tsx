import { useState } from 'react';
// @ts-ignore
import {
  CHECK_FIXTURES,
  FUNDING_ACCOUNTS,
  ENTITY_COUNTRIES,
  editCheck,
  validateCheck,
  checkResultStale,
  saveNormalizedInvoice,
  exportCheckAudit,
} from '../engine/check.mjs';
// @ts-ignore
import { CURRENCY_CODES } from '../engine/money.mjs';
import { fmtMoney, demoTime, downloadJSON } from '../ui-helpers';

type Props = { state: any; mut: (fn: (s: any) => void) => void; reset: () => void };

export default function CurrencyCheck({ state, mut, reset }: Props) {
  const [flash, setFlash] = useState('');
  const result = state.result;
  const stale = checkResultStale(state);
  const parse = result?.parse;
  const route = result?.route;

  const big = !result
    ? { title: 'Review required', main: '$ ≠ USD', sub: 'Choose the invoice currency and format explicitly.' }
    : parse.status === 'ok'
      ? { title: 'Invoice normalized', main: fmtMoney(parse.money), sub: parse.evidence.currencySource === 'iso-literal' ? 'ISO code in the invoice text' : 'manual currency resolution recorded' }
      : parse.status === 'hold'
        ? { title: 'Held for review', main: parse.need === 'currency' ? '$ ≠ USD' : 'format ?', sub: parse.reason }
        : { title: 'Cannot accept', main: 'Rejected', sub: parse.reason };

  const doValidate = () => mut((s) => { validateCheck(s); setFlash(''); });
  const doSave = () => mut((s) => {
    const r: any = saveNormalizedInvoice(s, `inv-${Date.now()}`);
    setFlash(r.ok ? '' : (r.reason ?? 'cannot save'));
  });
  const set = (patch: any) => mut((s) => { editCheck(s, patch); });
  const loadFixture = (f: any) => mut((s) => {
    editCheck(s, { literal: f.literal, resolvedCurrency: null, numericFormat: 'unresolved', result: null });
    logFixture(s, f);
  });
  const saveOk = result && !stale && parse.status === 'ok' && route.decision === 'preflight-passed';

  return (
    <section aria-label="Currency Check scenario">
      <div className="strip">
        <span>Scenario: Canadian supplier · ambiguous dollar invoice</span>
        <span className="strip-actions">
          <button className="btn-text" onClick={reset}>Reset scenario</button>
        </span>
      </div>

      <div className="split">
        <div className="card">
          <h2>Check the original invoice</h2>
          <div className="chips" aria-label="Example invoices">
            {CHECK_FIXTURES.map((f: any) => (
              <button key={f.id} className={`chip ${state.literal === f.literal ? 'active' : ''}`}
                title={f.note} onClick={() => loadFixture(f)}>
                {f.label}
              </button>
            ))}
          </div>
          <div className="field">
            <label htmlFor="c-literal">Original invoice text</label>
            <textarea id="c-literal" value={state.literal}
              onChange={(e) => set({ literal: e.target.value })} />
          </div>
          <div className="form-row">
            <div className="field">
              <label htmlFor="c-cur">Invoice currency</label>
              <select id="c-cur" value={state.resolvedCurrency ?? ''}
                onChange={(e) => set({ resolvedCurrency: e.target.value || null })}>
                <option value="">Choose explicitly…</option>
                {CURRENCY_CODES.map((c: string) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="c-fmt">Number format</label>
              <select id="c-fmt" value={state.numericFormat}
                onChange={(e) => set({ numericFormat: e.target.value })}>
                <option value="unresolved">Choose explicitly…</option>
                <option value="en-US">English · 1,234.56</option>
                <option value="de-DE">German · 1.234,56</option>
                <option value="fr-FR">French · 1 234,56</option>
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="field">
              <label htmlFor="c-entity">Business entity</label>
              <select id="c-entity" value={state.entityCountry}
                onChange={(e) => set({ entityCountry: e.target.value })}>
                {ENTITY_COUNTRIES.map((c: any) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="c-fund">Funding account</label>
              <select id="c-fund" value={state.fundingAccountId}
                onChange={(e) => set({ fundingAccountId: e.target.value })}>
                {FUNDING_ACCOUNTS.map((a: any) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
            </div>
          </div>
          <div className="action-row">
            <button className="btn btn-primary" onClick={doValidate}>Validate invoice</button>
            <button className="btn" onClick={doSave} disabled={!saveOk}
              title="Saves a normalized sandbox record — only after a passing parse and funding preflight">
              Save normalized invoice
            </button>
          </div>
          {flash && <div className="status-line bad" role="alert">{flash}</div>}
          {result && stale && (
            <div className="status-line">Inputs changed since validation — validate again.</div>
          )}
          <div className="note"><span className="i">i</span>
            A symbol cannot establish the invoice currency. Locale controls how the amount is parsed; it never guesses the currency.
          </div>
        </div>

        <div className="panel" aria-live="polite">
          <h2>{big.title}</h2>
          <div className="big-number" style={{ fontSize: big.main.length > 12 ? 34 : 48 }}>{big.main}</div>
          <div className="big-sub">{big.sub}</div>
          <div className="kv"><span className="k">Original literal</span><span className="v">{state.literal || '—'}</span></div>
          <div className="kv">
            <span className="k">Currency</span>
            <span className="v">
              {parse?.status === 'ok' ? `${parse.money.currency} · ${parse.evidence.currencySource === 'iso-literal' ? 'in literal' : 'resolved manually'}` : 'unresolved'}
            </span>
          </div>
          <div className="kv">
            <span className="k">Parsed minor units</span>
            <span className="v">{parse?.status === 'ok' ? parse.money.minor.toString() : '—'}</span>
          </div>
          <div className="kv">
            <span className="k">Number format</span>
            <span className="v">{parse?.evidence?.numericFormat ?? (state.numericFormat === 'unresolved' ? 'unresolved' : state.numericFormat)}</span>
          </div>
          <div className="kv">
            <span className="k">Funding eligibility</span>
            <span className={`v ${route?.decision === 'blocked' ? 'bad' : ''}`}>
              {route ? route.label : 'not evaluated'}
            </span>
          </div>
          {route?.reason && (
            <div className="note" style={{ marginTop: 10 }}>
              <span className="i">i</span>
              <span>{route.reason}</span>
            </div>
          )}
        </div>
      </div>

      <div className="card trail">
        <div className="trail-head">
          <h2>Normalized invoices &amp; decision trail</h2>
          <button className="btn" onClick={() => downloadJSON('borderless-currency-check-audit.json', exportCheckAudit(state))}>
            Export audit JSON
          </button>
        </div>
        {state.saved.length > 0 && (
          <ul>
            {state.saved.map((r: any) => (
              <li key={r.recordId}>
                <span className="t">{demoTime(r.at)}</span>
                <span>
                  <strong>{fmtMoney({ currency: r.currency, minor: r.minor })}</strong>
                  {` — "${r.literal}" · ${r.numericFormat ?? 'format n/a'} · ${r.currencySource} · ${r.routeLabel} · ${r.note}`}
                </span>
              </li>
            ))}
          </ul>
        )}
        <ul>
          {[...state.events].reverse().map((e: any, i: number) => (
            <li key={i} className={e.kind === 'reject' || e.kind === 'blocked' ? 'blocked' : ''}>
              <span className="t">{demoTime(e.at)}</span>
              <span>{e.text}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="card why">
        <h2>Why this matters for Ramp</h2>
        <div className="kv" style={{ borderTop: 'none' }}>
          <span>
            Canadian Bill Pay requires CAD funding. A USD invoice does not make a
            Canadian USD account eligible. The CAD path here is a simplified
            documented fixture — a funding-currency preflight, not a complete
            eligibility verdict.
          </span>
          <span className="src">
            <a href="https://support.ramp.com/bill-pay-for-canadian-businesses/" target="_blank" rel="noreferrer">
              Official Ramp documentation ↗
            </a>
          </span>
        </div>
      </div>
    </section>
  );
}

function logFixture(state: any, fixture: any) {
  state.events.push({
    at: state.clock,
    kind: 'load',
    text: `Fixture loaded · ${fixture.label} · ${fixture.note}`,
  });
}
