import { useState } from 'react';
// @ts-ignore
import { compareCosts, editCost, selectLowestComplete, exportCostAudit } from '../engine/cost.mjs';
// @ts-ignore
import { rateToDecimal, CURRENCY_CODES } from '../engine/money.mjs';
import { fmtMoney, minorToMajor, demoTime, downloadJSON, parseAmountInput } from '../ui-helpers';

type Props = { state: any; mut: (fn: (s: any) => void) => void; reset: () => void };

const CHARGE_LABELS: Record<string, string> = {
  goods: 'Goods',
  shipping: 'Shipping',
  fee: 'Fee',
  taxDuty: 'Tax/duty',
};

function ChargeEditor({ vendor, component, mut }: { vendor: any; component: string; mut: Props['mut'] }) {
  const charge = vendor[component];
  const [text, setText] = useState(charge ? minorToMajor(charge.currency, charge.minor) : '');
  const [err, setErr] = useState('');
  const cur = charge ? charge.currency : 'USD';
  const unknown = charge === null;

  const apply = (minor: bigint | null, currency: string) => mut((s) => {
    const r: any = editCost(s, { vendorId: vendor.id, component, minor, currency } as any);
    setErr(r.ok ? '' : (r.reason ?? 'invalid input'));
  });

  return (
    <div className="form-row" style={{ gridTemplateColumns: '2fr 1fr 1fr', display: 'grid', gap: 8, marginBottom: 8 }}>
      <div className="field" style={{ marginBottom: 0 }}>
        <input
          type="text" inputMode="decimal" aria-label={`${vendor.name} ${CHARGE_LABELS[component]}`}
          value={unknown ? '' : text}
          disabled={unknown}
          placeholder={unknown ? 'unknown' : ''}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => { if (!unknown) { const p = parseAmountInput(cur, text); p.ok ? apply(p.minor, cur) : setErr(p.reason); } }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !unknown) { const p = parseAmountInput(cur, text); p.ok ? apply(p.minor, cur) : setErr(p.reason); } }}
        />
        {err && <div className="hint err">{err}</div>}
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <select aria-label={`${vendor.name} ${CHARGE_LABELS[component]} currency`} value={cur}
          disabled={unknown}
          onChange={(e) => {
            if (!charge) return;
            apply(charge.minor, e.target.value);
          }}>
          {CURRENCY_CODES.map((c: string) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div className="field" style={{ marginBottom: 0, display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
        <input
          type="checkbox" id={`${vendor.id}-${component}-unk`} checked={unknown}
          disabled={component === 'goods'}
          onChange={(e) => apply(e.target.checked ? null : 0n, cur)}
        />
        <label htmlFor={`${vendor.id}-${component}-unk`}>unknown</label>
      </div>
    </div>
  );
}

export default function TrueCost({ state, mut, reset }: Props) {
  const cmp = compareCosts(state);
  const [editOpen, setEditOpen] = useState(false);
  const [rateText, setRateText] = useState(rateToDecimal(state.rate));
  const [rateErr, setRateErr] = useState('');
  const [flash, setFlash] = useState('');

  const doSelect = () => mut((s) => {
    const r: any = selectLowestComplete(s);
    setFlash(r.ok ? '' : (r.reason ?? 'cannot select'));
  });
  const applyRate = () => mut((s) => {
    const r: any = editCost(s, { vendorId: state.vendors[0].id, component: 'rate', rateText } as any);
    setRateErr(r.ok ? '' : (r.reason ?? 'invalid rate'));
  });

  const winnerName = cmp.completeWinner?.name ?? '—';
  const head = cmp.incompleteCount > 0
    ? { title: 'Complete cost is not knowable yet.', main: 'Incomplete', sub: 'a blank charge is unknown — it is not zero' }
    : cmp.tie
      ? { title: 'Complete costs tie.', main: 'Tie', sub: 'identical totals — no winner to claim' }
      : {
          title: 'True cost changes the winner.',
          main: cmp.differenceMinor != null ? fmtMoney({ currency: state.reporting, minor: BigInt(cmp.differenceMinor as unknown as bigint) }) : '—',
          sub: cmp.stickerWinner && cmp.completeWinner && cmp.stickerWinner.id !== cmp.completeWinner.id
            ? `less than choosing the lowest converted sticker price (${cmp.stickerWinner.name})`
            : 'between the complete-cost winner and the runner-up',
        };

  return (
    <section aria-label="True Cost scenario">
      <div className="strip">
        <span>Scenario: office equipment · USD reporting</span>
        <span className="strip-actions">
          <button className="btn-text" onClick={() => setEditOpen((v) => !v)}>Edit scenario ✎</button>
          <button className="btn-text" onClick={reset}>Reset scenario</button>
        </span>
      </div>

      <div className="split">
        <div>
          <div className="card">
            <h2>Compare complete costs</h2>
            <p style={{ color: 'var(--secondary)', fontSize: 15, marginTop: -6 }}>
              Same purchase. Different quotes. A fair comparison includes conversion, shipping and payment fees.
            </p>
            <div className="table-scroll">
              <table className="cmp-table">
                <thead>
                  <tr>
                    <th>Supplier</th><th>Original price</th><th>Converted goods</th><th>Shipping</th><th>Fees</th><th>Total {state.reporting}</th>
                  </tr>
                </thead>
                <tbody>
                  {cmp.rows.map((r: any) => (
                    <tr key={r.id} className={cmp.completeWinner?.id === r.id ? 'winner' : ''}>
                      <td><strong>{r.name}</strong></td>
                      <td>{fmtMoney(r.goodsOriginal)}</td>
                      <td>{r.goodsConverted ? fmtMoney(r.goodsConverted) : '—'}</td>
                      <td>
                        {r.shipping.unknown ? <span className="unknown">unknown</span> : fmtMoney(r.shipping.money)}
                        {r.shippingOriginal && r.shippingOriginal.currency !== state.reporting && (
                          <span className="orig">{fmtMoney(r.shippingOriginal)}</span>
                        )}
                      </td>
                      <td>
                        {r.fee.unknown ? <span className="unknown">unknown</span> : fmtMoney(r.fee.money)}
                        {r.feeOriginal && r.feeOriginal.currency !== state.reporting && (
                          <span className="orig">{fmtMoney(r.feeOriginal)}</span>
                        )}
                      </td>
                      <td className="num">
                        {r.complete ? fmtMoney(r.total) : <span className="unknown">incomplete</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: 14, color: 'var(--secondary)', margin: '6px 0 14px' }}>
              Fixture rate: 1 {state.ratePair.from} = {rateToDecimal(state.rate)} {state.ratePair.to}
              {cmp.incompleteCount > 0 && ` · ${cmp.incompleteCount} quote incomplete — ${cmp.rows.filter((r: any) => !r.complete).map((r: any) => r.unknowns.map((u: any) => `${r.name} ${u.component}`).join(', ')).join('; ')}`}
            </div>
            <div className="action-row">
              <button className="btn btn-primary" onClick={doSelect} disabled={!cmp.selectionReady || cmp.selectionStatus === 'current'}>
                Choose lowest complete cost →
              </button>
              <button className="btn" onClick={() => setEditOpen((v) => !v)}>Edit assumptions</button>
            </div>
            {(flash || cmp.selectionStatus !== 'none') && (
              <div className={`status-line ${flash ? 'bad' : cmp.selectionStatus === 'current' ? 'ok' : 'bad'}`} role="status">
                {flash ||
                  (cmp.selectionStatus === 'current' && `Selected for review: ${state.selection.vendorName} (${state.selection.id}) — edits will revoke it.`) ||
                  (cmp.selectionStatus === 'revoked' && `Selection ${state.selection.id} revoked — inputs changed after selection.`) ||
                  (cmp.selectionStatus === 'stale' && `Selection ${state.selection.id} is stale — select again.`)}
              </div>
            )}
          </div>

          {editOpen && (
            <div className="card" style={{ marginTop: 16 }}>
              <h2>Edit assumptions</h2>
              {state.vendors.map((v: any) => (
                <div key={v.id} style={{ marginBottom: 18 }}>
                  <h3 style={{ fontSize: 16, margin: '10px 0 8px' }}>{v.name}</h3>
                  {(['goods', 'shipping', 'fee', 'taxDuty'] as const).map((c) => (
                    <div key={c} style={{ display: 'grid', gridTemplateColumns: '90px 1fr', alignItems: 'start', gap: 8 }}>
                      <span style={{ fontSize: 13.5, color: 'var(--secondary)', paddingTop: 10 }}>{CHARGE_LABELS[c]}</span>
                      <ChargeEditor vendor={v} component={c} mut={mut} />
                    </div>
                  ))}
                </div>
              ))}
              <div className="field" style={{ maxWidth: 260 }}>
                <label htmlFor="tc-rate">Fixture rate · USD per EUR</label>
                <input id="tc-rate" type="text" inputMode="decimal" value={rateText}
                  onChange={(e) => setRateText(e.target.value)}
                  onBlur={applyRate}
                  onKeyDown={(e) => e.key === 'Enter' && applyRate()} />
                {rateErr && <div className="hint err">{rateErr}</div>}
              </div>
              <div className="note"><span className="i">i</span>
                "Unknown" means not supplied — it blocks complete-cost selection and is never treated as zero. Charges in EUR convert at the fixture rate; other pairs have no fixture rate and stay incomplete.
              </div>
            </div>
          )}
        </div>

        <div className="panel" aria-live="polite">
          <h2>{head.title}</h2>
          <div className="big-number">{head.main}</div>
          <div className="big-sub">{head.sub}</div>
          <div className="kv"><span className="k">Sticker-price winner</span><span className="v">{cmp.stickerWinner?.name ?? '—'}</span></div>
          <div className="kv"><span className="k">Complete-cost winner</span><span className="v">{cmp.tie ? 'tie' : winnerName}</span></div>
          <div className="kv"><span className="k">Costs supplied</span><span className="v">{cmp.incompleteCount === 0 ? 'All included' : `${cmp.incompleteCount} incomplete`}</span></div>
          <div className="kv"><span className="k">Tax/duty</span><span className="v">Supplied as USD 0.00 fixture — no universal claim</span></div>
          <div className="kv"><span className="k">Selection</span><span className="v">{state.selection ? `${state.selection.vendorName} · ${cmp.selectionStatus}` : 'none'}</span></div>
        </div>
      </div>

      <div className="card trail">
        <div className="trail-head">
          <h2>Decision trail</h2>
          <button className="btn" onClick={() => downloadJSON('borderless-true-cost-audit.json', exportCostAudit(state))}>
            Export audit JSON
          </button>
        </div>
        <p style={{ color: 'var(--secondary)', fontSize: 14, margin: '4px 0 0' }}>Key steps in this comparison.</p>
        <ul>
          {[...state.events].reverse().map((e: any, i: number) => (
            <li key={i} className={e.kind === 'blocked' || e.kind === 'reject' ? 'blocked' : ''}>
              <span className="t">{demoTime(e.at)}</span>
              <span>{e.text}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
