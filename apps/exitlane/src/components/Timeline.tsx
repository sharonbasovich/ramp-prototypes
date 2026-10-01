import type { TimelineNode } from '../types.ts';
import { fmtDay, fmtInstant } from '../format.ts';

export function Timeline(props: { nodes: TimelineNode[]; clockIso: string }) {
  return (
    <section className="card timeline-card" aria-label="Cancellation timeline">
      <h2>Cancellation timeline</h2>
      <div className="timeline">
        <div className="timeline-track" aria-hidden="true" />
        {props.nodes.map((n) => (
          <div key={n.key} className={`timeline-node ${n.state}`}>
            <span className="timeline-dot" aria-hidden="true" />
            <div className="timeline-label">
              <strong>{n.key === 'canceled' ? fmtInstant(n.instant) : fmtDay(n.instant)}</strong>
              <span>{n.label}</span>
              {n.sub && <span className="timeline-sub">{n.sub}</span>}
            </div>
            {n.state === 'now' && <span className="here-chip">We're here</span>}
          </div>
        ))}
      </div>
      <p className="timeline-note">
        Dates show America/Toronto; cutoffs are evaluated on exact UTC instants against the demo clock (
        {fmtInstant(props.clockIso)} Toronto).
      </p>
    </section>
  );
}
