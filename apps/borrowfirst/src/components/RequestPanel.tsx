import { DEADLINE_OPTIONS } from '../engine/fixtures';
import type { EquipmentRequest, Location } from '../engine/types';

interface Props {
  request: EquipmentRequest;
  locations: Location[];
  onChange: (next: EquipmentRequest) => void;
  onFind: () => void;
}

const PORT_OPTIONS: { label: string; ports: string[] }[] = [
  { label: 'HDMI', ports: ['HDMI'] },
  { label: 'HDMI + DisplayPort', ports: ['HDMI', 'DisplayPort'] },
  { label: 'USB-C power delivery', ports: ['USB-C'] },
];

export default function RequestPanel({ request, locations, onChange, onFind }: Props) {
  const portLabel =
    PORT_OPTIONS.find((o) => o.ports.join('|') === request.requiredPorts.join('|'))?.label ??
    PORT_OPTIONS[0].label;
  const deadlineId =
    DEADLINE_OPTIONS.find((o) => o.requiredBy === request.requiredBy)?.id ?? 'friday';

  return (
    <section className="card" aria-labelledby="req-h">
      <h2 id="req-h">1. Your request</h2>
      <p className="sub">Tell us what you need and when.</p>

      <div className="field">
        <label htmlFor="f-qty">What do you need?</label>
        <select
          id="f-qty"
          value={request.quantity}
          onChange={(e) => onChange({ ...request, quantity: Number(e.target.value) })}
        >
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <option key={n} value={n}>
              {n} monitor{n === 1 ? '' : 's'}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="f-dest">Where do you need it?</label>
        <select
          id="f-dest"
          value={request.destinationLocationId}
          onChange={(e) => onChange({ ...request, destinationLocationId: e.target.value })}
        >
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="f-when">When do you need it?</label>
        <select
          id="f-when"
          value={deadlineId}
          onChange={(e) => {
            const opt = DEADLINE_OPTIONS.find((o) => o.id === e.target.value);
            if (opt) onChange({ ...request, requiredBy: opt.requiredBy });
          }}
        >
          {DEADLINE_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="f-size">Minimum size</label>
        <select
          id="f-size"
          value={request.minSizeInches}
          onChange={(e) => onChange({ ...request, minSizeInches: Number(e.target.value) })}
        >
          <option value={21}>21 inches</option>
          <option value={24}>24 inches</option>
          <option value={27}>27 inches</option>
        </select>
      </div>

      <div className="field">
        <label htmlFor="f-ports">Required ports</label>
        <select
          id="f-ports"
          value={portLabel}
          onChange={(e) => {
            const opt = PORT_OPTIONS.find((o) => o.label === e.target.value);
            if (opt) onChange({ ...request, requiredPorts: opt.ports });
          }}
        >
          {PORT_OPTIONS.map((o) => (
            <option key={o.label} value={o.label}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <button className="btn btn-primary" onClick={onFind}>
        Find available equipment
      </button>
    </section>
  );
}
