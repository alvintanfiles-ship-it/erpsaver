import { useState } from 'react';
import { useThemeStore } from '../stores/themeStore';
import { useTripStore } from '../stores/tripStore';

export function Settings() {
  const { theme, setTheme } = useThemeStore();
  const { resetTrip } = useTripStore();
  const [speedLockout, setSpeedLockout] = useState(true);
  const [speedThreshold, setSpeedThreshold] = useState(15);

  return (
    <div className="settings-page">
      <div className="card" style={sectionStyles}>
        <h2 style={sectionTitleStyles}>Appearance</h2>

        <div style={settingItemStyles}>
          <div style={settingInfoStyles}>
            <h3 style={settingTitleStyles}>Theme</h3>
            <p style={settingDescStyles}>Choose your preferred color scheme</p>
          </div>
          <div style={themeOptionsStyles}>
            {(['light', 'dark', 'auto'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTheme(t)}
                className={`touch-target ${theme === t ? 'theme-option-active' : ''}`}
                style={{
                  ...themeOptionStyles,
                  backgroundColor: theme === t ? 'var(--color-primary-light)' : 'var(--color-bg-tertiary)',
                  borderColor: theme === t ? 'var(--color-primary)' : 'var(--color-border)',
                }}
              >
                <span style={themeOptionIconStyles}>
                  {t === 'light' && (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
                  {t === 'dark' && (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                    </svg>
                  )}
                  {t === 'auto' && (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="5" />
                      <path d="M12 1v2M12 21v2M4.22 4.22l1.41 1.41M18.36 18.36l1.41 1.41M1 12h2M21 12h2M4.22 19.78l1.41-1.41M18.36 5.64l1.41-1.41" />
                      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                    </svg>
                  )}
                </span>
                <span style={themeOptionLabelStyles}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="card" style={sectionStyles}>
        <h2 style={sectionTitleStyles}>Driving Safety</h2>

        <div style={settingItemStyles}>
          <div style={settingInfoStyles}>
            <h3 style={settingTitleStyles}>Speed Lockout</h3>
            <p style={settingDescStyles}>Disable text input when driving above threshold</p>
          </div>
          <label style={toggleStyles}>
            <input
              type="checkbox"
              checked={speedLockout}
              onChange={(e) => setSpeedLockout(e.target.checked)}
              style={toggleInputStyles}
            />
            <span style={toggleSliderStyles} />
          </label>
        </div>

        {speedLockout && (
          <div style={settingItemStyles}>
            <div style={settingInfoStyles}>
              <h3 style={settingTitleStyles}>Speed Threshold</h3>
              <p style={settingDescStyles}>Lock input above this speed (km/h)</p>
            </div>
            <select
              value={speedThreshold}
              onChange={(e) => setSpeedThreshold(Number(e.target.value))}
              className="input"
              style={selectStyles}
            >
              {[10, 15, 20, 25, 30].map((v) => (
                <option key={v} value={v}>{v} km/h</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="card" style={sectionStyles}>
        <h2 style={sectionTitleStyles}>Data & Privacy</h2>

        <div style={settingItemStyles}>
          <div style={settingInfoStyles}>
            <h3 style={settingTitleStyles}>Clear Trip History</h3>
            <p style={settingDescStyles}>Remove saved origin, destination, and preferences</p>
          </div>
          <button
            onClick={resetTrip}
            className="btn btn-secondary touch-target"
            style={dangerButtonStyles}
          >
            Clear Data
          </button>
        </div>
      </div>

      <div className="card" style={sectionStyles}>
        <h2 style={sectionTitleStyles}>About</h2>
        <div style={aboutStyles}>
          <p style={aboutTextStyles}>ERPsaver v1.0.0</p>
          <p style={aboutTextStyles}>Real-time ERP & Parking Optimizer for Singapore</p>
          <p style={aboutTextStyles}>Data sources: SLA OneMap, LTA DataMall, URA Space</p>
        </div>
      </div>
    </div>
  );
}

const sectionStyles: React.CSSProperties = {
  marginBottom: 16,
};

const sectionTitleStyles: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 600,
  color: 'var(--color-text-secondary)',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  marginBottom: 16,
};

const settingItemStyles: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '16px 0',
  borderBottom: '1px solid var(--color-border)',
};

const settingInfoStyles: React.CSSProperties = {
  flex: 1,
};

const settingTitleStyles: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 500,
  color: 'var(--color-text-primary)',
  marginBottom: 2,
};

const settingDescStyles: React.CSSProperties = {
  fontSize: 13,
  color: 'var(--color-text-muted)',
};

const themeOptionsStyles: React.CSSProperties = {
  display: 'flex',
  gap: 8,
};

const themeOptionStyles: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 6,
  padding: '12px 8px',
  borderRadius: 12,
  border: '1px solid',
  cursor: 'pointer',
  transition: 'all 0.15s',
};

const themeOptionIconStyles: React.CSSProperties = {
  color: 'var(--color-primary)',
};

const themeOptionLabelStyles: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 500,
  color: 'var(--color-text-secondary)',
};

const toggleStyles: React.CSSProperties = {
  position: 'relative',
  width: 52,
  height: 28,
};

const toggleInputStyles: React.CSSProperties = {
  opacity: 0,
  width: 0,
  height: 0,
};

const toggleSliderStyles: React.CSSProperties = {
  position: 'absolute',
  cursor: 'pointer',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: 'var(--color-border)',
  borderRadius: 28,
  transition: '0.3s',
  display: 'flex',
  alignItems: 'center',
  padding: '0 4px',
};

const selectStyles: React.CSSProperties = {
  width: 'auto',
  minWidth: 120,
  paddingRight: 36,
};

const dangerButtonStyles: React.CSSProperties = {
  borderColor: 'var(--color-critical)',
  color: 'var(--color-critical)',
};

const aboutStyles: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  paddingTop: 8,
};

const aboutTextStyles: React.CSSProperties = {
  fontSize: 14,
  color: 'var(--color-text-secondary)',
};