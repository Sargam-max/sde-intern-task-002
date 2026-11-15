import { Link } from '@tanstack/react-router'

export function TopNavbar({
  theme,
  onToggleTheme,
}: {
  theme: 'dark' | 'light'
  onToggleTheme: () => void
}) {
  return (
    <header className="global-navbar">
      <div className="navbar-container">
        {/* Brand Logo */}
        <Link to="/" className="navbar-brand">
          <div className="brand-badge-icon">⚡</div>
          <div className="brand-text-group">
            <span className="brand-title">BillSplitter</span>
            <span className="brand-tag">FINTECH LEDGER</span>
          </div>
        </Link>

        {/* Center Badge */}
        <div className="navbar-center-pill">
          <span className="live-status-dot" aria-hidden="true" />
          <span>Cloudflare D1 · Zero Rounding Drift</span>
        </div>

        {/* Right Actions */}
        <div className="navbar-actions">
          <button
            type="button"
            className="theme-toggle-btn"
            onClick={onToggleTheme}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            {theme === 'dark' ? (
              <>
                <span className="theme-icon">☀️</span>
                <span className="theme-label">Light</span>
              </>
            ) : (
              <>
                <span className="theme-icon">🌙</span>
                <span className="theme-label">Dark</span>
              </>
            )}
          </button>
        </div>
      </div>
    </header>
  )
}
