export default function Header({
  onReset, busy, modeLabel,
}: { onReset: () => void; busy: boolean; modeLabel: string }) {
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-name">Pay Me Twice</span>
        <span className="brand-tag">A safer way to handle supplier payments</span>
      </div>
      <div className="topbar-right">
        <button className="btn btn-outline" onClick={onReset} disabled={busy}>
          <span aria-hidden="true">↻</span> Reset sandbox
        </button>
        <div className="mode-note">
          <span>Sandbox mode — {modeLabel}</span>
          <span>No real payments.</span>
        </div>
      </div>
    </header>
  );
}
