import { useNavigate, useLocation } from 'react-router-dom';
import { useThemeStore } from '../stores/themeStore';

export function Header() {
  const navigate = useNavigate();
  const location = useLocation();
  const { resolvedTheme, toggleTheme } = useThemeStore();

  const isHome = location.pathname === '/';
  const isNav = location.pathname === '/navigate';
  const isSettings = location.pathname === '/settings';

  return (
    <header className="header" style={headerStyles}>
      <div style={leftStyles}>
        {isHome ? null : (
          <button
            onClick={() => navigate('/')}
            className="btn btn-ghost touch-target"
            style={backButtonStyles}
            aria-label="Back"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
        )}
        <h1 style={titleStyles}>ERPsaver</h1>
      </div>

      <div style={rightStyles}>
        {!isSettings && !isNav && (
          <button
            onClick={toggleTheme}
            className="btn btn-ghost touch-target"
            style={iconButtonStyles}
            aria-label={`Switch to ${resolvedTheme === 'light' ? 'dark' : 'light'} mode`}
          >
            {resolvedTheme === 'light' ? (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            )}
          </button>
        )}

        {isNav && (
          <button
            onClick={() => navigate('/')}
            className="btn btn-ghost touch-target"
            style={iconButtonStyles}
            aria-label="Exit navigation"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}

        {!isSettings && (
          <button
            onClick={() => navigate('/settings')}
            className="btn btn-ghost touch-target"
            style={iconButtonStyles}
            aria-label="Settings"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        )}
      </div>
    </header>
  );
}

const headerStyles: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  height: 56,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '0 16px',
  backgroundColor: 'var(--color-bg-secondary)',
  borderBottom: '1px solid var(--color-border)',
  zIndex: 50,
};

const leftStyles: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
};

const rightStyles: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

const titleStyles: React.CSSProperties = {
  fontSize: 20,
  fontWeight: 700,
  color: 'var(--color-primary)',
  letterSpacing: -0.5,
};

const backButtonStyles: React.CSSProperties = {
  padding: 8,
  borderRadius: 10,
};

const iconButtonStyles: React.CSSProperties = {
  padding: 8,
  borderRadius: 10,
};