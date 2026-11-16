import { useEffect, useState, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import L from 'leaflet';
import { useTripStore } from '../stores/tripStore';
import { routingApi } from '../api/client';
import { formatDistance } from '../utils/helpers';

const CarIcon = L.divIcon({
  className: 'car-marker',
  html: `<div style="
    width: 40px; height: 40px;
    background: var(--color-primary);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    border: 3px solid var(--color-bg-secondary);
  ">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
      <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 13 10a5.003 5.003 0 0 0-5 5c0 1.1.3 2.1.8 2.9l1.5 1.5c.3.3.3.8 0 1.1l-1.5 1.5a2 2 0 0 1-2.83 0L2 12"/>
    </svg>
  </div>`,
  iconSize: [40, 40],
  iconAnchor: [20, 20],
});

const DestinationIcon = L.divIcon({
  className: 'dest-marker',
  html: `<div style="
    width: 36px; height: 36px;
    background: var(--color-critical);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    border: 3px solid var(--color-bg-secondary);
  ">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="white" stroke="white" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  </div>`,
  iconSize: [36, 36],
  iconAnchor: [18, 18],
});

const ParkingIcon = L.divIcon({
  className: 'parking-marker',
  html: `<div style="
    width: 36px; height: 36px;
    background: var(--color-available);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    border: 3px solid var(--color-bg-secondary);
  ">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="white" stroke="white" strokeWidth="2.5">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 3v18M15 3v18" />
    </svg>
  </div>`,
  iconSize: [36, 36],
  iconAnchor: [18, 18],
});

export function NavigationView() {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    route,
    erp,
    selectedCarpark,
    destination,
    isNavigating,
    setIsNavigating,
    setSelectedCarpark,
  } = useTripStore();

  const [simulatedPosition, setSimulatedPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [showReroute, setShowReroute] = useState(false);
  const simulationInterval = useRef<number>();

  const carpark = location.state?.carpark as typeof selectedCarpark || selectedCarpark;
  const dest = location.state?.destination as typeof destination || destination;
  const savedRoute = location.state?.route as typeof route || route;
  const savedErp = location.state?.erp as typeof erp || erp;

  useEffect(() => {
    if (!isNavigating || !carpark || !dest) {
      navigate('/');
      return;
    }

    // Start simulation
    if (savedRoute?.geometry) {
      // In real app, would decode polyline and simulate along route
      // For demo, just show car at origin moving to destination
      // Simulate movement
      let progress = 0;
      simulationInterval.current = window.setInterval(() => {
        progress += 0.02;
        if (progress >= 1) {
          progress = 1;
          clearInterval(simulationInterval.current);
        }
        if (savedRoute && dest) {
          // Linear interpolation for demo
          const lat = 1.3521 + (dest.lat - 1.3521) * progress; // Mock start
          const lng = 103.9434 + (dest.lng - 103.9434) * progress;
          setSimulatedPosition({ lat, lng });
        }
      }, 2000);
    }

    // Force dark theme during navigation
    document.documentElement.setAttribute('data-theme', 'navigation');

    return () => {
      if (simulationInterval.current) {
        clearInterval(simulationInterval.current);
      }
      document.documentElement.setAttribute('data-theme', 'light');
    };
  }, [isNavigating, carpark, dest, savedRoute, navigate]);

  const handleReroute = async () => {
    if (!simulatedPosition || !carpark || !dest) return;

    try {
      const response = await routingApi.reroute({
        startLat: simulatedPosition.lat,
        startLng: simulatedPosition.lng,
        endLat: carpark.entranceLocation?.lat || carpark.latitude || dest.lat,
        endLng: carpark.entranceLocation?.lng || carpark.longitude || dest.lng,
        departureTime: new Date().toISOString(),
      });
      // Update route in store
      console.log('Rerouted:', response.data);
      setShowReroute(false);
    } catch (error) {
      console.error('Reroute failed:', error);
    }
  };

  const handleExitNav = () => {
    setIsNavigating(false);
    setSelectedCarpark(null);
    navigate('/');
  };

  if (!carpark || !dest) {
    return null;
  }

  const centerLat = simulatedPosition?.lat || dest.lat;
  const centerLng = simulatedPosition?.lng || dest.lng;

  return (
    <div className="navigation-view" style={containerStyles}>
      {/* Map */}
      <div style={mapStyles}>
        <MapContainer
          center={[centerLat, centerLng]}
          zoom={15}
          scrollWheelZoom={false}
          style={mapContainerStyles}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          {/* Route Polyline */}
          {savedRoute?.geometry && (
            <Polyline
              positions={decodePolyline(savedRoute.geometry)}
              color={varStyles.erpRoute}
              weight={5}
              opacity={0.8}
              dashArray="10, 10"
            />
          )}

          {/* Simulated Car Position */}
          {simulatedPosition && (
            <Marker position={[simulatedPosition.lat, simulatedPosition.lng]} icon={CarIcon}>
              <Popup>Your Location</Popup>
            </Marker>
          )}

          {/* Destination */}
          <Marker position={[dest.lat, dest.lng]} icon={DestinationIcon}>
            <Popup>{dest.buildingName || dest.address}</Popup>
          </Marker>

          {/* Selected Carpark */}
          {carpark.entranceLocation && (
            <Marker
              position={[carpark.entranceLocation.lat, carpark.entranceLocation.lng]}
              icon={ParkingIcon}
            >
              <Popup>{carpark.name} ({carpark.availableLots} lots)</Popup>
            </Marker>
          )}
        </MapContainer>
      </div>

      {/* Bottom Navigation Panel */}
      <div className="card" style={panelStyles}>
        <div style={panelHeaderStyles}>
          <div>
            <h2 style={panelTitleStyles}>Navigating to {carpark.name}</h2>
            <p style={panelSubtitleStyles}>{carpark.address}</p>
          </div>
          <span className={`status-badge status-${carpark.status.toLowerCase()}`}>
            {carpark.availableLots} lots
          </span>
        </div>

        <div style={panelMetricsStyles}>
          <div style={panelMetricStyles}>
            <span style={panelMetricValueStyles}>{formatDistance(carpark.distanceMeters)}</span>
            <span style={panelMetricLabelStyles}>Remaining</span>
          </div>
          <div style={panelMetricStyles}>
            <span style={panelMetricValueStyles} id="eta">~5 min</span>
            <span style={panelMetricLabelStyles}>ETA</span>
          </div>
          <div style={panelMetricStyles}>
            <span style={panelMetricValueStyles} id="erp-cost">S${savedErp?.totalCost.toFixed(2) || '0.00'}</span>
            <span style={panelMetricLabelStyles}>ERP Cost</span>
          </div>
        </div>

        {/* Reroute Alert */}
        {showReroute && (
          <div style={rerouteAlertStyles}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-critical)" strokeWidth="2">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <div style={flexStyles}>
              <strong>Carpark nearly full!</strong>
              <span>Only {carpark.availableLots} lots remaining</span>
            </div>
            <button
              onClick={handleReroute}
              className="btn btn-primary touch-target"
              style={rerouteButtonStyles}
            >
              Reroute
            </button>
          </div>
        )}

        <button
          onClick={handleExitNav}
          className="btn btn-secondary btn-large touch-target"
          style={exitButtonStyles}
        >
          Exit Navigation
        </button>
      </div>

      {/* Simulate reroute trigger for demo */}
      {simulatedPosition && carpark.availableLots <= 3 && !showReroute && (
        <>
          <script dangerouslySetInnerHTML={{
            __html: `setTimeout(() => { window.dispatchEvent(new CustomEvent('show-reroute')); }, 10000);`
          }} />
        </>
      )}
    </div>
  );
}

// Simple polyline decoder (simplified)
function decodePolyline(_encoded: string): [number, number][] {
  // In production, use @mapbox/polyline or similar
  // This is a placeholder returning empty array
  return [];
}

const varStyles = {
  erpRoute: '#00ADB5',
};

const containerStyles: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  backgroundColor: 'var(--color-bg-primary)',
};

const mapStyles: React.CSSProperties = {
  flex: 1,
  position: 'relative',
};

const mapContainerStyles: React.CSSProperties = {
  width: '100%',
  height: '100%',
  zIndex: 1,
};

const panelStyles: React.CSSProperties = {
  position: 'relative',
  zIndex: 10,
  margin: '0 16px 16px',
  borderRadius: '20px 20px 0 0',
  padding: '20px 16px 24px',
  boxShadow: '0 -4px 24px var(--color-shadow-strong)',
  backgroundColor: 'var(--color-bg-secondary)',
  border: '1px solid var(--color-border)',
  borderBottom: 'none',
};

const panelHeaderStyles: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  marginBottom: 16,
};

const panelTitleStyles: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 700,
  color: 'var(--color-text-primary)',
  marginBottom: 4,
};

const panelSubtitleStyles: React.CSSProperties = {
  fontSize: 13,
  color: 'var(--color-text-secondary)',
};

const panelMetricsStyles: React.CSSProperties = {
  display: 'flex',
  gap: 16,
  marginBottom: 16,
  padding: '16px 0',
  borderTop: '1px solid var(--color-border)',
  borderBottom: '1px solid var(--color-border)',
};

const panelMetricStyles: React.CSSProperties = {
  flex: 1,
  textAlign: 'center',
};

const panelMetricValueStyles: React.CSSProperties = {
  display: 'block',
  fontSize: 22,
  fontWeight: 700,
  color: 'var(--color-text-primary)',
};

const panelMetricLabelStyles: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--color-text-muted)',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
};

const rerouteAlertStyles: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: 12,
  backgroundColor: 'rgba(231, 76, 60, 0.1)',
  borderRadius: 12,
  marginBottom: 16,
  border: '1px solid rgba(231, 76, 60, 0.3)',
};

const flexStyles: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  flex: 1,
};

const rerouteButtonStyles: React.CSSProperties = {
  padding: '8px 16px',
  fontSize: 14,
  whiteSpace: 'nowrap',
};

const exitButtonStyles: React.CSSProperties = {
  marginTop: 8,
};