import { labelArrival } from '../engine/dates';
import { formatCents } from '../engine/money';
import type { AllocationPlan, World } from '../engine/types';
import { Chip, MonitorIcon, Toggle } from './bits';

interface Props {
  plan: AllocationPlan | null;
  world: World;
  excludedAssets: Set<string>;
  excludedQuotes: Set<string>;
  onToggleAsset: (assetId: string, on: boolean) => void;
  onToggleQuote: (quoteId: string, on: boolean) => void;
  onOwnerConfirm: (assetId: string) => void;
}

export default function AllocationPanel({
  plan,
  world,
  excludedAssets,
  excludedQuotes,
  onToggleAsset,
  onToggleQuote,
  onOwnerConfirm,
}: Props) {
  const locationName = (id: string) => world.locations.find((l) => l.id === id)?.name ?? id;
  const demoNow = world.demoNow;

  if (!plan) {
    return (
      <section className="card" aria-labelledby="alloc-h">
        <h2 id="alloc-h">2. Allocate equipment</h2>
        <p className="sub">Run a request to see what your organization already owns.</p>
      </section>
    );
  }

  return (
    <section className="card" aria-labelledby="alloc-h">
      <h2 id="alloc-h">2. Allocate equipment</h2>
      <p className="sub">
        {plan.status === 'infeasible'
          ? 'Nothing internal or purchasable can meet this request as written.'
          : 'We found equipment in your organization that matches your request.'}
      </p>

      <div role="list">
        {plan.transfers.map((l) => {
          const asset = world.assets.find((a) => a.id === l.assetId);
          const excluded = excludedAssets.has(l.assetId);
          return (
            <div className="alloc-row" role="listitem" key={l.assetId}>
              <div className="asset-icon">
                <MonitorIcon />
              </div>
              <div>
                <div className="alloc-name">{l.assetName}</div>
                <div className="alloc-meta">
                  {asset ? `${asset.specs.sizeInches}" · ${asset.specs.ports.join(', ')}` : ''}
                  <br />
                  {locationName(l.locationId)} · arrives {labelArrival(l.earliestArrival, demoNow)}
                </div>
              </div>
              <div className="alloc-action">
                {l.conditional ? (
                  <>
                    <Chip tone="amber">Owner confirmation required</Chip>
                    <button
                      className="btn-small"
                      onClick={() => onOwnerConfirm(l.assetId)}
                      title="Simulated demo action — the owner confirms availability"
                    >
                      Request from owner
                    </button>
                  </>
                ) : (
                  <Chip tone="green">Available</Chip>
                )}
                <Toggle
                  on={!excluded}
                  label={l.conditional ? 'Request this item' : 'Use this item'}
                  onChange={(on) => onToggleAsset(l.assetId, on)}
                />
              </div>
              <div className="alloc-cost">
                Transfer cost
                <strong>{formatCents(l.costCents, l.currency)}</strong>
              </div>
            </div>
          );
        })}

        {plan.purchases.map((p) => (
          <div className="alloc-row" role="listitem" key={p.optionId}>
            <div className="asset-icon">
              <MonitorIcon />
            </div>
            <div>
              <div className="alloc-name">
                {p.label} × {p.quantity}
              </div>
              <div className="alloc-meta">
                {p.provenance}
                <br />
                Delivers {labelArrival(p.deliveryInstant, demoNow)}
              </div>
            </div>
            <div className="alloc-action">
              <Chip tone="gray">Example quote</Chip>
              <Toggle
                on={!excludedQuotes.has(p.optionId)}
                label="Purchase new"
                onChange={(on) => onToggleQuote(p.optionId, on)}
              />
            </div>
            <div className="alloc-cost">
              {p.quantity} × {formatCents(p.unitCostCents, p.currency)}
              {p.shippingCents > 0 ? ` + ${formatCents(p.shippingCents, p.currency)} ship` : ''}
              <strong>{formatCents(p.lineCostCents, p.currency)}</strong>
            </div>
          </div>
        ))}

        {plan.shortage > 0 && (
          <div className="alloc-row" role="listitem">
            <div className="asset-icon">
              <MonitorIcon />
            </div>
            <div>
              <div className="alloc-name">Unfulfilled shortage</div>
              <div className="alloc-meta">
                {plan.shortage} monitor{plan.shortage === 1 ? '' : 's'} cannot be covered by
                inventory or a valid quote before the deadline.
              </div>
            </div>
            <div className="alloc-action">
              <Chip tone="red">Shortage</Chip>
            </div>
            <div className="alloc-cost" />
          </div>
        )}
      </div>
    </section>
  );
}
