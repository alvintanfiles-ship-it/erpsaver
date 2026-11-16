import { db } from '../db/client.js';
import { logger } from '../utils/logger.js';
import { cache } from '../cache/redis.js';
import { uraService } from './uraService.js';
import { AppError } from '../middleware/errorHandler.js';

interface NearbyCarpark {
  id: string;
  carparkCode: string;
  name: string;
  provider: 'HDB' | 'URA' | 'MALL';
  address: string;
  distanceMeters: number;
  totalLots: number;
  availableLots: number;
  status: 'AVAILABLE' | 'FILLING_UP' | 'CRITICAL' | 'UNKNOWN';
  rateScheduleId: string | null;
  operatingHours: Record<string, string> | null;
}

interface CarparkDetail extends NearbyCarpark {
  lotTypeBreakdown: Record<string, number>;
  rates: Record<string, unknown>;
  entranceLocation: { lat: number; lng: number } | null;
  isOpen: boolean;
}

class ParkingService {
  // Find nearby carparks using PostGIS spatial query
  async findNearby(
    latitude: number,
    longitude: number,
    radiusMeters: number = 1000,
    providers?: ('HDB' | 'URA' | 'MALL')[],
    minLots: number = 0
  ): Promise<NearbyCarpark[]> {
    const cacheKey = `parking:nearby:${latitude.toFixed(4)},${longitude.toFixed(4)}:${radiusMeters}:${providers?.join(',') || 'all'}:${minLots}`;
    const cached = await cache.get<NearbyCarpark[]>(cacheKey);
    if (cached) return cached;

    try {
      const providerArray = providers ? `{${providers.join(',')}}` : null;

      const result = await db.query(
        `SELECT * FROM find_nearby_carparks($1, $2, $3, $4, $5)`,
        [latitude, longitude, radiusMeters, providerArray, minLots]
      );

      const carparks: NearbyCarpark[] = result.rows.map(r => ({
        id: r.id,
        carparkCode: r.carpark_code,
        name: r.name,
        provider: r.provider,
        address: r.address,
        distanceMeters: parseFloat(r.distance_meters),
        totalLots: r.total_lots,
        availableLots: r.available_lots,
        status: r.status,
        rateScheduleId: r.rate_schedule_id,
        operatingHours: r.operating_hours,
      }));

      // Cache for 60 seconds per spec
      await cache.set(cacheKey, carparks, 60);
      return carparks;
    } catch (error) {
      logger.error({ error }, 'Find nearby carparks failed');
      throw AppError.internal('Failed to find nearby parking');
    }
  }

  // Get detailed carpark information
  async getCarparkDetail(carparkId: string): Promise<CarparkDetail | null> {
    const cacheKey = `parking:detail:${carparkId}`;
    const cached = await cache.get<CarparkDetail>(cacheKey);
    if (cached) return cached;

    try {
      const result = await db.query(
        `SELECT c.*, ca.available_lots, ca.lot_type_breakdown, ca.status, ca.last_updated,
                rs.rate_json
         FROM carparks c
         LEFT JOIN carpark_availability ca ON ca.carpark_id = c.id
         LEFT JOIN rate_schedules rs ON rs.id = c.rate_schedule_id
         WHERE c.id = $1`,
        [carparkId]
      );

      if (result.rows.length === 0) return null;

      const row = result.rows[0];

      // Check if currently open
      const isOpen = this.checkIfOpen(row.operating_hours);

      const detail: CarparkDetail = {
        id: row.id,
        carparkCode: row.carpark_code,
        name: row.name,
        provider: row.provider,
        address: row.address,
        distanceMeters: 0, // Not applicable for detail view
        totalLots: row.total_lots,
        availableLots: row.available_lots || 0,
        status: row.status || 'UNKNOWN',
        rateScheduleId: row.rate_schedule_id,
        operatingHours: row.operating_hours,
        lotTypeBreakdown: row.lot_type_breakdown || {},
        rates: row.rate_json || {},
        entranceLocation: row.entrance_location ? {
          lat: parseFloat(ST_Y(row.entrance_location)),
          lng: parseFloat(ST_X(row.entrance_location)),
        } : null,
        isOpen,
      };

      await cache.set(cacheKey, detail, 60);
      return detail;
    } catch (error) {
      logger.error({ error, carparkId }, 'Get carpark detail failed');
      throw AppError.internal('Failed to get parking details');
    }
  }

  // Get carpark by code (for direct lookup)
  async getCarparkByCode(code: string): Promise<CarparkDetail | null> {
    const result = await db.query(
      `SELECT c.*, ca.available_lots, ca.lot_type_breakdown, ca.status, ca.last_updated,
              rs.rate_json
       FROM carparks c
       LEFT JOIN carpark_availability ca ON ca.carpark_id = c.id
       LEFT JOIN rate_schedules rs ON rs.id = c.rate_schedule_id
       WHERE c.carpark_code = $1`,
      [code]
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    const isOpen = this.checkIfOpen(row.operating_hours);

    return {
      id: row.id,
      carparkCode: row.carpark_code,
      name: row.name,
      provider: row.provider,
      address: row.address,
      distanceMeters: 0,
      totalLots: row.total_lots,
      availableLots: row.available_lots || 0,
      status: row.status || 'UNKNOWN',
      rateScheduleId: row.rate_schedule_id,
      operatingHours: row.operating_hours,
      lotTypeBreakdown: row.lot_type_breakdown || {},
      rates: row.rate_json || {},
      entranceLocation: row.entrance_location ? {
        lat: parseFloat(ST_Y(row.entrance_location)),
        lng: parseFloat(ST_X(row.entrance_location)),
      } : null,
      isOpen,
    };
  }

  // Update live availability from URA (called by background job)
  async refreshLiveAvailability(): Promise<void> {
    await uraService.updateLiveAvailability();
  }

  // Sync static carpark data from URA (called periodically)
  async syncCarparkData(): Promise<void> {
    await uraService.syncToDatabase();
  }

  // Get status color for UI
  getStatusColor(status: string): string {
    switch (status) {
      case 'AVAILABLE': return '#2ECC71'; // Emerald Green
      case 'FILLING_UP': return '#F1C40F'; // Amber Gold
      case 'CRITICAL': return '#E74C3C'; // Crimson Red
      default: return '#95A5A6'; // Gray for unknown
    }
  }

  // Get status label for UI
  getStatusLabel(status: string): string {
    switch (status) {
      case 'AVAILABLE': return 'Available';
      case 'FILLING_UP': return 'Filling Up';
      case 'CRITICAL': return 'Critical / Full';
      default: return 'Unknown';
    }
  }

  private checkIfOpen(operatingHours: Record<string, string> | null): boolean {
    if (!operatingHours) return true; // Assume open if unknown

    const now = new Date();
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayKey = dayNames[now.getDay()];
    const hours = operatingHours[dayKey] || operatingHours.weekday;

    if (!hours) return true;

    const [openStr, closeStr] = hours.split('-');
    if (!openStr || !closeStr) return true;

    const [openH, openM] = openStr.split(':').map(Number);
    const [closeH, closeM] = closeStr.split(':').map(Number);

    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const openMinutes = openH * 60 + openM;
    const closeMinutes = closeH * 60 + closeM;

    // Handle overnight parking (e.g., 22:00 - 07:00)
    if (closeMinutes < openMinutes) {
      return currentMinutes >= openMinutes || currentMinutes < closeMinutes;
    }

    return currentMinutes >= openMinutes && currentMinutes < closeMinutes;
  }
}

// Helper to extract Y coordinate from PostGIS geometry
function ST_Y(geom: unknown): string {
  return '0'; // Placeholder - actual implementation would parse WKB/WKT
}

function ST_X(geom: unknown): string {
  return '0'; // Placeholder
}

export const parkingService = new ParkingService();