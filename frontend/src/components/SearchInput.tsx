import { useState, useRef, useEffect, useCallback } from 'react';
import { GeocodeResult } from '../stores/tripStore';

function classifyLocation(result: GeocodeResult): GeocodeResult['locationType'] {
  const name = (result.buildingName || '').toLowerCase();
  const road = (result.roadName || '').toLowerCase();
  const address = (result.address || '').toLowerCase();
  const combined = `${name} ${road} ${address}`;

  // MRT/LRT stations
  if (combined.includes('mrt') || combined.includes('lrt') || combined.includes('station')) {
    return 'mrt';
  }
  // Major malls
  if (combined.includes('mall') || combined.includes('plaza') || combined.includes('centre') ||
      combined.includes('square') || combined.includes('hub') || combined.includes('junction') ||
      combined.includes('+') || name.includes('bugis') || name.includes('vivo') || name.includes('ion') ||
      name.includes('paragon') || name.includes('ngee ann') || name.includes('takashimaya') ||
      name.includes('sunway') || name.includes('jurong point') || name.includes('tampines mall') ||
      name.includes('white sands') || name.includes('waterway point') || name.includes('northpoint') ||
      name.includes('compass one') || name.includes('heartland mall') || name.includes('west mall') ||
      name.includes('hillv2') || name.includes('seletar mall') || name.includes('paya lebar square') ||
      name.includes('city square mall') || name.includes('mustafa')) {
    return 'mall';
  }
  // Major landmarks (hospitals, schools, government buildings, etc.)
  if (combined.includes('hospital') || combined.includes('polyclinic') || combined.includes('clinic') ||
      combined.includes('university') || combined.includes('polytechnic') || combined.includes('institute') ||
      combined.includes('school') || combined.includes('college') || combined.includes('academy') ||
      combined.includes('ministry') || combined.includes('authority') || combined.includes('board') ||
      combined.includes('court') || combined.includes('supreme') || combined.includes('parliament') ||
      combined.includes('istana') || combined.includes('airport') || combined.includes('terminal') ||
      combined.includes('ferry') || combined.includes('port') || combined.includes('harbour') ||
      name.includes('gardens by the bay') || name.includes('sentosa') || name.includes('universal studios') ||
      name.includes('zoo') || name.includes('bird park') || name.includes('aquarium') ||
      name.includes('museum') || name.includes('library') || name.includes('community club') ||
      name.includes('cc ') || combined.includes('sports') || combined.includes('stadium') ||
      combined.includes('swimming')) {
    return 'landmark';
  }
  // Residential (HDB blocks, condos, landed)
  if (combined.includes('blk ') || combined.includes('block ') || combined.includes('avenue') ||
      combined.includes('street') || combined.includes('road') || combined.includes('drive') ||
      combined.includes('crescent') || combined.includes('close') || combined.includes('terrace') ||
      combined.includes('grove') || combined.includes('heights') || combined.includes('park') ||
      combined.includes('ridge') || combined.includes('vale') || combined.includes('view') ||
      combined.includes('walk') || combined.includes('way') || combined.includes('lane') ||
      combined.includes('place') || combined.includes('loop') || combined.includes('link') ||
      combined.includes('rise') || combined.includes('green') || combined.includes('hill')) {
    // But exclude if it's a major road name
    const majorRoads = ['expressway', 'highway', 'bukit timah', 'orchard', 'shenton', 'raffles', 'marina', 'bayfront'];
    if (!majorRoads.some(r => combined.includes(r))) {
      return 'residential';
    }
  }
  return 'other';
}

function getLocationBadge(type: GeocodeResult['locationType']): { label: string; color: string; icon: string } | null {
  switch (type) {
    case 'mrt':
      return { label: 'MRT', color: 'var(--color-primary)', icon: '🚇' };
    case 'mall':
      return { label: 'Mall', color: 'var(--color-accent)', icon: '🛍️' };
    case 'landmark':
      return { label: 'Landmark', color: 'var(--color-info)', icon: '🏛️' };
    case 'residential':
      return { label: 'Residential', color: 'var(--color-text-muted)', icon: '🏠' };
    default:
      return null;
  }
}

interface SearchInputProps {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  onSelect: (result: GeocodeResult) => void;
  results: GeocodeResult[];
  isLoading: boolean;
  disabled?: boolean;
  error?: string;
  autoFocus?: boolean;
  onClear?: () => void;
}

export function SearchInput({
  label,
  placeholder,
  value,
  onChange,
  onSelect,
  results,
  isLoading,
  disabled,
  error,
  autoFocus,
  onClear,
}: SearchInputProps) {
  const [showResults, setShowResults] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus();
    }
  }, [autoFocus]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowResults(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleFocus = () => {
    if (value && results.length > 0) {
      setShowResults(true);
    }
  };

  const handleBlur = () => {
    setTimeout(() => setShowResults(false), 150);
  };

  const handleResultClick = (result: GeocodeResult) => {
    onSelect(result);
    onChange(result.address);
    setShowResults(false);
    inputRef.current?.blur();
  };

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    onChange(newValue);
    
    // Debounce showResults to prevent flicker
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (newValue.trim()) setShowResults(true);
    }, 50);
  }, [onChange]);

  return (
    <div ref={containerRef} className="search-input-wrapper" style={containerStyles}>
      <label className="label" htmlFor={label.toLowerCase()}>
        {label}
      </label>
      <div className="input-wrapper" style={inputWrapperStyles}>
        <input
          ref={inputRef}
          id={label.toLowerCase()}
          type="text"
          placeholder={placeholder}
          value={value}
          onChange={handleInputChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          disabled={disabled}
          className={`input ${error ? 'input-error' : ''}`}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          style={inputStyles}
        />
        {isLoading && (
          <div className="spinner" style={spinnerStyles} aria-label="Searching..." />
        )}
        {!isLoading && value && !disabled && (
          <button
            onClick={() => onClear?.() ?? onChange('')}
            className="btn btn-ghost touch-target"
            style={clearButtonStyles}
            aria-label="Clear"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>

      {error && <p className="error-text">{error}</p>}

      {showResults && results.length > 0 && (
        <div className="search-results" style={resultsStyles} role="listbox">
          {results.map((result, index) => {
            const locationType = classifyLocation(result);
            const badge = getLocationBadge(locationType);
            return (
              <button
                key={`${result.latitude}-${result.longitude}-${index}`}
                onClick={() => handleResultClick(result)}
                className="search-result-item"
                style={resultItemStyles}
                role="option"
              >
                <div style={resultMainStyles}>
                  <span style={resultNameStyles}>{result.buildingName || result.address}</span>
                  {badge && (
                    <span style={{
                      ...resultPostalStyles,
                      backgroundColor: badge.color,
                      color: 'white',
                      fontSize: 11,
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: 0.3,
                    }}>
                      {badge.icon} {badge.label}
                    </span>
                  )}
                  {result.postalCode && !badge && (
                    <span style={resultPostalStyles}>{result.postalCode}</span>
                  )}
                </div>
                <div style={resultAddressStyles}>{result.address}</div>
                {result.roadName && result.roadName !== result.address && (
                  <div style={{ ...resultAddressStyles, fontSize: 12, color: 'var(--color-primary)', fontWeight: 500 }}>
                    {result.roadName}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

const containerStyles: React.CSSProperties = {
  position: 'relative',
  width: '100%',
};

const inputWrapperStyles: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  width: '100%',
};

const inputStyles: React.CSSProperties = {
  paddingRight: 48,
  width: '100%',
};

const clearButtonStyles: React.CSSProperties = {
  position: 'absolute',
  right: 8,
  padding: 8,
  borderRadius: 8,
};

const spinnerStyles: React.CSSProperties = {
  position: 'absolute',
  right: 12,
  width: 20,
  height: 20,
  borderWidth: 2,
};

const resultsStyles: React.CSSProperties = {
  position: 'absolute',
  top: '100%',
  left: 0,
  right: 0,
  marginTop: 4,
  backgroundColor: 'var(--color-bg-secondary)',
  border: '1px solid var(--color-border)',
  borderRadius: 12,
  boxShadow: '0 8px 24px var(--color-shadow-strong)',
  overflow: 'hidden',
  zIndex: 10,
  maxHeight: 300,
  overflowY: 'auto',
};

const resultItemStyles: React.CSSProperties = {
  width: '100%',
  padding: '12px 16px',
  textAlign: 'left',
  background: 'transparent',
  border: 'none',
  borderBottom: '1px solid var(--color-border)',
  cursor: 'pointer',
  transition: 'background-color 0.1s',
  minHeight: 56,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
};

const resultMainStyles: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

const resultNameStyles: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 500,
  color: 'var(--color-text-primary)',
  flex: 1,
};

const resultPostalStyles: React.CSSProperties = {
  fontSize: 13,
  color: 'var(--color-text-muted)',
  backgroundColor: 'var(--color-bg-tertiary)',
  padding: '2px 8px',
  borderRadius: 10,
};

const resultAddressStyles: React.CSSProperties = {
  fontSize: 13,
  color: 'var(--color-text-secondary)',
};