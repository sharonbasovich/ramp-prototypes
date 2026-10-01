import type { BasketItem, QuoteSet, SolveResult, Vendor, VendorOrder } from '../engine/types';
import type { Approval } from '../approval';

interface Computed {
  result: SolveResult;
  baseline: { vendor: Vendor; order: VendorOrder } | null;
  sig: string;
  computedAt: string;
  items: BasketItem[];
  deadlineDays: number;
  quoteSet: QuoteSet;
}

interface Props {
  items: BasketItem[];
  quoteSet: QuoteSet;
  computed: Computed | null;
  dirty: boolean;
  approval: Approval | null;
  approvalValid: boolean;
  onApprove(): void;
  onExport(format: 'json' | 'csv'): void;
}

const VENDOR_COLORS = ['gray', 'green', 'blue', 'gray'];

export const fmt = (cents: number): string =>
  `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function vendorColor(vendors: Vendor[], vendorId: string): string {
  const i = vendors.findIndex((v) => v.id === vendorId);
  return VENDOR_COLORS[i] ?? 'gray';
}

export default function ResultsPanel({
  items,
  quoteSet,
  computed,
  dirty,
  approval,
  approvalValid,
  onApprove,
  onExport,
}: Props) {
  // Render a stale plan against the inputs it was computed with, not the
  // current ones — a re-imported quote set can rename vendors entirely.
  const vendors = (computed?.quoteSet ?? quoteSet).vendors;
  const shownItems = computed?.items ?? items;
  const positive = shownItems.filter((i) => i.qty > 0);
  const result = computed?.result ?? null;
  const plan = result?.status === 'optimal' ? result.plan : null;
  const baseline = computed?.baseline ?? null;
  // A vendor order exists whenever units were allocated to it — even when
  // those units cost $0.00 (a free SKU still ships and still hits minimums).
  const usedVendors = new Set(plan?.allocations.map((a) => a.vendorId) ?? []);

  const allocOf = (skuId: string, vendorId: string): number => {
    if (!plan) return 0;
    const a = plan.allocations.find((x) => x.skuId === skuId && x.vendorId === vendorId);
    return a?.qty ?? 0;
  };

  const itemsFor = (vendorId: string): string => {
    if (!plan) return '';
    return plan.allocations
      .filter((a) => a.vendorId === vendorId)
      .map((a) => `${shownItems.find((i) => i.skuId === a.skuId)?.name ?? a.skuId} (${a.qty})`)
      .join(', ');
  };

  const diff = plan && baseline ? baseline.order.orderCents - plan.totalCents : 0;
  const pct = baseline && baseline.order.orderCents > 0 ? Math.round((diff / baseline.order.orderCents) * 100) : 0;

  return (
    <div>
      <section className="card alloc" aria-label="Optimized vendor allocation">
        <h2>Optimized vendor allocation</h2>
        <p className="card-sub">
          Each item is purchased from the lowest total cost vendor, considering prices and shipping.
        </p>

        {dirty && (
          <div className="stale-note" role="status">
            Inputs changed — press “Find the cheapest order” to refresh this plan.
          </div>
        )}

        {result?.status === 'infeasible' && (
          <div className="infeasible" role="alert">
            No plan satisfies the current constraints:
            <ul>
              {result.reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>
        )}
        {result?.status === 'boundExceeded' && (
          <div className="infeasible" role="alert">
            The exact solver stopped at its honest bound: this basket would require{' '}
            {result.combinations.toLocaleString()} allocations (limit{' '}
            {result.limit.toLocaleString()}). Reduce quantities or vendors rather than accepting an
            approximate answer.
          </div>
        )}

        {plan && (
          <table className="table" aria-label="Allocation by item and vendor">
            <thead>
              <tr>
                <th>Item</th>
                {vendors.map((v) => (
                  <th key={v.id} className="vendor-col">
                    {v.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {positive.map((it) => (
                <tr key={it.skuId}>
                  <td>
                    <div className="item-name">{it.name}</div>
                    <div className="item-detail">
                      {it.qty} × {it.detail}
                    </div>
                  </td>
                  {vendors.map((v) => {
                    const qty = allocOf(it.skuId, v.id);
                    const color = vendorColor(vendors, v.id);
                    return (
                      <td key={v.id} className="cell">
                        {qty > 0 ? (
                          <span className={`chip ${color}`}>{qty}</span>
                        ) : (
                          <span className="dash">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr className="row-total">
                <td>Vendor order total</td>
                {vendors.map((v) => {
                  const order = plan.orders.find((o) => o.vendorId === v.id);
                  const color = vendorColor(vendors, v.id);
                  return (
                    <td key={v.id} className="cell">
                      {order && usedVendors.has(v.id) ? (
                        <span className={`chip money ${color}`}>{fmt(order.orderCents)}</span>
                      ) : (
                        <span>{fmt(0)}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        )}
      </section>

      <section className="card" style={{ marginTop: 14 }} aria-label="Cost comparison">
        <h2>Cost comparison</h2>
        <p className="card-sub">
          Here's how the optimized plan compares to buying everything from a single vendor.
        </p>

        {!plan && !result && <div className="empty-result">Press “Find the cheapest order” to run the optimizer.</div>}
        {result?.status === 'infeasible' && (
          <div className="empty-result">No feasible plan to compare. Fix the blocking constraints above.</div>
        )}

        {plan && (
          <>
            <div className="stats">
              <div className="stat">
                <div className="label">Best single vendor</div>
                <div className="value">{baseline ? fmt(baseline.order.orderCents) : '—'}</div>
                <div className="note">
                  {baseline ? `All items from ${baseline.vendor.name}` : 'No single vendor can fill the basket'}
                </div>
              </div>
              <div className="stat">
                <div className="label">Optimized plan</div>
                <div className="value">{fmt(plan.totalCents)}</div>
                <div className="note">
                  Exact optimum across {result?.status === 'optimal' ? result.evaluated.toLocaleString() : '—'} allocations ·{' '}
                  {plan.vendorCount} vendor{plan.vendorCount === 1 ? '' : 's'}
                </div>
              </div>
              <div className="stat good">
                <div className="label">{diff >= 0 ? 'You’ll spend' : 'You’ll spend'}</div>
                <div className="value">
                  {diff >= 0 ? `${fmt(diff)} less` : `${fmt(-diff)} more`}
                </div>
                <div className="note">
                  {baseline ? `${Math.abs(pct)}% ${diff >= 0 ? 'lower' : 'higher'} total cost` : 'vs. no single-vendor option'}
                </div>
              </div>
            </div>

            <div className="breakdowns">
              <div className="breakdown">
                <h3>Optimized plan breakdown</h3>
                <table className="mini">
                  <thead>
                    <tr>
                      <th>Vendor</th>
                      <th>Items</th>
                      <th className="num">Items total</th>
                      <th className="num">Shipping</th>
                      <th className="num">Order total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.orders
                      .filter((o) => usedVendors.has(o.vendorId))
                      .map((o) => {
                        const v = vendors.find((x) => x.id === o.vendorId);
                        return (
                          <tr key={o.vendorId}>
                            <td>{v?.name ?? o.vendorId}</td>
                            <td>{itemsFor(o.vendorId)}</td>
                            <td className="num">{fmt(o.itemsCents)}</td>
                            <td className="num">
                              {fmt(o.shippingCents)}
                              {o.freeShipApplied && (
                                <span style={{ color: 'var(--green-chip-ink)', fontSize: 11 }}> free</span>
                              )}
                            </td>
                            <td className="num">{fmt(o.orderCents)}</td>
                          </tr>
                        );
                      })}
                    <tr className="total">
                      <td>Total</td>
                      <td></td>
                      <td className="num">{fmt(plan.itemsCents)}</td>
                      <td className="num">{fmt(plan.shippingCents)}</td>
                      <td className="num">{fmt(plan.totalCents)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="breakdown">
                <h3>Best single vendor breakdown</h3>
                <table className="mini">
                  <thead>
                    <tr>
                      <th>Vendor</th>
                      <th>Items</th>
                      <th className="num">Items total</th>
                      <th className="num">Shipping</th>
                      <th className="num">Order total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {baseline ? (
                      <>
                        <tr>
                          <td>{baseline.vendor.name}</td>
                          <td>{positive.map((i) => `${i.name} (${i.qty})`).join(', ')}</td>
                          <td className="num">{fmt(baseline.order.itemsCents)}</td>
                          <td className="num">
                            {fmt(baseline.order.shippingCents)}
                            {baseline.order.freeShipApplied && (
                              <span style={{ color: 'var(--green-chip-ink)', fontSize: 11 }}> free</span>
                            )}
                          </td>
                          <td className="num">{fmt(baseline.order.orderCents)}</td>
                        </tr>
                        <tr className="total">
                          <td>Total</td>
                          <td></td>
                          <td className="num">{fmt(baseline.order.itemsCents)}</td>
                          <td className="num">{fmt(baseline.order.shippingCents)}</td>
                          <td className="num">{fmt(baseline.order.orderCents)}</td>
                        </tr>
                      </>
                    ) : (
                      <tr>
                        <td colSpan={5} style={{ color: 'var(--muted)' }}>
                          No single vendor can deliver the whole basket on time.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="result-actions">
              <button className="btn primary grow" onClick={onApprove} disabled={dirty || approvalValid}>
                {approvalValid ? 'Purchase plan approved' : 'Approve purchase plan'}
              </button>
              <button className="btn" onClick={() => onExport('json')} disabled={!approvalValid}>
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M8 2v8.5M4.5 7 8 10.5 11.5 7M2.5 11v2.5h11V11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Export plan
              </button>
              <button className="btn ghost" onClick={() => onExport('csv')} disabled={!approvalValid}>
                CSV
              </button>
              {approval && !approvalValid && (
                <span className="badge warn" role="status">Approval void — inputs changed</span>
              )}
              {approvalValid && approval && (
                <span className="badge ok" role="status">
                  Approved {new Date(approval.approvedAt).toLocaleTimeString()}
                </span>
              )}
              {dirty && (
                <span className="badge warn" role="status">Plan is stale — recalculate</span>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
