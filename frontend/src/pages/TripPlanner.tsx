import { useEffect, useCallback, useState, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { SearchInput } from '../components/SearchInput';
import { useTripStore } from '../stores/tripStore';
import { useThemeStore } from '../stores/themeStore';
import { geocodingApi, routingApi } from '../api/client';
import { GeocodeResult } from '../stores/tripStore';
import { formatDistance } from '../utils/helpers';

function sortGeocodeResults(results: GeocodeResult[]): GeocodeResult[] {
  const typePriority: Record<string, number> = {
    mrt: 0,
    mall: 1,
    landmark: 2,
    other: 3,
    residential: 4,
  };
  return [...results].sort((a, b) => {
    const typeA = classifyLocation(a) || 'other';
    const typeB = classifyLocation(b) || 'other';
    return (typePriority[typeA] ?? 5) - (typePriority[typeB] ?? 5);
  });
}

function classifyLocation(result: GeocodeResult): GeocodeResult['locationType'] {
  const name = (result.buildingName || '').toLowerCase();
  const road = (result.roadName || '').toLowerCase();
  const address = (result.address || '').toLowerCase();
  const combined = `${name} ${road} ${address}`;

  if (combined.includes('mrt') || combined.includes('lrt') || combined.includes('station')) {
    return 'mrt';
  }
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
  if (combined.includes('blk ') || combined.includes('block ') || combined.includes('avenue') ||
      combined.includes('street') || combined.includes('road') || combined.includes('drive') ||
      combined.includes('crescent') || combined.includes('close') || combined.includes('terrace') ||
      combined.includes('grove') || combined.includes('heights') || combined.includes('park') ||
      combined.includes('ridge') || combined.includes('vale') || combined.includes('view') ||
      combined.includes('walk') || combined.includes('way') || combined.includes('lane') ||
      combined.includes('place') || combined.includes('loop') || combined.includes('link') ||
      combined.includes('rise') || combined.includes('green') || combined.includes('hill')) {
    const majorRoads = ['expressway', 'highway', 'bukit timah', 'orchard', 'shenton', 'raffles', 'marina', 'bayfront'];
    if (!majorRoads.some(r => combined.includes(r))) {
      return 'residential';
    }
  }
  return 'other';
}

export function TripPlanner() {
  const navigate = useNavigate();
  const { theme, resolvedTheme } = useThemeStore();
  const {
    origin,
    destination,
    originResults,
    destinationResults,
    route,
    erp,
    isSearching,
    isRouting,
    departureTime,
    setOrigin,
    setDestination,
    setOriginResults,
    setDestinationResults,
    setRoute,
    setERP,
    setIsSearching,
    setIsRouting,
    swapLocations,
    setDepartureTime,
    setDepartureDate,
  } = useTripStore();

  const [originInput, setOriginInput] = useState('');
  const [destInput, setDestInput] = useState('');
  const [originError, setOriginError] = useState('');
  const [destError, setDestError] = useState('');

  // Debounce refs for search
  const originDebounceRef = useRef<ReturnType<typeof setTimeout>>();
  const destDebounceRef = useRef<ReturnType<typeof setTimeout>>();
  const isRoutePlanningRef = useRef(false);

  // Debounced search
  const searchOrigin = useCallback(async (query: string) => {
    if (!query.trim()) {
      setOriginResults([]);
      return;
    }
    setIsSearching(true);
    try {
      const response = await geocodingApi.search(query, 5);
      setOriginResults(sortGeocodeResults(response.data.results));
      setOriginError('');
    } catch (error) {
      setOriginError('Failed to search locations');
      setOriginResults([]);
    } finally {
      setIsSearching(false);
    }
  }, [setOriginResults, setIsSearching]);

  const searchDestination = useCallback(async (query: string) => {
    if (!query.trim()) {
      setDestinationResults([]);
      return;
    }
    setIsSearching(true);
    try {
      const response = await geocodingApi.search(query, 5);
      setDestinationResults(sortGeocodeResults(response.data.results));
      setDestError('');
    } catch (error) {
      setDestError('Failed to search locations');
      setDestinationResults([]);
    } finally {
      setIsSearching(false);
    }
  }, [setDestinationResults, setIsSearching]);

  // Debounced search handlers for onChange
  const handleOriginSearch = useCallback((query: string) => {
    setOriginInput(query);
    if (originDebounceRef.current) clearTimeout(originDebounceRef.current);
    originDebounceRef.current = setTimeout(() => searchOrigin(query), 300);
  }, [searchOrigin]);

  const handleDestSearch = useCallback((query: string) => {
    setDestInput(query);
    if (destDebounceRef.current) clearTimeout(destDebounceRef.current);
    destDebounceRef.current = setTimeout(() => searchDestination(query), 300);
  }, [searchDestination]);

  const handleOriginSelect = useCallback((result: GeocodeResult) => {
    setOrigin({
      lat: result.latitude,
      lng: result.longitude,
      address: result.address,
      postalCode: result.postalCode,
      buildingName: result.buildingName,
    });
    setOriginInput(result.address);
    setOriginResults([]);
    planRoute();
  }, [setOrigin, setOriginResults]);

  const handleOriginClear = useCallback(() => {
    setOrigin(null);
    setOriginInput('');
    setOriginResults([]);
  }, [setOrigin, setOriginResults]);

  const handleDestSelect = useCallback((result: GeocodeResult) => {
    setDestination({
      lat: result.latitude,
      lng: result.longitude,
      address: result.address,
      postalCode: result.postalCode,
      buildingName: result.buildingName,
    });
    setDestInput(result.address);
    setDestinationResults([]);
    planRoute();
  }, [setDestination, setDestinationResults]);

  const handleDestClear = useCallback(() => {
    setDestination(null);
    setDestInput('');
    setDestinationResults([]);
  }, [setDestination, setDestinationResults]);

  const planRoute = useCallback(async () => {
    const { origin: o, destination: d } = useTripStore.getState();
    if (!o || !d) return;

    // Prevent duplicate simultaneous requests
    if (isRoutePlanningRef.current) return;
    isRoutePlanningRef.current = true;

    setIsRouting(true);
    try {
      const depTime = departureTime instanceof Date ? departureTime : new Date(departureTime);
      const response = await routingApi.preview({
        origin: { lat: o.lat, lng: o.lng, address: o.address },
        destination: { lat: d.lat, lng: d.lng, address: d.address },
        departureTime: depTime.toISOString(),
      });

      setRoute(response.data.route);
      setERP(response.data.erp);
    } catch (error) {
      console.error('Route planning failed:', error);
    } finally {
      setIsRouting(false);
      isRoutePlanningRef.current = false;
    }
  }, [departureTime, setRoute, setERP, setIsRouting]);

  // Sync inputs with store (only when origin/destination changes, not when user types)
  useEffect(() => {
    if (origin?.address && originInput !== origin.address) {
      setOriginInput(origin.address);
    }
  }, [origin]);

  useEffect(() => {
    if (destination?.address && destInput !== destination.address) {
      setDestInput(destination.address);
    }
  }, [destination]);

  if (resolvedTheme === 'dark' || theme === 'navigation') {
    document.documentElement.setAttribute('data-theme', theme === 'navigation' ? 'navigation' : 'dark');
  }

  return (
    <div className="trip-planner">
      {/* Origin Input */}
      <section className="card" style={sectionStyles}>
        <SearchInput
          label="From"
          placeholder="Enter start location"
          value={originInput}
          onChange={handleOriginSearch}
          onSelect={handleOriginSelect}
          onClear={handleOriginClear}
          results={originResults}
          isLoading={isSearching}
          error={originError}
          autoFocus
        />
      </section>

      {/* Swap Button */}
      <button
        onClick={() => {
          swapLocations();
          const temp = originInput;
          setOriginInput(destInput);
          setDestInput(temp);
          searchOrigin(destInput);
          searchDestination(temp);
        }}
        className="btn btn-ghost touch-target"
        style={swapButtonStyles}
        aria-label="Swap origin and destination"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M7 16l-4-4 4-4" />
          <path d="M17 8l4-4-4-4" />
          <path d="M3 12h18" />
          <path d="M12 3v18" />
        </svg>
      </button>

      {/* Destination Input */}
      <section className="card" style={sectionStyles}>
        <SearchInput
          label="To"
          placeholder="Enter destination"
          value={destInput}
          onChange={handleDestSearch}
          onSelect={handleDestSelect}
          onClear={handleDestClear}
          results={destinationResults}
          isLoading={isSearching}
          error={destError}
        />
      </section>

      {/* Plan Route Button (shows when origin+dest set, no route yet) */}
      {origin && destination && !route && !isRouting && (
        <section className="card" style={sectionStyles}>
          <DepartureTimePicker departureTime={departureTime} onChange={setDepartureTime} onDateChange={setDepartureDate} />
          <button
            onClick={planRoute}
            className="btn btn-primary w-full touch-target"
            style={primaryButtonStyles}
            disabled={isRouting}
          >
            Plan Route
          </button>
        </section>
      )}

      {/* Route Preview & ERP */}
                {route && erp && (
                  <section className="card" style={sectionStyles}>
                    <DepartureTimePicker departureTime={departureTime} onChange={setDepartureTime} onDateChange={setDepartureDate} />
                    <div className="card-header">
                      <h2 className="card-title">Route Preview</h2>
                      <span style={erpCostStyles}>S${(erp.leaveNowCost ?? erp.totalCost ?? 0).toFixed(2)}</span>
                    </div>

                    {/* Recalculate Route Button */}
                    <button
                      onClick={planRoute}
                      className="btn btn-secondary w-full touch-target"
                      style={departureButtonStyles}
                      disabled={isRouting}
                    >
                      {isRouting ? (
                        <>
                          <div className="spinner" style={{ width: 20, height: 20, borderWidth: 2 }} />
                          Planning...
                        </>
                      ) : (
                        'Recalculate Route'
                      )}
                    </button>

                    {/* Savings Alert */}
                    {erp.savings.offPeakTime && erp.savings.offPeak < erp.savings.immediate && (
                      <div style={savingsAlertStyles}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="12" r="10" />
                          <polyline points="12 6 12 12 16 14" />
                        </svg>
                        <div>
                          <strong>Save S${(erp.savings.immediate - erp.savings.offPeak).toFixed(2)}</strong> by leaving at {erp.savings.offPeakWindow}.
                          <br />
                          <small>Cost from S${erp.savings.immediate.toFixed(2)} to S${erp.savings.offPeak.toFixed(2)}</small>
                        </div>
                      </div>
                    )}

                    {/* ERP Gantries - grouped by road segment */}
                    {erp.gantries.length > 0 && (() => {
                      // Group gantries by roadName
                      const gantriesByRoad = erp.gantries.reduce((acc, g) => {
                        const road = g.roadName || 'Unknown Road';
                        if (!acc[road]) acc[road] = [];
                        acc[road].push(g);
                        return acc;
                      }, {} as Record<string, typeof erp.gantries>);

                      return (
                        <div style={gantriesStyles}>
                          <div style={gantryHeaderStyles}>ERP Gantries on Route</div>
                          {Object.entries(gantriesByRoad).map(([roadName, gantries]) => (
                            <div key={roadName} style={roadSegmentStyles}>
                              <div style={roadSegmentHeaderStyles}>
                                <span style={roadSegmentNameStyles}>{roadName}</span>
                                <span style={roadSegmentTotalStyles}>
                                  S${gantries.reduce((sum, g) => sum + g.rate, 0).toFixed(2)}
                                </span>
                              </div>
                              {gantries.map((g, i) => (
                                <div key={i} style={gantryItemStyles}>
                                  <div style={gantryInfoStyles}>
                                    <span style={gantryNameStyles}>{g.name}</span>
                                    {g.rateGroup && (
                                      <span style={gantryGroupStyles}>Group {g.rateGroup}</span>
                                    )}
                                    {g.arrivalTime && (
                                      <span style={gantryArrivalStyles}>
                                        Arrives {new Date(g.arrivalTime).toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Singapore' })}
                                      </span>
                                    )}
                                  </div>
                                  <div style={gantryRateContainerStyles}>
                                    {g.appliedStartTime && (
                                      <span style={gantryIntervalStyles}>from {g.appliedStartTime}</span>
                                    )}
                                    <span style={gantryRateStyles}>S${g.rate.toFixed(2)}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ))}
                        </div>
                      );
                    })()}

                    <div style={routeInfoStyles}>
                      <div style={routeMetricStyles}>
                        <span style={metricValueStyles}>{formatDistance(route.distance)}</span>
                        <span style={metricLabelStyles}>Distance</span>
                      </div>
                      <div style={routeMetricStyles}>
                        <span style={metricValueStyles}>{Math.round(route.duration / 60)} min</span>
                        <span style={metricLabelStyles}>Duration</span>
                      </div>
                    </div>

                    {/* Route Instructions */}
                    {route.instructions && route.instructions.length > 0 && (
                      <div style={gantriesStyles}>
                        <div style={gantryHeaderStyles}>Route Directions</div>
                        {route.instructions.map((inst, i) => (
                          <div key={i} style={routeInstructionStyles}>
                            <span style={instructionNumberStyles}>{i + 1}.</span>
                            <span style={instructionTextStyles}>{inst.instruction}</span>
                            <span style={instructionDistanceStyles}>{formatDistance(inst.distance)}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Check Parking Button - Flow A Trigger */}
                    <button
                      onClick={() => {
                        if (destination) {
                          navigate('/parking', {
                            state: { destination },
                          });
                        }
                      }}
                      className="btn btn-primary btn-large touch-target"
                      style={checkParkingButtonStyles}
                      disabled={!destination}
                    >
                      Check Nearby Parking
                    </button>
                  </section>
                )}

      {(!origin || !destination) && (
        <div className="card" style={{ ...sectionStyles, textAlign: 'center', padding: 32 }}>
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" strokeWidth="1.5" style={{ marginBottom: 16 }}>
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          <p style={emptyStateTextStyles}>Enter your start and destination to see ERP costs and parking options</p>
        </div>
      )}
    </div>
  );
}

const sectionStyles: React.CSSProperties = {
  marginBottom: 16,
};

const swapButtonStyles: React.CSSProperties = {
  alignSelf: 'center',
  marginBottom: 16,
  padding: 10,
  borderRadius: 50,
  backgroundColor: 'var(--color-bg-tertiary)',
  border: '1px solid var(--color-border)',
};

const erpCostStyles: React.CSSProperties = {
  fontSize: 24,
  fontWeight: 700,
  color: 'var(--color-primary)',
};

const routeInfoStyles: React.CSSProperties = {
  display: 'flex',
  gap: 24,
  marginBottom: 16,
};

const routeMetricStyles: React.CSSProperties = {
  flex: 1,
  textAlign: 'center',
  padding: '12px 0',
  backgroundColor: 'var(--color-bg-tertiary)',
  borderRadius: 12,
};

const metricValueStyles: React.CSSProperties = {
  display: 'block',
  fontSize: 20,
  fontWeight: 700,
  color: 'var(--color-text-primary)',
};

const metricLabelStyles: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--color-text-muted)',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
};

const gantriesStyles: React.CSSProperties = {
  marginBottom: 16,
  paddingTop: 12,
  borderTop: '1px solid var(--color-border)',
};

const gantryHeaderStyles: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--color-text-muted)',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  marginBottom: 8,
};

const gantryItemStyles: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  padding: '8px 0',
  fontSize: 14,
};

const gantryNameStyles: React.CSSProperties = {
  color: 'var(--color-text-secondary)',
};

const gantryRateStyles: React.CSSProperties = {
  fontWeight: 600,
  color: 'var(--color-primary)',
};

const gantryInfoStyles: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
};

const gantryGroupStyles: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--color-accent)',
  fontWeight: 500,
  textTransform: 'uppercase',
  letterSpacing: 0.3,
};

const gantryArrivalStyles: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--color-text-muted)',
};

const gantryRateContainerStyles: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-end',
  gap: 2,
};

const gantryIntervalStyles: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--color-text-muted)',
};

const routeInstructionStyles: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '10px 0',
  fontSize: 14,
  borderBottom: '1px solid var(--color-border)',
};

const instructionNumberStyles: React.CSSProperties = {
  fontWeight: 600,
  color: 'var(--color-primary)',
  minWidth: 24,
  textAlign: 'center',
  fontSize: 13,
};

const instructionTextStyles: React.CSSProperties = {
  flex: 1,
  color: 'var(--color-text-secondary)',
};

const instructionDistanceStyles: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--color-text-muted)',
  fontFamily: 'monospace',
};

const savingsAlertStyles: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 12,
  padding: 12,
  backgroundColor: 'rgba(46, 204, 113, 0.1)',
  borderRadius: 12,
  marginBottom: 16,
  border: '1px solid rgba(46, 204, 113, 0.3)',
};

const departureButtonStyles: React.CSSProperties = {
  justifyContent: 'space-between',
  marginBottom: 12,
};

const checkParkingButtonStyles: React.CSSProperties = {
  marginTop: 8,
};

const emptyStateTextStyles: React.CSSProperties = {
  color: 'var(--color-text-muted)',
  fontSize: 15,
};

const primaryButtonStyles: React.CSSProperties = {
  marginBottom: 12,
};

function DepartureTimePicker({ departureTime, onChange, onDateChange }: { departureTime: Date; onChange: (time: Date) => void; onDateChange: (date: Date) => void }) {
  const safeDepartureTime = departureTime instanceof Date && !isNaN(departureTime.getTime())
    ? departureTime
    : new Date();

  const formatTime12h = (date: Date) => {
    const hours = date.getHours();
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    return `${displayHours}:${minutes} ${ampm}`;
  };
  const formatDateLabel = (date: Date) => date.toLocaleDateString('en-SG', { weekday: 'short', month: 'short', day: 'numeric' });
  const formatMonthYear = (date: Date) => date.toLocaleDateString('en-SG', { month: 'long', year: 'numeric' });

  const now = new Date();
  const [showPicker, setShowPicker] = useState(false);
  const [pickerView, setPickerView] = useState<'date' | 'time'>('date');
  const [calendarMonth, setCalendarMonth] = useState(new Date(safeDepartureTime.getFullYear(), safeDepartureTime.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(new Date(safeDepartureTime));
  const [selectedTime, setSelectedTime] = useState({ h: safeDepartureTime.getHours(), m: safeDepartureTime.getMinutes() });

  // Generate 15-minute interval time slots
  const timeSlots = useMemo(() => {
    const slots: { h: number; m: number; label: string }[] = [];
    for (let h = 0; h < 24; h++) {
      for (let m = 0; m < 60; m += 15) {
        const d = new Date();
        d.setHours(h, m, 0, 0);
        slots.push({ h, m, label: formatTime12h(d) });
      }
    }
    return slots;
  }, []);

  // Calendar helpers
  const daysInMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  const firstDayOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1).getDay();
  const addMonths = (date: Date, months: number) => new Date(date.getFullYear(), date.getMonth() + months, 1);

  const calendarDays = useMemo(() => {
    const days: (Date | null)[] = [];
    const firstDay = firstDayOfMonth(calendarMonth);
    const totalDays = daysInMonth(calendarMonth);
    const prevMonthDays = daysInMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 0));

    // Previous month padding
    for (let i = firstDay - 1; i >= 0; i--) {
      days.push(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, prevMonthDays - i));
    }
    // Current month
    for (let d = 1; d <= totalDays; d++) {
      days.push(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), d));
    }
    // Next month padding to fill 6 rows (42 cells)
    const remaining = 42 - days.length;
    for (let d = 1; d <= remaining; d++) {
      days.push(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, d));
    }
    return days;
  }, [calendarMonth]);

  const isToday = (date: Date) => date.toDateString() === now.toDateString();
  const isSelectedDate = (date: Date) => date.toDateString() === selectedDate.toDateString();
  const isBeforeToday = (date: Date) => date < new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const isSameTime = (h: number, m: number) => h === selectedTime.h && m === selectedTime.m;

  const handlePreset = (minutesToAdd: number) => {
    const date = new Date(now.getTime() + minutesToAdd * 60000);
    date.setSeconds(0, 0);
    const newDate = new Date(selectedDate);
    newDate.setHours(date.getHours(), date.getMinutes(), 0, 0);
    onChange(newDate);
    setSelectedTime({ h: date.getHours(), m: date.getMinutes() });
    setShowPicker(false);
  };

  const handleDateSelect = (date: Date) => {
    if (isBeforeToday(date)) return;
    const newDate = new Date(date);
    newDate.setHours(selectedTime.h, selectedTime.m, 0, 0);
    onChange(newDate);
    onDateChange(date);
    setSelectedDate(date);
    setPickerView('time');
  };

  const handleTimeSelect = (h: number, m: number) => {
    const newDate = new Date(selectedDate);
    newDate.setHours(h, m, 0, 0);
    onChange(newDate);
    setSelectedTime({ h, m });
    setShowPicker(false);
  };

  const handleMonthChange = (delta: number) => {
    setCalendarMonth(addMonths(calendarMonth, delta));
  };

  const handleDone = () => {
    const newDate = new Date(selectedDate);
    newDate.setHours(selectedTime.h, selectedTime.m, 0, 0);
    onChange(newDate);
    setShowPicker(false);
  };

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (showPicker && !(e.target as HTMLElement).closest('[data-time-picker]')) {
        setShowPicker(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showPicker]);

  const triggerValue = `${formatDateLabel(safeDepartureTime)} · ${formatTime12h(safeDepartureTime)}`;

  return (
    <div style={timePickerStyles} data-time-picker>
      <div style={timePickerHeaderStyles}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--color-text-muted)', flexShrink: 0 }}>
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
        <span style={timePickerLabelStyles}>Departure Date & Time</span>
      </div>

      <button
        type="button"
        onClick={() => setShowPicker(!showPicker)}
        style={pickerTriggerStyles}
        className="touch-target"
        aria-expanded={showPicker}
        aria-haspopup="dialog"
        aria-label="Select departure date and time"
      >
        <span style={pickerTriggerValueStyles}>{triggerValue}</span>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--color-text-muted)', flexShrink: 0, transition: 'transform 0.15s ease', transform: showPicker ? 'rotate(180deg)' : 'rotate(0deg)' }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {showPicker && (
        <div style={pickerOverlayStyles} onClick={() => setShowPicker(false)}>
          <div style={pickerPanelStyles} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Select departure date and time">
            {/* Header */}
            <div style={pickerHeaderStyles}>
              <button
                type="button"
                onClick={() => setPickerView('date')}
                style={{
                  ...pickerTabStyles,
                  ...(pickerView === 'date' ? pickerTabActiveStyles : {}),
                }}
                className="touch-target"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
                <span>Date</span>
              </button>
              <button
                type="button"
                onClick={() => setPickerView('time')}
                style={{
                  ...pickerTabStyles,
                  ...(pickerView === 'time' ? pickerTabActiveStyles : {}),
                }}
                className="touch-target"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                <span>Time</span>
              </button>
            </div>

            {/* Quick Presets */}
            <div style={pickerPresetsStyles}>
              <button
                type="button"
                onClick={() => handlePreset(0)}
                style={pickerPresetStyles}
                className="touch-target"
              >
                <span>Leave Now</span>
                <span style={pickerPresetTimeStyles}>{formatTime12h(now)}</span>
              </button>
              <button
                type="button"
                onClick={() => handlePreset(15)}
                style={pickerPresetStyles}
                className="touch-target"
              >
                <span>+15 min</span>
                <span style={pickerPresetTimeStyles}>{formatTime12h(new Date(now.getTime() + 15 * 60000))}</span>
              </button>
              <button
                type="button"
                onClick={() => handlePreset(30)}
                style={pickerPresetStyles}
                className="touch-target"
              >
                <span>+30 min</span>
                <span style={pickerPresetTimeStyles}>{formatTime12h(new Date(now.getTime() + 30 * 60000))}</span>
              </button>
              <button
                type="button"
                onClick={() => handlePreset(60)}
                style={pickerPresetStyles}
                className="touch-target"
              >
                <span>+1 hr</span>
                <span style={pickerPresetTimeStyles}>{formatTime12h(new Date(now.getTime() + 60 * 60000))}</span>
              </button>
            </div>

            <div style={pickerDividerStyles} />

            {/* Calendar View */}
            {pickerView === 'date' && (
              <div style={pickerContentStyles}>
                <div style={calendarHeaderStyles}>
                  <button
                    type="button"
                    onClick={() => handleMonthChange(-1)}
                    style={calendarNavStyles}
                    className="touch-target"
                    aria-label="Previous month"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="15 18 9 12 15 6" />
                    </svg>
                  </button>
                  <span style={calendarTitleStyles}>{formatMonthYear(calendarMonth)}</span>
                  <button
                    type="button"
                    onClick={() => handleMonthChange(1)}
                    style={calendarNavStyles}
                    className="touch-target"
                    aria-label="Next month"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                </div>
                <div style={calendarWeekdaysStyles}>
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                    <div key={day} style={calendarWeekdayStyles}>{day}</div>
                  ))}
                </div>
                <div style={calendarGridStyles}>
                  {calendarDays.map((day, i) => {
                    if (!day) return <div key={i} style={calendarDayStyles} />;
                    const disabled = isBeforeToday(day);
                    const selected = isSelectedDate(day);
                    const today = isToday(day);
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => handleDateSelect(day)}
                        disabled={disabled}
                        style={{
                          ...calendarDayStyles,
                          ...(selected ? calendarDaySelectedStyles : {}),
                          ...(today && !selected ? calendarDayTodayStyles : {}),
                          ...(disabled ? calendarDayDisabledStyles : {}),
                        }}
                        className="touch-target"
                        aria-selected={selected}
                        aria-disabled={disabled}
                        aria-label={day.toLocaleDateString('en-SG', { weekday: 'long', month: 'short', day: 'numeric' })}
                      >
                        {day.getDate()}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Time Grid View */}
            {pickerView === 'time' && (
              <div style={pickerContentStyles}>
                <div style={timeGridHeaderStyles}>
                  <span style={timeGridTitleStyles}>Select Time</span>
                  <button
                    type="button"
                    onClick={handleDone}
                    style={timeGridDoneStyles}
                    className="touch-target"
                  >
                    Done
                  </button>
                </div>
                <div style={timeGridStyles}>
                  {timeSlots.map((slot, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => handleTimeSelect(slot.h, slot.m)}
                      style={{
                        ...timeGridItemStyles,
                        ...(isSameTime(slot.h, slot.m) ? timeGridItemSelectedStyles : {}),
                      }}
                      className="touch-target"
                      aria-selected={isSameTime(slot.h, slot.m)}
                    >
                      {slot.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const timePickerStyles: React.CSSProperties = {
  padding: '12px 16px',
  backgroundColor: 'var(--color-bg-tertiary)',
  borderRadius: 12,
  marginBottom: 12,
  border: '1px solid var(--color-border)',
};

const timePickerHeaderStyles: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginBottom: 8,
  fontSize: 13,
  fontWeight: 500,
  color: 'var(--color-text-secondary)',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
};

const timePickerLabelStyles: React.CSSProperties = {
  flex: 1,
};

/* ===== Clean Combined Date-Time Picker Styles ===== */
const pickerTriggerStyles: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  width: '100%',
  padding: '14px 16px',
  backgroundColor: 'var(--color-bg-secondary)',
  border: '1px solid var(--color-border)',
  borderRadius: 10,
  fontSize: 15,
  fontWeight: 500,
  color: 'var(--color-text-primary)',
  cursor: 'pointer',
  transition: 'border-color 0.15s ease, background-color 0.15s ease',
  textAlign: 'left',
  minHeight: 48,
  fontFamily: 'inherit',
};

const pickerTriggerValueStyles: React.CSSProperties = {
  flex: 1,
  textAlign: 'center',
  letterSpacing: '-0.1px',
};

const pickerOverlayStyles: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: 'rgba(0,0,0,0.35)',
  backdropFilter: 'blur(4px)',
  WebkitBackdropFilter: 'blur(4px)',
  zIndex: 100,
  display: 'flex',
  alignItems: 'flex-end',
  justifyContent: 'center',
  padding: '24px 16px',
  paddingBottom: 'max(24px, env(safe-area-inset-bottom))',
};

const pickerPanelStyles: React.CSSProperties = {
  width: '100%',
  maxWidth: 420,
  backgroundColor: 'var(--color-bg-primary)',
  borderRadius: '16px 16px 0 0',
  boxShadow: '0 -4px 24px rgba(0,0,0,0.15)',
  overflow: 'hidden',
  maxHeight: '85vh',
  display: 'flex',
  flexDirection: 'column',
};

const pickerHeaderStyles: React.CSSProperties = {
  display: 'flex',
  gap: 4,
  padding: '12px 16px 8px',
  borderBottom: '1px solid var(--color-border)',
};

const pickerTabStyles: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flex: 1,
  padding: '10px 12px',
  borderRadius: 10,
  fontSize: 14,
  fontWeight: 500,
  color: 'var(--color-text-secondary)',
  backgroundColor: 'transparent',
  border: 'none',
  cursor: 'pointer',
  transition: 'all 0.15s ease',
  fontFamily: 'inherit',
};

const pickerTabActiveStyles: React.CSSProperties = {
  color: 'var(--color-primary)',
  backgroundColor: 'var(--color-primary-light)',
};

const pickerPresetsStyles: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
  padding: '12px 16px',
  borderBottom: '1px solid var(--color-border)',
};

const pickerPresetStyles: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 3,
  padding: '10px 14px',
  backgroundColor: 'var(--color-bg-tertiary)',
  border: '1px solid var(--color-border)',
  borderRadius: 9999,
  fontSize: 12,
  fontWeight: 500,
  color: 'var(--color-text-primary)',
  cursor: 'pointer',
  transition: 'all 0.15s ease',
  minWidth: 76,
  fontFamily: 'inherit',
};

const pickerPresetTimeStyles: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--color-primary)',
};

const pickerDividerStyles: React.CSSProperties = {
  height: 1,
  backgroundColor: 'var(--color-border)',
  margin: '0 16px',
};

const pickerContentStyles: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: '8px 16px 16px',
};

const calendarHeaderStyles: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '8px 0 12px',
};

const calendarNavStyles: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 36,
  height: 36,
  borderRadius: 10,
  backgroundColor: 'transparent',
  border: 'none',
  color: 'var(--color-text-secondary)',
  cursor: 'pointer',
  transition: 'all 0.15s ease',
};

const calendarTitleStyles: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 500,
  color: 'var(--color-text-primary)',
};

const calendarWeekdaysStyles: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(7, 1fr)',
  gap: 4,
  padding: '4px 0 8px',
  color: 'var(--color-text-muted)',
  fontSize: 11,
  fontWeight: 500,
  textTransform: 'uppercase',
  letterSpacing: 0.3,
};

const calendarWeekdayStyles: React.CSSProperties = {
  textAlign: 'center',
};

const calendarGridStyles: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(7, 1fr)',
  gap: 4,
};

const calendarDayStyles: React.CSSProperties = {
  aspectRatio: '1',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 10,
  fontSize: 14,
  fontWeight: 400,
  color: 'var(--color-text-primary)',
  backgroundColor: 'transparent',
  border: 'none',
  cursor: 'pointer',
  transition: 'all 0.1s ease',
  fontFamily: 'inherit',
};

const calendarDaySelectedStyles: React.CSSProperties = {
  backgroundColor: 'var(--color-primary)',
  color: '#fff',
};

const calendarDayTodayStyles: React.CSSProperties = {
  fontWeight: 600,
  color: 'var(--color-primary)',
};

const calendarDayDisabledStyles: React.CSSProperties = {
  color: 'var(--color-text-muted)',
  opacity: 0.4,
  cursor: 'not-allowed',
};

const timeGridHeaderStyles: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '8px 0 12px',
};

const timeGridTitleStyles: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 500,
  color: 'var(--color-text-primary)',
};

const timeGridDoneStyles: React.CSSProperties = {
  padding: '8px 16px',
  borderRadius: 9999,
  backgroundColor: 'var(--color-primary)',
  color: '#fff',
  fontSize: 13,
  fontWeight: 500,
  border: 'none',
  cursor: 'pointer',
  transition: 'background-color 0.15s ease',
  fontFamily: 'inherit',
};

const timeGridStyles: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(4, 1fr)',
  gap: 8,
};

const timeGridItemStyles: React.CSSProperties = {
  aspectRatio: '1',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 10,
  fontSize: 13,
  fontWeight: 500,
  color: 'var(--color-text-primary)',
  backgroundColor: 'var(--color-bg-tertiary)',
  border: '1px solid var(--color-border)',
  cursor: 'pointer',
  transition: 'all 0.1s ease',
  fontFamily: 'inherit',
};

const timeGridItemSelectedStyles: React.CSSProperties = {
  backgroundColor: 'var(--color-primary)',
  borderColor: 'var(--color-primary)',
  color: '#fff',
};

const roadSegmentStyles: React.CSSProperties = {
  marginBottom: 16,
  padding: '12px 16px',
  backgroundColor: 'var(--color-bg-tertiary)',
  borderRadius: 12,
  border: '1px solid var(--color-border)',
};

const roadSegmentHeaderStyles: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 8,
  paddingBottom: 8,
  borderBottom: '1px solid var(--color-border)',
};

const roadSegmentNameStyles: React.CSSProperties = {
  fontWeight: 600,
  color: 'var(--color-text-primary)',
  fontSize: 14,
};

const roadSegmentTotalStyles: React.CSSProperties = {
  fontWeight: 600,
  color: 'var(--color-primary)',
  fontSize: 14,
};