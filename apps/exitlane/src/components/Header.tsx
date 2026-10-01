export function Header(props: { mode: 'sqlite' | 'browser' | null; onReset: () => void }) {
  return (
    <header className="topbar">
      <div className="brand">ExitLane</div>
      <div className="topbar-right">
        {props.mode === 'sqlite' && (
          <span className="mode-badge sqlite" title="/api/health answered with engine sqlite — transactional SQLite sandbox">
            <span className="dot" />
            SQLite backend sandbox
          </span>
        )}
        {props.mode === 'browser' && (
          <span
            className="mode-badge browser"
            title="No server reachable. Same engine on an in-memory store persisted to localStorage — single tab on this origin."
          >
            <span className="dot" />
            Browser sandbox — this tab only
          </span>
        )}
        <button className="linklike" onClick={props.onReset}>
          Reset demo
        </button>
      </div>
    </header>
  );
}
