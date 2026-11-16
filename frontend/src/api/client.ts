import axios, { AxiosError } from 'axios';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api/v1';

const api = axios.create({
  baseURL: API_BASE,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.response.use(
  (response) => response,
  (error: AxiosError<{ message?: string }>) => {
    const message = error.response?.data?.message || error.message || 'Request failed';
    return Promise.reject(new Error(message));
  }
);

// Geocoding
export const geocodingApi = {
  search: (query: string, limit = 5) =>
    api.get('/geocoding/search', { params: { q: query, limit } }),

  reverse: (lat: number, lng: number) =>
    api.get('/geocoding/reverse', { params: { lat, lng } }),

  batch: (queries: string[]) =>
    api.post('/geocoding/batch', { queries }),
};

// Routing & ERP
export const routingApi = {
  plan: (data: {
    startLat: number;
    startLng: number;
    endLat: number;
    endLng: number;
    mode?: 'drive' | 'pt' | 'walk' | 'cycle';
    departureTime?: string;
  }) => api.post('/routing/plan', data),

  preview: (data: {
    origin: { lat: number; lng: number; address?: string };
    destination: { lat: number; lng: number; address?: string };
    departureTime?: string;
  }) => api.post('/routing/preview', data),

  reroute: (data: {
    startLat: number;
    startLng: number;
    endLat: number;
    endLng: number;
    departureTime?: string;
  }) => api.post('/routing/reroute', data),
};

export const erpApi = {
  cost: (gantryIds: string[], departureTime?: string) =>
    api.post('/erp/cost', { gantryIds, departureTime }),

  windows: (gantryIds: string[], fromTime?: string) =>
    api.post('/erp/windows', { gantryIds, fromTime }),

  gantrySchedule: (id: string) =>
    api.get(`/erp/gantry/${id}/schedule`),

  gantries: () =>
    api.get('/erp/gantries'),

  status: () =>
    api.get('/erp/status'),

  rates: (gantryIds: string[], time?: string) =>
    api.post('/erp/rates', { gantryIds, time }),
};

// Parking
export const parkingApi = {
  nearby: (data: {
    lat: number;
    lng: number;
    radius?: number;
    providers?: ('HDB' | 'URA' | 'MALL')[];
    minLots?: number;
  }) => api.post('/parking/nearby', data),

  detail: (id: string) =>
    api.get(`/parking/${id}`),

  byCode: (code: string) =>
    api.get(`/parking/code/${code}`),

  search: (query: string, lat?: number, lng?: number, radius?: number) =>
    api.get('/parking/search', { params: { q: query, lat, lng, radius } }),
};

// Admin
export const adminApi = {
  syncURA: () => api.post('/carparks/sync/ura'),
  syncLTA: () => api.post('/carparks/sync/lta'),
  refreshAvailability: () => api.post('/carparks/refresh/availability'),
  stats: () => api.get('/carparks/stats'),
};

export default api;