import { useRef, useState } from 'react';
import { labelArrival } from '../engine/dates';
import type { AllocationPlan, AssetEvaluation, World } from '../engine/types';
import { Chip } from './bits';

interface Props {
  plan: AllocationPlan | null;
  world: World;
  onUse: (assetId: string) => void;
  onOwnerConfirm: (assetId: string) => void;
  onImport: (csvText: string) => void;
}

type Filter = 'all' | 'compatible' | 'excluded';

function statusChip(e: AssetEvaluation, selected: boolean) {
  const primary = e.reasons[0];
  if (!e.eligible) {
    if (primary?.code === 'ALREADY_RESERVED')
      return <Chip tone="gray" title={primary.detail}>Reserved</Chip>;
    if (primary?.code === 'UNAVAILABLE')
      return <Chip tone="red" title={e.reasons.map((r) => r.detail).join('; ')}>Unavailable (in use)</Chip>;
    if (primary?.code === 'ARRIVES_AFTER_DEADLINE')
      return <Chip tone="gray" title={primary.detail}>Too late</Chip>;
    return (
      <Chip tone="red" title={e.reasons.map((r) => r.detail).join('; ')}>
        Not compatible
      </Chip>
    );
  }
  if (e.conditional)
    return <Chip tone="amber">Owner confirmation required</Chip>;
  return <Chip tone="green">{selected ? 'In plan' : 'Compatible'}</Chip>;
}

export default function InventoryTable({ plan, world, onUse, onOwnerConfirm, onImport }: Props) {
  const [filter, setFilter] = useState<Filter>('all');
  const fileRef = useRef<HTMLInputElement>(null);
  const evaluations = plan?.evaluations ?? [];
  const selectedIds = new Set(plan?.transfers.map((t) => t.assetId) ?? []);

  const rows = evaluations.filter((e) =>
    filter === 'all' ? true : filter === 'compatible' ? e.eligible : !e.eligible,
  );

  const handleFile = async (file: File) => {
    const text = await file.text();
    onImport(text);
  };

  return (
    <section className="card table-card" aria-labelledby="inv-h">
      <div className="table-head">
        <h2 id="inv-h">
          Available equipment ({rows.length} result{rows.length === 1 ? '' : 's'})
        </h2>
        <div className="table-tools">
          <button className="btn-link" onClick={() => fileRef.current?.click()}>
            Import assets (CSV)
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            style={{ display: 'none' }}
            aria-label="Import assets CSV"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
              e.target.value = '';
            }}
          />
          <select
            aria-label="Filter availability"
            value={filter}
            onChange={(e) => setFilter(e.target.value as Filter)}
          >
            <option value="all">Show all availability</option>
            <option value="compatible">Compatible only</option>
            <option value="excluded">Excluded only</option>
          </select>
        </div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="inv">
          <thead>
            <tr>
              <th>Asset</th>
              <th>Type</th>
              <th>Size</th>
              <th>Ports</th>
              <th>Location</th>
              <th>Available by</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => {
              const a = e.asset;
              const loc = world.locations.find((l) => l.id === a.locationId)?.name ?? a.locationId;
              const selected = selectedIds.has(a.id);
              const failureReasons = e.reasons
                .filter((r) => r.code !== 'OK' && r.code !== 'OWNER_CONFIRMATION_REQUIRED')
                .map((r) => r.detail)
                .join('; ');
              return (
                <tr key={a.id}>
                  <td className="asset-name-cell">
                    {a.name}
                    {a.source === 'imported' && <span className="asset-sub"> · imported</span>}
                  </td>
                  <td>Monitor</td>
                  <td>{a.specs.sizeInches} inches</td>
                  <td>{a.specs.ports.join(', ')}</td>
                  <td>{loc}</td>
                  <td>{e.transfer ? labelArrival(e.transfer.earliestArrival, world.demoNow) : '—'}</td>
                  <td>
                    {statusChip(e, selected)}
                    {failureReasons && <span className="reason-line">{failureReasons}</span>}
                  </td>
                  <td>
                    {!e.eligible ? (
                      <button className="btn-small" disabled>
                        Unavailable
                      </button>
                    ) : e.conditional ? (
                      <button className="btn-small" onClick={() => onOwnerConfirm(a.id)}>
                        Request
                      </button>
                    ) : selected ? (
                      <button className="btn-small" disabled>
                        In plan
                      </button>
                    ) : (
                      <button className="btn-small" onClick={() => onUse(a.id)}>
                        Use
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} style={{ color: 'var(--ink-3)' }}>
                  No assets match this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
