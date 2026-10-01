import { useCallback, useEffect, useRef, useState } from 'react';
import { connectBackend } from './browserBackend.ts';
import { dollarsToMinor, fmtMoney, fmtTime, newRequestId } from './format.ts';
import type {
  BackendApi,
  RequestResult,
  RequestRow,
  Snapshot,
} from './types.ts';

const STATUS_LABEL: Record<string, string> = {
  reserved: 'Reserved',
  awaiting_approval: 'Awaiting approval',
  awaiting_funds: 'Awaiting funds',
  committed: 'Committed',
  cancelled: 'Cancelled',
  denied: 'Denied',
  expired: 'Expired',
};

const CHIP_TITLE: Record<string, string> = {
  reserved: 'Reserved',
  awaiting_approval: 'Awaiting approval',
  awaiting_funds: 'Approved — awaiting funds',
  committed: 'Committed',
  cancelled: 'Cancelled',
  denied: 'Denied',
  expired: 'Expired',
};

interface LaneForm {
  itemId: string;
  qty: number;
  justification: string;
}

interface LaneState extends LaneForm {
  last: RequestResult | null;
  busy: boolean;
}

const DEFAULT_FORMS: Record<string, LaneForm> = {
  ada: { itemId: 'monitor', qty: 1, justification: 'Need a monitor for development work.' },
  ben: { itemId: 'monitor', qty: 1, justification: 'Need a monitor for pair programming.' },
  cleo: { itemId: 'gadget', qty: 1, justification: 'High-end gadget for a research project.' },
};

export default function App() {
  const [backend, setBackend] = useState<BackendApi | null>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [lanes, setLanes] = useState<Record<string, LaneState>>({});
  const [budgetText, setBudgetText] = useState('100');
  const [thresholdText, setThresholdText] = useState('50');
  const [ttlText, setTtlText] = useState('120');
  const [notice, setNotice] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);
  const [launching, setLaunching] = useState(false);
  const lastRequestId = useRef<string | null>(null);

  const refresh = useCallback(async (b?: BackendApi) => {
    const bk = b ?? backend;
    if (!bk) return;
    const s = await bk.state();
    setSnap(s);
    setBudgetText((s.wallet.budgetMinor / 100).toString());
    setThresholdText((s.wallet.approvalThresholdMinor / 100).toString());
    setTtlText((s.wallet.quoteTtlMs / 1000).toString());
  }, [backend]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const b = await connectBackend();
      if (cancelled) return;
      setBackend(b);
      const s = await b.state();
      if (cancelled) return;
      setSnap(s);
      setBudgetText((s.wallet.budgetMinor / 100).toString());
      setThresholdText((s.wallet.approvalThresholdMinor / 100).toString());
      setTtlText((s.wallet.quoteTtlMs / 1000).toString());
      setLanes(
        Object.fromEntries(
          s.agents.map((a) => [
            a.agentId,
            {
              ...(DEFAULT_FORMS[a.agentId] ?? {
                itemId: a.permissions[0] ?? s.catalog[0]?.itemId ?? '',
                qty: 1,
                justification: '',
              }),
              last: null,
              busy: false,
            },
          ]),
        ),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setLane = useCallback((agentId: string, patch: Partial<LaneState>) => {
    setLanes((prev) => ({ ...prev, [agentId]: { ...prev[agentId], ...patch } }));
  }, []);

  const reportError = useCallback((err: unknown) => {
    const msg =
      typeof err === 'object' && err !== null && 'error' in err
        ? String((err as { error: { detail: string } }).error.detail)
        : String(err);
    setNotice({ kind: 'error', text: msg });
  }, []);

  const sendLaneRequest = useCallback(
    async (agentId: string) => {
      if (!backend) return;
      const lane = lanes[agentId];
      if (!lane) return;
      const requestId = newRequestId();
      lastRequestId.current = requestId;
      setLane(agentId, { busy: true });
      const r = await backend.placeRequest({
        requestId,
        agentId,
        itemId: lane.itemId,
        qty: lane.qty,
      });
      if (!r.ok) {
        setLane(agentId, { busy: false });
        reportError(r);
        return;
      }
      setLane(agentId, { busy: false, last: r.result });
      await refresh();
    },
    [backend, lanes, refresh, reportError, setLane],
  );

  const launchAll = useCallback(async () => {
    if (!backend || !snap) return;
    setLaunching(true);
    setNotice(null);
    // Real concurrency: one independent request per agent lane, fired together.
    const results = await Promise.all(
      snap.agents.map(async (a) => {
        const lane = lanes[a.agentId];
        if (!lane) return;
        const requestId = newRequestId();
        lastRequestId.current = requestId;
        const r = await backend.placeRequest({
          requestId,
          agentId: a.agentId,
          itemId: lane.itemId,
          qty: lane.qty,
        });
        if (r.ok) setLane(a.agentId, { last: r.result });
        else setNotice({ kind: 'error', text: r.error.detail });
      }),
    );
    void results;
    setLaunching(false);
    await refresh();
  }, [backend, snap, lanes, refresh, setLane]);

  const doAction = useCallback(
    async (requestId: string, action: 'approve' | 'reject' | 'commit' | 'cancel') => {
      if (!backend) return;
      const r = await backend.act(requestId, action);
      if (!r.ok) {
        reportError(r);
      } else {
        setLanes((prev) => {
          const next = { ...prev };
          const agentId = r.result.agentId;
          if (next[agentId]) next[agentId] = { ...next[agentId], last: r.result };
          return next;
        });
      }
      await refresh();
    },
    [backend, refresh, reportError],
  );

  const replay = useCallback(
    async (requestId?: string) => {
      const id = requestId ?? lastRequestId.current;
      if (!backend || !id) return;
      const prior = snap?.requests.find((r) => r.requestId === id);
      if (!prior) return;
      const r = await backend.placeRequest({
        requestId: id,
        agentId: prior.agentId,
        itemId: prior.itemId,
        qty: prior.qty,
      });
      if (!r.ok) {
        reportError(r);
        return;
      }
      setNotice({
        kind: 'info',
        text: `Replayed ${id}: the store returned the original "${STATUS_LABEL[r.result.status]}" result — no second charge, ledger unchanged.`,
      });
      await refresh();
    },
    [backend, snap, refresh, reportError],
  );

  const applyConfig = useCallback(async () => {
    if (!backend) return;
    const budget = dollarsToMinor(budgetText);
    const threshold = dollarsToMinor(thresholdText);
    const ttl = Number(ttlText);
    if (budget === null || threshold === null || !Number.isFinite(ttl)) {
      setNotice({ kind: 'error', text: 'Budget, threshold and quote TTL must be valid numbers.' });
      return;
    }
    const r = await backend.configure({
      budgetMinor: budget,
      approvalThresholdMinor: threshold,
      quoteTtlMs: Math.round(ttl * 1000),
    });
    if (!r.ok) reportError(r);
    else setNotice({ kind: 'info', text: 'Wallet config updated.' });
    await refresh();
  }, [backend, budgetText, thresholdText, ttlText, refresh, reportError]);

  const changePrice = useCallback(
    async (itemId: string, dollars: string) => {
      if (!backend) return;
      const minor = dollarsToMinor(dollars);
      if (minor === null) {
        setNotice({ kind: 'error', text: 'Catalog price must be a valid amount.' });
        return;
      }
      const r = await backend.setCatalogPrice(itemId, minor);
      if (!r.ok) reportError(r);
      else
        setNotice({
          kind: 'info',
          text: 'Sample catalog price updated. Open quotes keep their quoted price — committing one now will release it as stale.',
        });
      await refresh();
    },
    [backend, refresh, reportError],
  );

  const doReset = useCallback(async () => {
    if (!backend) return;
    await backend.reset();
    setLanes((prev) =>
      Object.fromEntries(
        Object.entries(prev).map(([k, v]) => [
          k,
          {
            ...(DEFAULT_FORMS[k] ?? { itemId: v.itemId, qty: v.qty, justification: '' }),
            last: null,
            busy: false,
          },
        ]),
      ),
    );
    lastRequestId.current = null;
    setNotice({ kind: 'info', text: 'Sandbox reset — fresh sample wallet, cleared ledger.' });
    await refresh();
  }, [backend, refresh]);

  const totals = snap?.totals;
  const spentPct = totals && totals.budgetMinor > 0 ? (totals.spentMinor / totals.budgetMinor) * 100 : 0;
  const reservedPct =
    totals && totals.budgetMinor > 0 ? (totals.reservedMinor / totals.budgetMinor) * 100 : 0;
  const availPct = Math.max(0, 100 - spentPct - reservedPct);

  if (!snap || !backend) {
    return (
      <div className="app">
        <div className="topbar">
          <div className="brand">Budget Brawl</div>
        </div>
        <p style={{ marginTop: 40, color: 'var(--muted)' }}>Loading sandbox…</p>
      </div>
    );
  }

  const catalogById = new Map(snap.catalog.map((c) => [c.itemId, c]));

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">Budget Brawl</div>
        <div className="topbar-right">
          <span
            className={`mode-badge ${backend.mode}`}
            title={
              backend.mode === 'sqlite'
                ? 'Connected to the local Node server: node:sqlite transactions enforce the budget.'
                : 'No server reachable — single-tab sandbox. Same engine, but it cannot prove cross-client enforcement.'
            }
          >
            <span className="dot" />
            {backend.mode === 'sqlite'
              ? 'SQLite backend sandbox — transactional ledger'
              : 'Browser sandbox — this tab only'}
          </span>
          <button className="btn" onClick={doReset}>
            Reset sandbox
          </button>
        </div>
      </header>

      <section className="hero">
        <h1>Three agents. One budget. Nobody spends the same dollar twice.</h1>
        <p className="sub">
          Watch three scripted agents request purchases at the same time. The budget is shared in real
          time, with strict enforcement{backend.mode === 'sqlite' ? ' by SQLite transactions' : ''}.
        </p>
      </section>

      <section className="strip" aria-label="Wallet controls and balances">
        <div className="fields">
          <div className="field">
            <label htmlFor="budget-input">Budget</label>
            <input
              id="budget-input"
              inputMode="decimal"
              value={budgetText}
              onChange={(e) => setBudgetText(e.target.value)}
              onBlur={applyConfig}
              onKeyDown={(e) => e.key === 'Enter' && applyConfig()}
            />
          </div>
          <div className="field">
            <label htmlFor="threshold-input">Approval threshold</label>
            <input
              id="threshold-input"
              inputMode="decimal"
              value={thresholdText}
              onChange={(e) => setThresholdText(e.target.value)}
              onBlur={applyConfig}
              onKeyDown={(e) => e.key === 'Enter' && applyConfig()}
            />
          </div>
          <div className="field">
            <label htmlFor="ttl-input">Quote TTL (s)</label>
            <input
              id="ttl-input"
              inputMode="decimal"
              value={ttlText}
              onChange={(e) => setTtlText(e.target.value)}
              onBlur={applyConfig}
              onKeyDown={(e) => e.key === 'Enter' && applyConfig()}
            />
          </div>
        </div>
        <div className="stats">
          <div className="stat">
            <div className="stat-label">Budget</div>
            <div className="stat-value">{fmtMoney(totals!.budgetMinor)}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Spent</div>
            <div className="stat-value">{fmtMoney(totals!.spentMinor)}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Reserved</div>
            <div className="stat-value">{fmtMoney(totals!.reservedMinor)}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Available</div>
            <div className="stat-value">{fmtMoney(totals!.availableMinor)}</div>
          </div>
        </div>
        <div className="bar-wrap">
          <div className="budget-bar" role="img"
            aria-label={`Budget bar: ${fmtMoney(totals!.spentMinor)} spent, ${fmtMoney(totals!.reservedMinor)} reserved, ${fmtMoney(totals!.availableMinor)} available of ${fmtMoney(totals!.budgetMinor)}`}>
            {spentPct > 0 && (
              <div className="seg spent" style={{ width: `${spentPct}%` }}>
                {fmtMoney(totals!.spentMinor)} spent
              </div>
            )}
            {reservedPct > 0 && (
              <div className="seg reserved" style={{ width: `${reservedPct}%` }}>
                {fmtMoney(totals!.reservedMinor)} reserved
              </div>
            )}
            {availPct > 0 && (
              <div className="seg available" style={{ width: `${availPct}%` }}>
                {fmtMoney(totals!.availableMinor)} available
              </div>
            )}
            <div className="bar-end">{fmtMoney(totals!.budgetMinor)}</div>
          </div>
        </div>
        <div className="impact-line">
          <strong>Prevented over-budget requests: {snap.impact.preventedCount}</strong>
          {snap.impact.preventedCount > 0 &&
            ` — sample requested amounts ${fmtMoney(snap.impact.preventedAmountMinor)}`}
          {' · '}
          {snap.impact.note}
        </div>
      </section>

      <section className="lanes">
        {snap.agents.map((agent) => {
          const lane = lanes[agent.agentId];
          if (!lane) return null;
          const item = catalogById.get(lane.itemId);
          const permitted = agent.permissions.includes(lane.itemId);
          return (
            <div className="lane" key={agent.agentId}>
              <div className="lane-head">
                <div className="avatar">{agent.name.replace('Agent ', '')[0]}</div>
                <div>
                  <div className="name">{agent.name}</div>
                  <div className="role">{agent.lane} · scripted agent</div>
                </div>
              </div>
              <div className="field">
                <label htmlFor={`item-${agent.agentId}`}>Request</label>
                <select
                  id={`item-${agent.agentId}`}
                  value={lane.itemId}
                  onChange={(e) => setLane(agent.agentId, { itemId: e.target.value })}
                >
                  {snap.catalog.map((c) => (
                    <option key={c.itemId} value={c.itemId}>
                      {c.name}
                      {agent.permissions.includes(c.itemId) ? '' : ' (not permitted)'}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ display: 'flex', gap: 12 }}>
                <div className="field" style={{ flex: 1 }}>
                  <label htmlFor={`price-${agent.agentId}`}>Price</label>
                  <input id={`price-${agent.agentId}`} value={item ? fmtMoney(item.priceMinor) : '—'} readOnly />
                </div>
                <div className="field">
                  <label htmlFor={`qty-${agent.agentId}`}>Qty</label>
                  <input
                    id={`qty-${agent.agentId}`}
                    style={{ minWidth: 56, width: 64 }}
                    inputMode="numeric"
                    value={lane.qty}
                    onChange={(e) => {
                      const q = Number(e.target.value);
                      setLane(agent.agentId, {
                        qty: Number.isInteger(q) && q >= 1 && q <= 999 ? q : lane.qty,
                      });
                    }}
                  />
                </div>
              </div>
              <div className="price-hint">
                Catalog is authoritative — agents cannot claim a price.
                {permitted ? '' : ' Not in this agent’s permission scope.'}
              </div>
              <div className="field">
                <label htmlFor={`just-${agent.agentId}`}>Justification</label>
                <textarea
                  id={`just-${agent.agentId}`}
                  value={lane.justification}
                  onChange={(e) => setLane(agent.agentId, { justification: e.target.value })}
                />
              </div>
              {lane.last ? (
                <div className={`status-chip ${lane.last.status}`}>
                  <span className="cdot" />
                  <div>
                    <div className="chip-title">
                      {CHIP_TITLE[lane.last.status]}
                      {lane.last.replayed ? ' (replayed)' : ''}
                    </div>
                    <div className="chip-detail">{lane.last.detail}</div>
                  </div>
                </div>
              ) : (
                <div className="status-chip idle">
                  <span className="cdot" />
                  <div>
                    <div className="chip-title">Idle</div>
                    <div className="chip-detail">No request sent yet.</div>
                  </div>
                </div>
              )}
              <button
                className="btn small lane-send"
                disabled={lane.busy}
                onClick={() => void sendLaneRequest(agent.agentId)}
              >
                Send request
              </button>
            </div>
          );
        })}
      </section>

      <div className="actions-row">
        <button className="btn primary" onClick={() => void launchAll()} disabled={launching}>
          ▶ Launch simultaneous requests
        </button>
        <button
          className="btn"
          onClick={() => void replay()}
          disabled={!lastRequestId.current && !snap.requests.length}
        >
          ↻ Replay duplicate request
        </button>
        {notice && <div className={`notice ${notice.kind === 'error' ? 'error' : ''}`}>{notice.text}</div>}
      </div>

      <details className="catalog-details">
        <summary>Sample catalog — editable prices (authoritative for new requests)</summary>
        <table className="catalog-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Category</th>
              <th>Price (USD)</th>
              <th>Permitted to</th>
            </tr>
          </thead>
          <tbody>
            {snap.catalog.map((c) => (
              <tr key={c.itemId}>
                <td>{c.name}</td>
                <td>{c.category}</td>
                <td>
                  <input
                    key={`${c.itemId}-${c.priceMinor}`}
                    defaultValue={(c.priceMinor / 100).toString()}
                    inputMode="decimal"
                    aria-label={`Price for ${c.name}`}
                    onBlur={(e) => {
                      if (e.target.value !== (c.priceMinor / 100).toString()) {
                        void changePrice(c.itemId, e.target.value);
                      }
                    }}
                  />
                </td>
                <td>
                  {snap.agents
                    .filter((a) => a.permissions.includes(c.itemId))
                    .map((a) => a.name.replace('Agent ', ''))
                    .join(', ') || 'No agent'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>

      <section className="timeline">
        <div className="timeline-head">
          <h2>Transaction timeline</h2>
          <span className="invariant-note">Spent + reserved never exceeds budget.</span>
        </div>
        {snap.requests.length === 0 ? (
          <p className="empty-note">
            No requests yet. Launch the three scripted agents to watch the shared budget arbitrate.
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Request ID</th>
                  <th>Agent</th>
                  <th>Item</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Details</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {snap.requests.map((r) => (
                  <TimelineRow
                    key={r.requestId}
                    r={r}
                    onAction={doAction}
                    onReplay={replay}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <footer className="footer">
        <span>Scripted agents. Simulated marketplace. Real budget enforcement.</span>
        <span>Demo data. No real purchases.</span>
      </footer>
    </div>
  );
}

function TimelineRow({
  r,
  onAction,
  onReplay,
}: {
  r: RequestRow;
  onAction: (id: string, a: 'approve' | 'reject' | 'commit' | 'cancel') => Promise<void>;
  onReplay: (id: string) => Promise<void>;
}) {
  const actions: JSX.Element[] = [];
  if (r.status === 'reserved') {
    actions.push(
      <button key="c" className="btn small" onClick={() => void onAction(r.requestId, 'commit')}>
        Commit
      </button>,
      <button key="x" className="btn small danger" onClick={() => void onAction(r.requestId, 'cancel')}>
        Cancel
      </button>,
    );
  } else if (r.status === 'awaiting_approval') {
    actions.push(
      <button key="a" className="btn small" onClick={() => void onAction(r.requestId, 'approve')}>
        Approve
      </button>,
      <button key="j" className="btn small danger" onClick={() => void onAction(r.requestId, 'reject')}>
        Reject
      </button>,
      <button key="x" className="btn small" onClick={() => void onAction(r.requestId, 'cancel')}>
        Cancel
      </button>,
    );
  } else if (r.status === 'awaiting_funds') {
    actions.push(
      <button key="a" className="btn small" onClick={() => void onAction(r.requestId, 'approve')}>
        Retry reserve
      </button>,
      <button key="x" className="btn small danger" onClick={() => void onAction(r.requestId, 'cancel')}>
        Withdraw
      </button>,
    );
  } else {
    actions.push(
      <button key="r" className="btn small" onClick={() => void onReplay(r.requestId)}>
        Replay
      </button>,
    );
  }

  const statusText =
    r.status === 'awaiting_approval'
      ? r.fundsHeld
        ? 'Awaiting approval'
        : 'Awaiting approval · no funds held'
      : r.status === 'awaiting_funds'
        ? 'Approved · awaiting funds'
        : STATUS_LABEL[r.status];

  return (
    <tr>
      <td className="mono">{fmtTime(r.createdAt)}</td>
      <td className="mono">{r.requestId}</td>
      <td>{r.agentId.charAt(0).toUpperCase() + r.agentId.slice(1)}</td>
      <td>
        {r.itemName}
        {r.qty > 1 ? ` ×${r.qty}` : ''}
      </td>
      <td className="mono">{fmtMoney(r.amountMinor)}</td>
      <td>
        <span className={`pill ${r.status}`}>{statusText}</span>
      </td>
      <td style={{ maxWidth: 320 }}>{r.detail}</td>
      <td>
        <div className="row-actions">{actions}</div>
      </td>
    </tr>
  );
}
