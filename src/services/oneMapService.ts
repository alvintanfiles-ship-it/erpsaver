import axios, { AxiosInstance } from 'axios';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { cache } from '../cache/redis.js';
import { AppError } from '../middleware/errorHandler.js';

interface OneMapTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface OneMapGeocodeResponse {
  found: number;
  results: Array<{
    ADDRESS: string;
    X: string; // Longitude (SVY21)
    Y: string; // Latitude (SVY21)
    LATITUDE: string; // WGS84
    LONGITUDE: string; // WGS84
    BUILDINGNAME: string;
    BLK_NO: string;
    ROAD_NAME: string;
    POSTAL: string;
    X_ADDR: string;
    Y_ADDR: string;
  }>;
}

interface OneMapRoutingResponse {
  route_summary: {
    total_distance: number;
    total_time: number;
  };
  route_geometry: string; // Encoded polyline
  route_instructions: Array<[
    string, // action: "Head", "Turn", "Merge", etc.
    string, // road name
    number, // distance in meters
    string, // point: "lat,lng"
    number, // duration in seconds
    string, // formatted distance: "521m"
    string, // direction: "East", "North", etc.
    string, // bearing direction
    string, // mode: "driving"
    string  // full instruction text
  ]>;
}

class OneMapService {
  private client: AxiosInstance;
  private token: string | null = null;
  private tokenExpiry: number = 0;

  constructor() {
    this.client = axios.create({
      baseURL: env.ONEMAP_API_URL,
      timeout: 30000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private async getToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiry - 60000) {
      return this.token;
    }

    if (!env.ONEMAP_EMAIL || !env.ONEMAP_PASSWORD) {
      throw AppError.internal('OneMap credentials not configured');
    }

    try {
      const response = await this.client.post<OneMapTokenResponse>('/auth/post/getToken', {
        email: env.ONEMAP_EMAIL,
        password: env.ONEMAP_PASSWORD,
      });

      this.token = response.data.access_token;
      // OneMap returns expiry_timestamp (Unix timestamp), not expires_in (seconds)
      const expiryTimestamp = (response.data as any).expiry_timestamp;
      this.tokenExpiry = expiryTimestamp ? expiryTimestamp * 1000 : Date.now() + 24 * 60 * 60 * 1000;

      logger.debug('OneMap token refreshed');
      return this.token;
    } catch (error) {
      logger.error({ error }, 'OneMap authentication failed');
      throw AppError.serviceUnavailable('Geocoding service unavailable');
    }
  }

  async geocode(query: string): Promise<Array<{
    address: string;
    latitude: number;
    longitude: number;
    postalCode: string;
    buildingName: string;
  }>> {
    await this.getToken();

    type GeocodeResult = {
      address: string;
      latitude: number;
      longitude: number;
      postalCode: string;
      buildingName: string;
    };
    const cacheKey = `geocode:${query.toLowerCase()}`;
    const cached = await cache.get<GeocodeResult[]>(cacheKey);
    if (cached) return cached;

    try {
      // New OneMap search endpoint uses /api/common/elastic/search with raw token in Authorization header
      const response = await this.client.get<OneMapGeocodeResponse>('/common/elastic/search', {
        params: {
          searchVal: query,
          returnGeom: 'Y',
          getAddrDetails: 'Y',
          pageNum: 1,
        },
        headers: {
          Authorization: this.token, // Raw token, no "Bearer " prefix
        },
      });

      const result = response.data.results.map(r => ({
        address: r.ADDRESS,
        latitude: parseFloat(r.LATITUDE),
        longitude: parseFloat(r.LONGITUDE),
        postalCode: r.POSTAL,
        buildingName: r.BUILDINGNAME,
        roadName: r.ROAD_NAME,
      }));

      await cache.set(cacheKey, result, 3600); // 1 hour cache for geocoding
      return result;
    } catch (error) {
      logger.error({ error, query }, 'OneMap geocoding failed');
      throw AppError.serviceUnavailable('Geocoding service unavailable');
    }
  }

  async reverseGeocode(lat: number, lng: number): Promise<string | null> {
    await this.getToken();

    try {
      const response = await this.client.get<OneMapGeocodeResponse>('/common/elastic/revgeocode', {
        params: { location: `${lat},${lng}` },
        headers: {
          Authorization: this.token,
        },
      });

      return response.data.results[0]?.ADDRESS || null;
    } catch (error) {
      logger.error({ error, lat, lng }, 'OneMap reverse geocoding failed');
      return null;
    }
  }

  async getRoute(
      startLat: number,
      startLng: number,
      endLat: number,
      endLng: number,
      mode: 'drive' | 'pt' | 'walk' | 'cycle' = 'drive'
    ): Promise<{
      distance: number;
      duration: number;
      geometry: string;
      instructions: Array<{ instruction: string; roadName: string; distance: number; duration: number; point: { lat: number; lng: number } }>;
    }> {
      await this.getToken();

      // Map mode to OneMap routeType
      const routeTypeMap: Record<string, string> = {
        drive: 'drive',
        pt: 'pt',
        walk: 'walk',
        cycle: 'cycle',
      };

      const maxRetries = 3;
      let lastError: Error | null = null;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          // OneMap routing endpoint: /api/public/routingsvc/route with raw token in Authorization header
          const response = await this.client.get<OneMapRoutingResponse>('/public/routingsvc/route', {
            params: {
              start: `${startLat},${startLng}`,
              end: `${endLat},${endLng}`,
              routeType: routeTypeMap[mode] || 'drive',
            },
            headers: {
              Authorization: this.token // Raw token, no "Bearer " prefix
            },
          });

          return {
            distance: response.data.route_summary.total_distance,
            duration: response.data.route_summary.total_time,
            geometry: response.data.route_geometry,
            instructions: response.data.route_instructions.map((instr: any[]) => ({
              instruction: instr[9] || `${instr[0]} ${instr[1]}`, // Full instruction text or fallback
              roadName: instr[1] || '', // Road name from OneMap
              distance: instr[2] || 0, // Distance in meters
              duration: instr[4] || 0, // Duration in seconds
              point: (() => {
                const coords = instr[3]?.split(',').map(Number) || [0, 0];
                return { lat: coords[0], lng: coords[1] };
              })(),
            })),
          };
        } catch (error: any) {
          lastError = error;
          const status = error.response?.status;

          // Handle OneMap rate limit (429) with exponential backoff
          if (status === 429 && attempt < maxRetries) {
            const retryAfter = error.response?.headers?.['retry-after'] 
              ? parseInt(error.response.headers['retry-after']) * 1000 
              : Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
          
            logger.warn({ attempt, retryAfter }, 'OneMap rate limited, retrying...');
            await new Promise(resolve => setTimeout(resolve, retryAfter));
            continue;
          }

          // For other errors or final attempt, throw
          logger.error({ error, attempt }, 'OneMap routing failed');
          throw AppError.serviceUnavailable('Routing service unavailable');
        }
      }

      // Should not reach here, but TypeScript needs it
      throw lastError || AppError.serviceUnavailable('Routing service unavailable');
    }
}

export const oneMapService = new OneMapService();