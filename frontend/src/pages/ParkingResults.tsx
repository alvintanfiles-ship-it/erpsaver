import { useEffect, useCallback, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTripStore } from '../stores/tripStore';
import { parkingApi } from '../api/client';
import { Carpark } from '../stores/tripStore';

export function ParkingResults() {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    destination,
    nearbyCarparks,
    setNearbyCarparks,
    setSelectedCarpark,
    setIsCheckingParking,
    route,
    erp,
    setIsNavigating,
  } = useTripStore();

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState<Carpark | null>(null);

  // Get destination from route state or store
  const dest = location.state?.destination as typeof destination || destination;

  const fetchParking = useCallback(async () => {
    if (!dest) return;

    setIsLoading(true);
    setIsCheckingParking(true);
    setError(null);

    try {
      const response = await parkingApi.nearby({
        lat: dest.lat,
        lng: dest.lng,
        radius: 1000,
        providers: ['HDB', 'URA', 'MALL'],
        minLots: 1,
      });

      setNearbyCarparks(response.data.carparks);
    } catch (err) {
      setError('Failed to load parking availability. Please try again.');
      console.error('Parking fetch error:', err);
    } finally {
      setIsLoading(false);
      setIsCheckingParking(false);
    }
  }, [dest, setNearbyCarparks, setIsCheckingParking]);

  useEffect(() => {
    fetchParking();
  }, [fetchParking]);

  const handleSelectCarpark = (carpark: Carpark) => {
    setSelectedCarpark(carpark);
    setShowDetail(carpark);
  };

  const handleNavigate = (carpark: Carpark) => {
    setSelectedCarpark(carpark);
    setIsNavigating(true);
    navigate('/navigate', {
      state: { carpark, destination: dest, route, erp },
    });
  };

  const handleCloseDetail = () => {
    setShowDetail(null);
  };

  if (!dest) {
    return (
      <div style={emptyStyles}>
        <p>No destination selected</p>
        <button onClick={() => navigate('/')} className="btn btn-primary mt-16">Plan Trip</button>
      </div>
    );
  }

  return (
    <div className="parking-results">
      <div style={headerStyles}>
        <h2 style={titleStyles}>Parking near {dest.buildingName || dest.address?.split(',')[0] || 'Destination'}</h2>
        <div style={subtitleStyles}>
          {nearbyCarparks.length} carpark{nearbyCarparks.length !== 1 ? 's' : ''} within 1km
        </div>
      </div>

      {error && (
        <div className="card toast-error" style={errorStyles}>
          {error}
          <button onClick={fetchParking} className="btn btn-secondary mt-8">Retry</button>
        </div>
      )}

      {isLoading ? (
        <div style={loadingStyles}>
          <div className="spinner" style={{ width: 32, height: 32 }} />
          <p style={{ marginTop: 12, color: 'var(--color-text-muted)' }}>Checking live availability...</p>
        </div>
      ) : nearbyCarparks.length === 0 ? (
        <div className="card" style={{ ...emptyStyles, textAlign: 'center', padding: 32 }}>
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" strokeWidth="1.5" style={{ marginBottom: 16 }}>
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M9 3v18M15 3v18" />
            <line x1="3" y1="12" x2="21" y2="12" />
          </svg>
          <p style={emptyStateTextStyles}>No parking found nearby</p>
          <button onClick={fetchParking} className="btn btn-primary mt-16">Refresh</button>
        </div>
      ) : (
        <div style={listStyles}>
          {nearbyCarparks.map((carpark) => (
            <CarparkCard
              key={carpark.id}
              carpark={carpark}
              onSelect={handleSelectCarpark}
              onNavigate={handleNavigate}
            />
          ))}
        </div>
      )}

      {/* Detail Sheet */}
      {showDetail && (
        <CarparkDetailSheet
          carpark={showDetail}
          onClose={handleCloseDetail}
          onNavigate={handleNavigate}
        />
      )}
    </div>
  );
}

function CarparkCard({ carpark, onSelect, onNavigate }: {
  carpark: Carpark;
  onSelect: (cp: Carpark) => void;
  onNavigate: (cp: Carpark) => void;
}) {
  const isFilling = carpark.status === 'FILLING_UP';

  return (
    <button
      onClick={() => onSelect(carpark)}
      className="card touch-target"
      style={cardStyles}
      aria-pressed={false}
    >
      <div style={cardHeaderStyles}>
        <div style={providerBadgeStyles} className={`provider-${carpark.provider.toLowerCase()}`}>
          {carpark.provider}
        </div>
        <div style={statusBadgeContainerStyles}>
          <span className={`status-badge status-${carpark.status.toLowerCase()}`}>
            {carpark.statusLabel}
          </span>
        </div>
      </div>

      <h3 style={nameStyles}>{carpark.name}</h3>
      <p style={addressStyles}>{carpark.address}</p>

      <div style={metricsStyles}>
        <div style={metricStyles}>
          <span style={metricValueStyles}>{carpark.availableLots}</span>
          <span style={metricLabelStyles}>Available</span>
        </div>
        <div style={metricStyles}>
          <span style={metricValueStyles}>{carpark.totalLots}</span>
          <span style={metricLabelStyles}>Total</span>
        </div>
        <div style={metricStyles}>
          <span style={metricValueStyles}>{carpark.distanceLabel}</span>
          <span style={metricLabelStyles}>Away</span>
        </div>
      </div>

      <div style={actionStyles}>
        <button
          onClick={(e) => { e.stopPropagation(); onNavigate(carpark); }}
          className="btn btn-primary touch-target"
          style={navigateButtonStyles}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="3 11 22 2 13 21 13 11 3 11" />
          </svg>
          Navigate
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onSelect(carpark); }}
          className="btn btn-secondary touch-target"
          style={detailsButtonStyles}
        >
          Details
        </button>
      </div>

      {isFilling && (
        <div style={warningStyles}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-filling)" strokeWidth="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span>Filling up - {carpark.availableLots} lots left</span>
        </div>
      )}
    </button>
  );
}

function CarparkDetailSheet({ carpark, onClose, onNavigate }: {
  carpark: Carpark;
  onClose: () => void;
  onNavigate: (cp: Carpark) => void;
}) {
  return (
    <div className="sheet-overlay" onClick={onClose} style={overlayStyles}>
      <div className="sheet-content" onClick={(e) => e.stopPropagation()} style={sheetStyles}>
        <div className="sheet-handle" />

        <div style={detailHeaderStyles}>
          <div>
            <h2 style={detailTitleStyles}>{carpark.name}</h2>
            <p style={detailAddressStyles}>{carpark.address}</p>
          </div>
          <span className={`status-badge status-${carpark.status.toLowerCase()}`}>
            {carpark.statusLabel}
          </span>
        </div>

        <div style={detailMetricsStyles}>
          <div style={detailMetricStyles}>
            <span style={detailMetricValueStyles}>{carpark.availableLots}</span>
            <span style={detailMetricLabelStyles}>Available</span>
          </div>
          <div style={detailMetricStyles}>
            <span style={detailMetricValueStyles}>{carpark.totalLots}</span>
            <span style={detailMetricLabelStyles}>Total</span>
          </div>
          <div style={detailMetricStyles}>
            <span style={detailMetricValueStyles}>{carpark.distanceLabel}</span>
            <span style={detailMetricLabelStyles}>Distance</span>
          </div>
        </div>

        {carpark.operatingHours && (
          <div style={hoursStyles}>
            <h4 style={hoursTitleStyles}>Operating Hours</h4>
            <div style={hoursGridStyles}>
              {Object.entries(carpark.operatingHours).map(([day, hours]) => (
                <div key={day} style={hoursItemStyles}>
                  <span style={hoursDayStyles}>{day.charAt(0).toUpperCase() + day.slice(1)}</span>
                  <span style={hoursTimeStyles}>{hours}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={detailActionsStyles}>
          <button
            onClick={() => { onClose(); onNavigate(carpark); }}
            className="btn btn-primary btn-large touch-target"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="3 11 22 2 13 21 13 11 3 11" />
            </svg>
            Navigate Here
          </button>
        </div>
      </div>
    </div>
  );
}

const headerStyles: React.CSSProperties = {
  marginBottom: 16,
};

const titleStyles: React.CSSProperties = {
  fontSize: 20,
  fontWeight: 700,
  color: 'var(--color-text-primary)',
};

const subtitleStyles: React.CSSProperties = {
  fontSize: 14,
  color: 'var(--color-text-muted)',
  marginTop: 4,
};

const errorStyles: React.CSSProperties = {
  marginBottom: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  alignItems: 'stretch',
};

const loadingStyles: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 48,
};

const emptyStyles: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 48,
  textAlign: 'center',
};

const emptyStateTextStyles: React.CSSProperties = {
  color: 'var(--color-text-muted)',
  marginBottom: 16,
};

const listStyles: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};

const cardStyles: React.CSSProperties = {
  textAlign: 'left',
  padding: 16,
};

const cardHeaderStyles: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 8,
};

const providerBadgeStyles: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  padding: '4px 8px',
  borderRadius: 6,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
};

const statusBadgeContainerStyles: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
};

const nameStyles: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 600,
  color: 'var(--color-text-primary)',
  marginBottom: 4,
};

const addressStyles: React.CSSProperties = {
  fontSize: 13,
  color: 'var(--color-text-secondary)',
  marginBottom: 12,
};

const metricsStyles: React.CSSProperties = {
  display: 'flex',
  gap: 16,
  marginBottom: 12,
  paddingTop: 12,
  borderTop: '1px solid var(--color-border)',
};

const metricStyles: React.CSSProperties = {
  flex: 1,
  textAlign: 'center',
};

const metricValueStyles: React.CSSProperties = {
  display: 'block',
  fontSize: 20,
  fontWeight: 700,
  color: 'var(--color-text-primary)',
};

const metricLabelStyles: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--color-text-muted)',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
};

const actionStyles: React.CSSProperties = {
  display: 'flex',
  gap: 8,
};

const navigateButtonStyles: React.CSSProperties = {
  flex: 1,
  justifyContent: 'center',
};

const detailsButtonStyles: React.CSSProperties = {
  padding: '12px 20px',
};

const warningStyles: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  marginTop: 12,
  padding: 8,
  backgroundColor: 'rgba(241, 196, 15, 0.1)',
  borderRadius: 8,
  fontSize: 13,
  color: 'var(--color-filling)',
};

const overlayStyles: React.CSSProperties = {
  zIndex: 200,
};

const sheetStyles: React.CSSProperties = {
  maxHeight: '90vh',
};

const detailHeaderStyles: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  marginBottom: 20,
};

const detailTitleStyles: React.CSSProperties = {
  fontSize: 20,
  fontWeight: 700,
  color: 'var(--color-text-primary)',
  marginBottom: 4,
};

const detailAddressStyles: React.CSSProperties = {
  fontSize: 14,
  color: 'var(--color-text-secondary)',
};

const detailMetricsStyles: React.CSSProperties = {
  display: 'flex',
  gap: 16,
  marginBottom: 20,
  padding: '16px 0',
  borderTop: '1px solid var(--color-border)',
  borderBottom: '1px solid var(--color-border)',
};

const detailMetricStyles: React.CSSProperties = {
  flex: 1,
  textAlign: 'center',
};

const detailMetricValueStyles: React.CSSProperties = {
  display: 'block',
  fontSize: 28,
  fontWeight: 700,
  color: 'var(--color-text-primary)',
};

const detailMetricLabelStyles: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--color-text-muted)',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
};

const hoursStyles: React.CSSProperties = {
  marginBottom: 24,
};

const hoursTitleStyles: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: 'var(--color-text-secondary)',
  marginBottom: 12,
};

const hoursGridStyles: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: 8,
};

const hoursItemStyles: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 2,
  padding: '8px 4px',
  backgroundColor: 'var(--color-bg-tertiary)',
  borderRadius: 8,
};

const hoursDayStyles: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--color-text-muted)',
  textTransform: 'uppercase',
};

const hoursTimeStyles: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--color-text-primary)',
};

const detailActionsStyles: React.CSSProperties = {
  paddingTop: 8,
};