import type { EventInfo } from '../types.ts';
import { instantToTorontoInput } from '../format.ts';

export function Toolbar(props: {
  event: EventInfo;
  clockIso: string;
  busy: boolean;
  onCancelEvent: () => void;
  onSetClock: (torontoLocal: string) => void;
  onAdvance: (ms: number) => void;
}) {
  const canceled = props.event.status === 'canceled';
  return (
    <section className="toolbar" aria-label="Event and demonstration clock">
      <label className="toolbar-group">
        <span className="toolbar-label">Event</span>
        <select value={props.event.eventId} disabled aria-label="Event">
          <option value={props.event.eventId}>{props.event.name}</option>
        </select>
      </label>
      <button className="btn danger" onClick={props.onCancelEvent} disabled={canceled || props.busy}>
        {canceled ? 'Event canceled' : 'Cancel event'}
      </button>
      <div className="toolbar-sep" aria-hidden="true" />
      <label className="toolbar-group">
        <span className="toolbar-label">Demo clock</span>
        <input
          type="datetime-local"
          value={instantToTorontoInput(props.clockIso)}
          onChange={(e) => props.onSetClock(e.target.value)}
          aria-label="Demonstration clock (America/Toronto)"
          title="Simulated clock — all policy cutoffs are evaluated against this instant, never the real time"
        />
      </label>
      <div className="clock-steps" role="group" aria-label="Advance demonstration clock">
        <button className="btn ghost sm" onClick={() => props.onAdvance(3600_000)} disabled={props.busy}>
          +1h
        </button>
        <button className="btn ghost sm" onClick={() => props.onAdvance(24 * 3600_000)} disabled={props.busy}>
          +1d
        </button>
        <button className="btn ghost sm" onClick={() => props.onAdvance(26 * 3600_000)} disabled={props.busy}>
          Past room cutoff
        </button>
      </div>
      <label className="toolbar-group">
        <select value="America/Toronto" disabled aria-label="Display timezone">
          <option value="America/Toronto">America/Toronto</option>
        </select>
      </label>
    </section>
  );
}
