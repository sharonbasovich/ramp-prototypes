interface Props {
  view: 'equipment' | 'locations';
  onNavigate: (v: 'equipment' | 'locations') => void;
  modeLabel: string;
  mode: 'sqlite' | 'sandbox';
  modeDetail: string;
  onReset: () => void;
}

export default function Header({ view, onNavigate, modeLabel, mode, modeDetail, onReset }: Props) {
  return (
    <header className="site-header">
      <div className="brand">BorrowFirst</div>
      <nav className="site-nav" aria-label="Primary">
        <button
          className={view === 'equipment' ? 'active' : ''}
          onClick={() => onNavigate('equipment')}
        >
          Equipment
        </button>
        <button
          className={view === 'locations' ? 'active' : ''}
          onClick={() => onNavigate('locations')}
        >
          Locations
        </button>
      </nav>
      <div className="header-right">
        <span className={`mode-chip${mode === 'sandbox' ? ' sandbox' : ''}`} title={modeDetail}>
          {modeLabel}
        </span>
        <button className="btn-small" onClick={onReset}>
          Reset demo
        </button>
      </div>
    </header>
  );
}
