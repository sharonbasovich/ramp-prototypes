import { useState } from 'react';
import type { BasketItem } from '../engine/types';
import { MAX_QTY_PER_SKU } from '../engine/optimize';

interface Props {
  items: BasketItem[];
  deadline: number;
  catalog: Array<{ skuId: string; name: string; detail: string }>;
  onItems(items: BasketItem[]): void;
  onDeadline(days: number): void;
  onCompute(): void;
}

export default function ShoppingList({ items, deadline, catalog, onItems, onDeadline, onCompute }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const missing = catalog.filter((c) => !items.some((i) => i.skuId === c.skuId));

  const setQty = (skuId: string, delta: number) => {
    onItems(
      items.map((i) =>
        i.skuId === skuId ? { ...i, qty: Math.max(0, Math.min(MAX_QTY_PER_SKU, i.qty + delta)) } : i,
      ),
    );
  };

  const removeItem = (skuId: string) => onItems(items.filter((i) => i.skuId !== skuId));

  const addItem = (skuId: string) => {
    const c = catalog.find((x) => x.skuId === skuId);
    if (!c) return;
    onItems([...items, { skuId: c.skuId, name: c.name, detail: c.detail, qty: 1 }]);
    setMenuOpen(false);
  };

  return (
    <section className="card" aria-label="Shopping list">
      <div className="list-head">
        <h2>Your shopping list</h2>
        <div className="deadline">
          <label htmlFor="deadline">Need delivery by</label>
          <select
            id="deadline"
            className="select"
            value={deadline}
            onChange={(e) => onDeadline(Number(e.target.value))}
          >
            <option value={1}>Within 1 day</option>
            <option value={2}>Within 2 days</option>
            <option value={3}>Within 3 days</option>
            <option value={5}>Within 5 days</option>
          </select>
        </div>
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>Item</th>
            <th>Quantity</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.skuId}>
              <td>
                <div className="item-name">{it.name}</div>
                <div className="item-detail">{it.detail}</div>
              </td>
              <td>
                <div className="stepper" role="group" aria-label={`${it.name} quantity`}>
                  <button
                    type="button"
                    aria-label={`Decrease ${it.name}`}
                    onClick={() => setQty(it.skuId, -1)}
                    disabled={it.qty <= 0}
                  >
                    −
                  </button>
                  <span className="val" aria-live="polite">{it.qty}</span>
                  <button
                    type="button"
                    aria-label={`Increase ${it.name}`}
                    onClick={() => setQty(it.skuId, +1)}
                    disabled={it.qty >= MAX_QTY_PER_SKU}
                  >
                    +
                  </button>
                </div>
              </td>
              <td>
                <button
                  className="icon-btn"
                  aria-label={`Remove ${it.name}`}
                  title={`Remove ${it.name}`}
                  onClick={() => removeItem(it.skuId)}
                >
                  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M2 4h12M6.5 4V2.5h3V4M3.5 4l.8 9a1 1 0 0 0 1 .9h5.4a1 1 0 0 0 1-.9l.8-9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              </td>
            </tr>
          ))}
          {items.length === 0 && (
            <tr>
              <td colSpan={3} style={{ color: 'var(--muted)', textAlign: 'center' }}>
                Basket is empty — add an item to optimize.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="add-menu">
        <button
          className="add-item"
          onClick={() => setMenuOpen((o) => !o)}
          disabled={missing.length === 0}
          aria-expanded={menuOpen}
        >
          <span aria-hidden="true" style={{ fontSize: 17, lineHeight: 1 }}>+</span> Add item
        </button>
        {menuOpen && missing.length > 0 && (
          <div className="menu" role="menu">
            {missing.map((c) => (
              <button key={c.skuId} role="menuitem" onClick={() => addItem(c.skuId)}>
                {c.name} <span style={{ color: 'var(--muted)', fontWeight: 500 }}>· {c.detail}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="list-actions">
        <button className="btn primary" onClick={onCompute}>
          Find the cheapest order
        </button>
      </div>

      <p className="foot-note">Demo data. No real purchases.</p>
    </section>
  );
}
