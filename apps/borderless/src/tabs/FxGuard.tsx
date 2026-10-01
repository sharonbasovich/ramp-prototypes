import { useEffect, useState } from 'react';
// @ts-ignore
import {
  computePlan,
  editInputs,
  simulateFxMove,
  expireQuote,
  refreshQuote,
  approve,
  commit,
  guardTick,
  exportGuardAudit,
  QUOTE_VALID_MS,
} from '../engine/guard.mjs';
// @ts-ignore
import { rateToDecimal } from '../engine/money.mjs';
import { fmtMoney, fmtSigned, demoTime, downloadJSON, parseAmountInput, minorToMajor } from '../ui-helpers';

type Props = { state: any; mut: (fn: (s: any) => void) => void; reset: () => void };

const STATUS_TEXT: Record<string, { text: string; cls: string }> = {
  none: { text: 'Not approved — approve the displayed snapshot before commit.', cls: '' },
  current: { text: 'Approval current — commit posts one sandbox debit to the ledger.', cls: 'ok' },
  committed: { text: 'Committed — the ledger debit exists; a repeat commit cannot duplicate it.', cls: 'ok' },
  revoked: { text: 'Approval revoked — inputs or quote changed. Re-approve a valid snapshot.', cls: 'bad' },
  stale: { text: 'Approval stale — snapshot changed since approval.', cls: 'bad' },
  'stale-epoch': { text: 'Approval belongs to an earlier sandbox — it cannot act here.', cls: 'bad' },
  expired: { text: 'Quote expired — refresh the quote and re-approve.', cls: 'bad' },
  'over-budget': { text: 'Projected debit exceeds budget — approval cannot override it.', cls: 'bad' },
};

export default function FxGuard({ state, mut, reset }: Props) {
  const plan = computePlan(state);
  const [editOpen, setEditOpen] = useState(false);
  const [fields, setFields] = useState({
    invoice: minorToMajor(state.inputs.invoice.currency, state.inputs.invoice.minor),
    rate: rateToDecimal(state.inputs.rate),
    fee: minorToMajor(state.inputs.fee.currency, state.inputs.fee.minor),
    budget: minorToMajor(state.inputs.budget.currency, state.inputs.budget.minor),
  });
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const [flash, setFlash] = useState('');

  // demo clock ticks in real seconds
  useEffect(() => {
    const id = setInterval(() => mut((s) => guardTick(s, s.clock + 1000)), 1000);
    return () => clearInterval(id);
  }, [mut]);

  const doApprove = () => mut((s) => {
    const r: any = approve(s);
    setFlash(r.ok ? '' : r.reason);
  });
  const doCommit = () => mut((s) => {
    const r: any = commit(s, `cmd-${Math.random().toString(36).slice(2)}-${Date.now()}`);
    setFlash(r.ok ? (r.replay ? 'Replayed command — ledger already had this debit.' : '') : r.reason);
  });
  const doEdit = (key: string, patch: any) => mut((s) => {
    const r: any = editInputs(s, patch);
    setFieldErr((e) => ({ ...e, [key]: r.ok ? '' : (r.reason ?? 'invalid input') }));
  });

  const applyInvoice = () => {
    const p = parseAmountInput('EUR', fields.invoice);
    if (!p.ok) return setFieldErr((e) => ({ ...e, invoice: p.reason }));
    doEdit('invoice', { invoiceMinor: p.minor });
  };
  const applyFee = () => {
    const p = parseAmountInput('USD', fields.fee);
    if (!p.ok) return setFieldErr((e) => ({ ...e, fee: p.reason }));
    doEdit('fee', { feeMinor: p.minor });
  };
  const applyBudget = () => {
    const p = parseAmountInput('USD', fields.budget);
    if (!p.ok) return setFieldErr((e) => ({ ...e, budget: p.reason }));
    doEdit('budget', { budgetMinor: p.minor });
  };
  const applyRate = () => doEdit('rate', { rateText: fields.rate });

  const pct = plan.debit && plan.budget.minor > 0n
    ? Number((plan.debit.minor * 10000n) / plan.budget.minor) / 100
    : 0;
  const st = STATUS_TEXT[plan.approvalStatus] ?? STATUS_TEXT.none;
  const debitNow = plan.debit;

  return (
    <section aria-label="FX Guard scenario">
      <div className="strip">
        <span>Scenario: Berlin design invoice · USD budget</span>
        <span className="strip-actions">
          <span>
            DEMO {demoTime(state.clock)} · quote {plan.expired ? 'expired' : `valid until ${demoTime(state.quote.expiresAt)}`}
          </span>
          <button className="btn-text" onClick={reset}>Reset scenario</button>
        </span>
      </div>

      <div className="split">
        <div className="card">
          <h2>What you approve</h2>
          <div className="money-flow">
            <div>
              <span className="flow-label">Invoice amount</span>
              <span className="flow-value">{fmtMoney(state.inputs.invoice)}</span>
            </div>
            <span className="arrow" aria-hidden="true">→</span>
            <div>
              <span className="flow-label">Expected debit</span>
              <span className="flow-value">{debitNow ? fmtMoney(debitNow) : '—'}</span>
            </div>
          </div>

          <div className="kv"><span className="k">Invoice at {rateToDecimal(state.inputs.rate)} USD/EUR</span><span className="v">{plan.converted ? fmtMoney(plan.converted) : '—'}</span></div>
          <div className="kv"><span className="k">Payment fee</span><span className="v">{fmtMoney(state.inputs.fee)}</span></div>
          <div className="kv"><span className="k">Budget</span><span className="v">{fmtMoney(state.inputs.budget)}</span></div>
          <div className="kv">
            <span className="k">{plan.headroomMinor != null && plan.headroomMinor < 0n ? 'Over budget by' : 'Headroom'}</span>
            <span className={`v ${plan.headroomMinor != null && plan.headroomMinor < 0n ? 'bad' : ''}`}>
              {plan.headroomMinor != null ? fmtSigned(state.inputs.budget.currency, plan.headroomMinor) : '—'}
            </span>
          </div>

          <div className="action-row" style={{ marginTop: 18 }}>
            <button
              className="btn btn-primary"
              onClick={doApprove}
              disabled={plan.expired || !plan.withinBudget || plan.approvalStatus === 'current' || plan.approvalStatus === 'committed'}
            >
              Approve quote
            </button>
            <button
              className="btn"
              onClick={doCommit}
              disabled={plan.approvalStatus !== 'current'}
              title="Sandbox commit — succeeds once for the current approved snapshot"
            >
              Commit sandbox payment
            </button>
            <button className="btn" onClick={() => mut((s) => { simulateFxMove(s); setFlash(''); })}>
              Simulate FX move
            </button>
            {plan.expired ? (
              <button className="btn" onClick={() => mut((s) => { refreshQuote(s); setFlash(''); })}>
                Refresh quote
              </button>
            ) : (
              <button className="btn" onClick={() => mut((s) => { expireQuote(s); setFlash(''); })}>
                Expire quote
              </button>
            )}
          </div>
          <div className={`status-line ${flash ? 'bad' : st.cls}`} role="status">
            {flash || st.text}
            {state.approval ? ` (approval ${state.approval.id})` : ''}
          </div>

          <div className="edit-panel">
            <h3>
              <button className="btn-text" onClick={() => setEditOpen((v) => !v)} aria-expanded={editOpen}>
                {editOpen ? '▾ Edit scenario inputs' : '▸ Edit scenario inputs'}
              </button>
            </h3>
            {editOpen && (
              <>
                <div className="edit-grid">
                  <div className="field">
                    <label htmlFor="g-inv">Invoice amount · EUR</label>
                    <input id="g-inv" type="text" inputMode="decimal" value={fields.invoice}
                      onChange={(e) => setFields((f) => ({ ...f, invoice: e.target.value }))}
                      onBlur={applyInvoice}
                      onKeyDown={(e) => e.key === 'Enter' && applyInvoice()} />
                    {fieldErr.invoice && <div className="hint err">{fieldErr.invoice}</div>}
                  </div>
                  <div className="field">
                    <label htmlFor="g-rate">Rate · USD per EUR</label>
                    <input id="g-rate" type="text" inputMode="decimal" value={fields.rate}
                      onChange={(e) => setFields((f) => ({ ...f, rate: e.target.value }))}
                      onBlur={applyRate}
                      onKeyDown={(e) => e.key === 'Enter' && applyRate()} />
                    {fieldErr.rate && <div className="hint err">{fieldErr.rate}</div>}
                  </div>
                  <div className="field">
                    <label htmlFor="g-fee">Fee · USD</label>
                    <input id="g-fee" type="text" inputMode="decimal" value={fields.fee}
                      onChange={(e) => setFields((f) => ({ ...f, fee: e.target.value }))}
                      onBlur={applyFee}
                      onKeyDown={(e) => e.key === 'Enter' && applyFee()} />
                    {fieldErr.fee && <div className="hint err">{fieldErr.fee}</div>}
                  </div>
                  <div className="field">
                    <label htmlFor="g-budget">Budget · USD</label>
                    <input id="g-budget" type="text" inputMode="decimal" value={fields.budget}
                      onChange={(e) => setFields((f) => ({ ...f, budget: e.target.value }))}
                      onBlur={applyBudget}
                      onKeyDown={(e) => e.key === 'Enter' && applyBudget()} />
                    {fieldErr.budget && <div className="hint err">{fieldErr.budget}</div>}
                  </div>
                </div>
                <div className="note"><span className="i">i</span>
                  Any accepted edit — or an attempted currency/direction change — permanently revokes the current approval. Reverting the value cannot restore it.
                </div>
              </>
            )}
          </div>
        </div>

        <div className="panel">
          <h2>Currency stays attached to the money.</h2>
          <div className="big-number">
            {plan.headroomMinor != null ? fmtSigned(state.inputs.budget.currency, plan.headroomMinor) : '—'}
          </div>
          <div className="big-sub">{plan.headroomMinor != null && plan.headroomMinor < 0n ? 'over the budget' : 'budget headroom'}</div>

          <div className="budget-bar" role="img" aria-label={`projected debit ${pct.toFixed(0)} percent of budget`}>
            <div className={`fill ${plan.withinBudget ? '' : 'over'}`} style={{ width: `${Math.min(100, pct)}%` }} />
          </div>
          <div className="bar-labels">
            <span>{debitNow ? `${fmtMoney(debitNow)} projected debit` : 'no projected debit'}</span>
            <span>{fmtMoney(state.inputs.budget)} budget</span>
          </div>

          <div style={{ marginTop: 18 }}>
            <div className="kv"><span className="k">Invoice currency</span><span className="v">{state.inputs.invoice.currency}</span></div>
            <div className="kv"><span className="k">Funding currency</span><span className="v">{state.pair.to}</span></div>
            <div className="kv"><span className="k">Budget currency</span><span className="v">{state.inputs.budget.currency}</span></div>
            <div className="kv"><span className="k">Quote valid for</span><span className="v">{Math.round(QUOTE_VALID_MS / 60000)} minutes · demo</span></div>
            <div className="kv"><span className="k">Ledger spent</span><span className="v">{fmtMoney({ currency: state.inputs.budget.currency, minor: plan.spentMinor })}</span></div>
            <div className="kv"><span className="k">Approval</span><span className="v">{state.approval ? `${state.approval.id} · ${plan.approvalStatus}` : 'none'}</span></div>
          </div>
        </div>
      </div>

      <div className="card trail">
        <div className="trail-head">
          <h2>Decision trail</h2>
          <button className="btn" onClick={() => downloadJSON('borderless-fx-guard-audit.json', exportGuardAudit(state))}>
            Export audit JSON
          </button>
        </div>
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
