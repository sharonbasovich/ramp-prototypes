import type { World } from '../engine/types';

export default function LocationsView({ world }: { world: World }) {
  return (
    <section aria-labelledby="loc-h">
      <h2 id="loc-h" style={{ fontSize: 20, margin: '26px 0 4px' }}>Locations</h2>
      <p className="sub" style={{ marginBottom: 0 }}>
        Offices in this demo workspace and the equipment pool at each one. Sample data.
      </p>
      <div className="loc-grid">
        {world.locations.map((l) => {
          const here = world.assets.filter((a) => a.locationId === l.id);
          const available = here.filter((a) => a.availability === 'available').length;
          const damaged = here.filter((a) => a.condition === 'damaged').length;
          return (
            <div className="loc-card" key={l.id}>
              <h3>{l.name}</h3>
              <div className="meta">
                {here.length} asset{here.length === 1 ? '' : 's'} · {available} available
                {damaged > 0 ? ` · ${damaged} damaged` : ''}
              </div>
              <ul style={{ margin: '10px 0 0', paddingLeft: 18, fontSize: 13, color: 'var(--ink-2)' }}>
                {here.map((a) => (
                  <li key={a.id}>
                    {a.name} — {a.specs.sizeInches}&quot;, {a.specs.ports.join(', ')}
                    {a.condition === 'damaged' ? ' (damaged)' : ''}
                    {a.availability !== 'available' ? ` (${a.availability.replace('_', ' ')})` : ''}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}
