import type { PayResult, Verdict } from '../types';

export type VerdictView =
  | { kind: 'verdict'; verdict: Verdict }
  | { kind: 'pay'; result: PayResult; requestId: string }
  | { kind: 'burst'; total: number; recorded: number; blocked: number; other: number; paymentUid: string | null };

const ICONS: Record<string, string> = {
  duplicate: '⊘', clear: '✓', recorded: '✓', review: '⚠', unsupported: '?',
  invalid: '⚠', burst: '⚡', replayed: '↻', idle: '…',
};

export default function VerdictCard({
  view, busy, onInspect,
}: { view: VerdictView | null; busy: boolean; onInspect: () => void }) {
  let cls = 'idle';
  let icon = ICONS.idle;
  let title = 'Choose a scenario, then validate';
  let detail = 'The verdict and its evidence appear here.';
  let rows: Array<{ label: string; value: string }> = [];
  let footnote = '';

  if (view?.kind === 'verdict') {
    const v = view.verdict;
    cls = v.status;
    icon = ICONS[v.status] ?? '!';
    title = v.title;
    detail = v.detail;
    rows = v.evidence;
    footnote = 'We compared supplier, invoice number, amount, billing period and document content against the paid ledger.';
  } else if (view?.kind === 'pay') {
    const { result } = view;
    cls = result.outcome === 'recorded' ? 'recorded'
      : result.outcome === 'replayed' ? 'clear'
      : result.outcome === 'duplicate' ? 'duplicate'
      : result.outcome === 'review' ? 'review' : 'unsupported';
    icon = ICONS[result.outcome === 'replayed' ? 'replayed' : cls] ?? '!';
    title = result.outcome === 'recorded' ? 'Payment recorded'
      : result.outcome === 'replayed' ? 'Replayed — same result returned'
      : result.outcome === 'duplicate' ? 'Duplicate blocked'
      : result.outcome === 'review' ? 'Review required — not payable'
      : 'Not payable';
    detail = result.detail ?? result.verdict.detail;
    rows = result.verdict.evidence;
    if (result.paymentUid) rows = [{ label: 'Ledger entry', value: result.paymentUid }, ...rows];
    footnote = 'Eligibility and recording happen in one ledger transaction — retries and races cannot double-pay.';
  } else if (view?.kind === 'burst') {
    cls = view.recorded === 1 ? 'recorded' : view.blocked === view.total ? 'duplicate' : 'review';
    icon = ICONS.burst;
    title = view.recorded === 1
      ? `Exactly 1 of ${view.total} requests paid`
      : view.blocked === view.total
        ? `All ${view.total} requests blocked`
        : `${view.recorded} paid, ${view.blocked} blocked, ${view.other} other`;
    detail = view.recorded === 1
      ? `Ten concurrent requests, ten distinct request IDs. ${view.paymentUid ?? 'One'} won the transaction; the rest hit the duplicate defense.`
      : 'Every concurrent request landed on an already-paid identity. The ledger still shows a single payment.';
    rows = [
      { label: 'Concurrent requests', value: String(view.total) },
      { label: 'Payments recorded', value: String(view.recorded) },
      { label: 'Duplicate sandbox payments blocked', value: String(view.blocked) },
    ];
    footnote = 'A real concurrency check needs the SQLite backend; browser mode serializes these in one tab.';
  }

  return (
    <section className={`card verdict-card verdict-${cls}`} aria-labelledby="verdict-h" aria-live="polite">
      <div className="verdict-head">
        <span className="verdict-icon" aria-hidden="true">{icon}</span>
        <div>
          <h2 id="verdict-h">{title}</h2>
          <p className="verdict-detail">{detail}</p>
        </div>
      </div>
      {rows.length > 0 && (
        <dl className="evidence-list">
          {rows.map((r, i) => (
            <div key={i} className="evidence-row">
              <dt>{r.label}</dt><dd>{r.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <button className="btn btn-outline verdict-inspect" onClick={onInspect} disabled={busy || !view}>
        <span aria-hidden="true">⌕</span> Inspect evidence
      </button>
      {footnote && <p className="verdict-footnote">{footnote}</p>}
    </section>
  );
}
