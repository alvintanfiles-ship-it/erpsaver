import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Location {
  lat: number;
  lng: number;
  address?: string;
  postalCode?: string;
  buildingName?: string;
}

export interface GeocodeResult {
  address: string;
  latitude: number;
  longitude: number;
  postalCode: string;
  buildingName: string;
  roadName?: string;
  locationType?: 'mrt' | 'mall' | 'landmark' | 'residential' | 'other';
}

export interface RouteInstruction {
  instruction: string;
  distance: number;
  duration: number;
  point: { lat: number; lng: number };
}

export interface RouteResult {
  distance: number;
  duration: number;
  geometry: string;
  instructions: RouteInstruction[];
}

export interface ERPResponse {
  leaveNowCost: number;
  totalCost: number;
  gantries: Array<{
    gantryCode: string;
    name: string;
    rate: number;
    arrivalTime?: string;
    appliedStartTime?: string;
    rateGroup?: string;
    roadName?: string;
  }>;
  departureTime: string;
  savings: {
    immediate: number;
    offPeak: number;
    offPeakTime: string | null;
    offPeakWindow: string | null;
  };
  departureWindows: Array<{
    label: string;
    time: string;
    cost: number;
    savings: number;
  }>;
}

export interface Carpark {
  id: string;
  carparkCode: string;
  name: string;
  provider: 'HDB' | 'URA' | 'MALL';
  address: string;
  distanceMeters: number;
  totalLots: number;
  availableLots: number;
  status: 'AVAILABLE' | 'FILLING_UP' | 'CRITICAL' | 'UNKNOWN';
  statusColor: string;
  statusLabel: string;
  distanceLabel: string;
  rateScheduleId: string | null;
  operatingHours: Record<string, string> | null;
  // Entrance location for navigation
  entranceLocation?: { lat: number; lng: number };
  latitude?: number;
  longitude?: number;
}

interface TripState {
  // Origin/Destination
  origin: Location | null;
  destination: Location | null;
  setOrigin: (loc: Location | null) => void;
  setDestination: (loc: Location | null) => void;
  swapLocations: () => void;

  // Search results
  originResults: GeocodeResult[];
  destinationResults: GeocodeResult[];
  setOriginResults: (results: GeocodeResult[]) => void;
  setDestinationResults: (results: GeocodeResult[]) => void;

  // Route & ERP
  route: RouteResult | null;
  erp: ERPResponse | null;
  setRoute: (route: RouteResult | null) => void;
  setERP: (erp: ERPResponse | null) => void;

  // Parking
  nearbyCarparks: Carpark[];
  selectedCarpark: Carpark | null;
  setNearbyCarparks: (carparks: Carpark[]) => void;
  setSelectedCarpark: (carpark: Carpark | null) => void;

  // UI State
  isSearching: boolean;
  isRouting: boolean;
  isCheckingParking: boolean;
  setIsSearching: (v: boolean) => void;
  setIsRouting: (v: boolean) => void;
  setIsCheckingParking: (v: boolean) => void;

  // Departure time (date + time combined)
  departureTime: Date;
  setDepartureTime: (time: Date) => void;
  setDepartureDate: (date: Date) => void;

  // Speed lockout
  isSpeedLockout: boolean;
  setSpeedLockout: (v: boolean) => void;

  // Navigation mode
  isNavigating: boolean;
  setIsNavigating: (v: boolean) => void;

  // Reset
  resetTrip: () => void;
}

const initialState = {
  origin: null,
  destination: null,
  originResults: [],
  destinationResults: [],
  route: null,
  erp: null,
  nearbyCarparks: [],
  selectedCarpark: null,
  isSearching: false,
  isRouting: false,
  isCheckingParking: false,
  departureTime: new Date(),
  isSpeedLockout: false,
  isNavigating: false,
};

export const useTripStore = create<TripState>()(
  persist(
    (set) => ({
      ...initialState,

      setOrigin: (loc) => set({ origin: loc }),
      setDestination: (loc) => set({ destination: loc }),

      swapLocations: () => set((state) => ({
        origin: state.destination,
        destination: state.origin,
      })),

      setOriginResults: (results) => set({ originResults: results }),
      setDestinationResults: (results) => set({ destinationResults: results }),

      setRoute: (route) => set({ route }),
      setERP: (erp) => set({ erp }),

      setNearbyCarparks: (carparks) => set({ nearbyCarparks: carparks }),
      setSelectedCarpark: (carpark) => set({ selectedCarpark: carpark }),

      setIsSearching: (v) => set({ isSearching: v }),
      setIsRouting: (v) => set({ isRouting: v }),
      setIsCheckingParking: (v) => set({ isCheckingParking: v }),

      setDepartureTime: (time) => set({ departureTime: time }),

      setDepartureDate: (date) => set((state) => {
        const current = state.departureTime instanceof Date ? state.departureTime : new Date(state.departureTime);
        return {
          departureTime: new Date(
            date.getFullYear(),
            date.getMonth(),
            date.getDate(),
            current.getHours(),
            current.getMinutes(),
            0,
            0
          ),
        };
      }),

      setSpeedLockout: (v) => set({ isSpeedLockout: v }),

      setIsNavigating: (v) => set({ isNavigating: v }),

      resetTrip: () => set(initialState),
    }),
    {
      name: 'erpsaver-trip',
      partialize: (state) => ({
        origin: state.origin,
        destination: state.destination,
        departureTime: state.departureTime,
      }),
    }
  )
);