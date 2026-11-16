import axios, { AxiosInstance } from 'axios';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { cache } from '../cache/redis.js';
import { AppError } from '../middleware/errorHandler.js';
import { db } from '../db/client.js';

interface URAResponse<T> {
  Status: string;
  Message: string;
  Result: T;
}

interface URATokenResponse {
  Status: string;
  Message: string;
  Result: string;
}

interface URACarparkDetailsResponse {
  Status: string;
  Message: string;
  Result: Array<{
    ppCode: string;
    ppName: string;
    vehCat: string;
    parkingSystem: string;
    weekdayMin: string;
    weekdayRate: string;
    satdayMin: string;
    satdayRate: string;
    sunPHMin: string;
    sunPHRate: string;
    geometries: Array<{ coordinates: string }>;
    startTime: string;
    parkCapacity: number;
    endTime: string;
  }>;
}

interface URACarparkAvailabilityResponse {
  Status: string;
  Message: string;
  Result: Array<{
    carparkNo: string;
    lotsAvailable: string;
    lotType: string;
    geometries: Array<{ coordinates: string }>;
  }>;
}

interface CarparkData {
  carparkCode: string;
  name: string;
  provider: 'HDB' | 'URA' | 'MALL';
  latitude: number;
  longitude: number;
  totalLots: number;
  availableLots: number;
  lotType: string;
  agency: string;
  development: string;
  location: string;
  parkingSystem: string;
  rateBands: Array<{
    startTime: string;
    endTime: string;
    weekdayMin: string;
    weekdayRate: string;
    satdayMin: string;
    satdayRate: string;
    sunPHMin: string;
    sunPHRate: string;
  }>;
}

class URASpaceService {
  private client: AxiosInstance;
  private token: string | null = null;
  private tokenDate: string | null = null;

  constructor() {
    this.client = axios.create({
      baseURL: 'https://eservice.ura.gov.sg/uraDataService',
      timeout: 60000, // Increased global timeout to 60s for heavy master data
      headers: {
        'AccessKey': env.URA_ACCESS_KEY || '',
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
  }

  private getTodayDate(): string {
    return new Date().toISOString().split('T')[0];
  }

  private async getToken(): Promise<string> {
    const today = this.getTodayDate();

    if (this.token && this.tokenDate === today) {
      return this.token;
    }

    if (!env.URA_ACCESS_KEY) {
      throw AppError.internal('URA Space AccessKey not configured');
    }

    try {
      const response = await this.client.get<URATokenResponse>('/insertNewToken/v1');

      if (response.data.Status !== 'Success') {
        throw new Error(`Token request failed: ${response.data.Message}`);
      }

      this.token = response.data.Result;
      this.tokenDate = today;

      logger.debug('URA Space token refreshed');
      return this.token;
    } catch (error) {
      logger.error({ error }, 'URA Space token refresh failed');
      throw AppError.serviceUnavailable('Parking data service unavailable');
    }
  }

  private async makeRequest<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
    const token = await this.getToken();

    const response = await this.client.get<URAResponse<T>>(endpoint, {
      params,
      headers: { 'Token': token },
    });

    if (response.data.Status !== 'Success') {
      throw new Error(`URA API error: ${response.data.Message}`);
    }

    return response.data.Result;
  }

  async fetchCarparks(): Promise<CarparkData[]> {
    const cacheKey = 'ura:carparks';
    const cached = await cache.get<CarparkData[]>(cacheKey);
    if (cached) return cached;

    try {
      const result = await this.makeRequest<URACarparkDetailsResponse['Result']>(
        '/invokeUraDS/v1',
        { service: 'Car_Park_Details' }
      );

      const mappedResult = this.mapCarpark(result);

      await cache.set(cacheKey, mappedResult, 3600);
      return mappedResult;
    } catch (error: any) {
      logger.error({ 
        message: error.message,
        status: error.response?.status,
        data: error.response?.data,
        stack: error.stack
      }, 'URA Space carparks fetch failed');
      throw AppError.serviceUnavailable('Parking data service unavailable');
    }
  }

  async fetchAvailability(): Promise<Array<{
    carparkCode: string;
    availableLots: number;
    lotType: string;
  }>> {
    const cacheKey = 'ura:availability';
    const cached = await cache.get<CarparkData[]>(cacheKey);
    if (cached) return cached.map(c => ({
      carparkCode: c.carparkCode,
      availableLots: c.availableLots,
      lotType: c.lotType,
    }));

    try {
      const data = await this.makeRequest<URACarparkAvailabilityResponse>(
        '/invokeUraDS/v1',
        { service: 'Car_Park_Availability' }
      );

      const result = data.Result.map(a => ({
        carparkCode: a.carparkNo,
        availableLots: parseInt(a.lotsAvailable, 10) || 0,
        lotType: a.lotType,
      }));

      await cache.set(cacheKey, result, 60);
      return result;
    } catch (error) {
      logger.error({ error }, 'URA Space availability fetch failed');
      throw AppError.serviceUnavailable('Live parking data unavailable');
    }
  }

  private mapCarpark(entries: URACarparkDetailsResponse['Result']): CarparkData[] {
    // Group by carparkCode + vehCat
    const grouped = new Map<string, typeof entries[0][]>();
    for (const entry of entries) {
      const key = `${entry.ppCode}|${entry.vehCat}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(entry);
    }

    const result: CarparkData[] = [];

    for (const [key, group] of grouped) {
      const first = group[0];
      let latitude = 1.3521;
      let longitude = 103.8198;
      if (first.geometries?.[0]?.coordinates) {
        const [x, y] = first.geometries[0].coordinates.split(',').map(s => parseFloat(s.trim()));
        if (!isNaN(x) && !isNaN(y)) {
          const wgs = this.svy21ToWgs84(x, y);
          latitude = wgs.lat;
          longitude = wgs.lng;
        }
      }

      // Sort by startTime
      group.sort((a, b) => a.startTime.localeCompare(b.startTime));

      result.push({
        carparkCode: first.ppCode,
        name: first.ppName,
        provider: 'URA',
        latitude,
        longitude,
        totalLots: first.parkCapacity || 0,
        availableLots: 0,
        lotType: first.vehCat === 'Car' ? 'C' : first.vehCat === 'Motorcycle' ? 'M' : 'H',
        agency: 'URA',
        development: first.ppName,
        location: first.ppName,
        parkingSystem: first.parkingSystem,
        rateBands: group.map(g => ({
          startTime: g.startTime,
          endTime: g.endTime,
          weekdayMin: g.weekdayMin,
          weekdayRate: g.weekdayRate,
          satdayMin: g.satdayMin,
          satdayRate: g.satdayRate,
          sunPHMin: g.sunPHMin,
          sunPHRate: g.sunPHRate,
        })),
      });
    }

    return result;
  }

  private svy21ToWgs84(x: number, y: number): { lat: number; lng: number } {
    const originX = 28001.642;
    const originY = 38744.572;
    const originLat = 1.366666;
    const originLng = 103.83333;

    const lat = originLat + (y - originY) * 0.00000899;
    const lng = originLng + (x - originX) * 0.00000997;

    return { lat, lng };
  }

  async syncToDatabase(): Promise<void> {
    const client = await db.connect();
    try {
      await client.query('BEGIN');

      const carparks = await this.fetchCarparks();
      let synced = 0;

      for (const c of carparks) {
        const rateJson = this.parseRates(c);

        const rateScheduleResult = await client.query(
          `INSERT INTO rate_schedules (name, rate_json, effective_from)
           VALUES ($1, $2, CURRENT_DATE)
           ON CONFLICT DO NOTHING
           RETURNING id`,
          [`${c.carparkCode}_schedule`, JSON.stringify(rateJson)]
        );

        let rateScheduleId: string | null = null;
        if (rateScheduleResult.rows.length > 0) {
          rateScheduleId = rateScheduleResult.rows[0].id;
        } else {
          const existing = await client.query(
            'SELECT id FROM rate_schedules WHERE name = $1',
            [`${c.carparkCode}_schedule`]
          );
          if (existing.rows.length > 0) rateScheduleId = existing.rows[0].id;
        }

        await client.query(
          `INSERT INTO carparks (
            carpark_code, name, provider, address, location, entrance_location,
            total_lots, lot_types, operating_hours, rate_schedule_id, is_active
          ) VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326),
                    ST_SetSRID(ST_MakePoint($5, $6), 4326), $7, $8, $9, $10, true)
          ON CONFLICT (carpark_code) DO UPDATE SET
            name = EXCLUDED.name,
            provider = EXCLUDED.provider,
            address = EXCLUDED.address,
            location = EXCLUDED.location,
            entrance_location = EXCLUDED.entrance_location,
            total_lots = EXCLUDED.total_lots,
            lot_types = EXCLUDED.lot_types,
            operating_hours = EXCLUDED.operating_hours,
            rate_schedule_id = EXCLUDED.rate_schedule_id,
            is_active = EXCLUDED.is_active,
            updated_at = NOW()`,
          [
            c.carparkCode,
            c.name,
            c.provider,
            c.location,
            c.longitude,
            c.latitude,
            c.totalLots,
            JSON.stringify({ [c.lotType]: c.totalLots }),
            this.parseOperatingHours(c),
            rateScheduleId,
          ]
        );

        synced++;
      }

      await client.query('COMMIT');
      logger.info({ synced }, 'URA carparks synced to database');
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error({ error }, 'URA database sync failed');
      throw error;
    } finally {
      client.release();
    }
  }

  async updateLiveAvailability(): Promise<void> {
    const client = await db.connect();
    try {
      const availability = await this.fetchAvailability();

      for (const a of availability) {
        await client.query(
          `INSERT INTO carpark_availability (carpark_id, available_lots, lot_type_breakdown, last_updated, source)
           SELECT id, $2, $3, NOW(), 'URA'
           FROM carparks WHERE carpark_code = $1
           ON CONFLICT (carpark_id) DO UPDATE SET
             available_lots = EXCLUDED.available_lots,
             lot_type_breakdown = EXCLUDED.lot_type_breakdown,
             last_updated = EXCLUDED.last_updated,
             source = EXCLUDED.source`,
          [a.carparkCode, a.availableLots, JSON.stringify({ [a.lotType]: a.availableLots })]
        );
      }

      logger.debug({ updated: availability.length }, 'Live availability updated');
    } catch (error) {
      logger.error({ error }, 'Live availability update failed');
    } finally {
      client.release();
    }
  }

  private parseRates(carpark: CarparkData): Record<string, unknown> {
    const parseRateText = (text: string): number => {
      const match = text.match(/\$?(\d+\.?\d*)/);
      return match ? parseFloat(match[1]) : 0;
    };

    // Find the main daytime rate band (e.g., 08:30 AM - 05:00 PM)
    const dayBand = carpark.rateBands.find(b =>
      b.startTime.includes('AM') && b.endTime.includes('PM')
    ) || carpark.rateBands[0];

    const weekdayRate = parseRateText(dayBand?.weekdayRate || '0');
    const satdayRate = parseRateText(dayBand?.satdayRate || '0');
    const sunPHRate = parseRateText(dayBand?.sunPHRate || '0');

    return {
      base_rate: {
        weekday: weekdayRate,
        saturday: satdayRate,
        sunday: sunPHRate,
      },
      per_half_hour: {
        weekday: weekdayRate / 2,
        saturday: satdayRate / 2,
        sunday: sunPHRate / 2,
      },
      evening_rate: parseRateText(
        carpark.rateBands.find(b => b.startTime.includes('PM') && b.endTime.includes('PM'))?.weekdayRate || '0'
      ),
      grace_period_minutes: 10,
      rate_bands: carpark.rateBands,
    };
  }

  private parseOperatingHours(carpark: CarparkData): Record<string, string> {
    if (carpark.rateBands.length === 0) {
      return {
        weekday: '07:00-23:00',
        saturday: '07:00-23:00',
        sunday: '08:00-22:00',
      };
    }

    const first = carpark.rateBands[0];
    const last = carpark.rateBands[carpark.rateBands.length - 1];

    const formatTime = (time: string) => {
      // Convert "07.00 AM" to "07:00"
      return time.replace('.', ':').replace(' AM', '').replace(' PM', '');
    };

    const openTime = formatTime(first.startTime);
    const closeTime = formatTime(last.endTime);

    // Determine if 24h or has overnight closure
    const hasOvernightBreak = carpark.rateBands.some(b =>
      b.weekdayRate === '$0.00' && b.startTime.includes('PM')
    );

    return {
      weekday: hasOvernightBreak ? `${openTime}-${closeTime}` : '07:00-23:00',
      saturday: hasOvernightBreak ? `${openTime}-${closeTime}` : '07:00-23:00',
      sunday: hasOvernightBreak ? `${openTime}-${closeTime}` : '08:00-22:00',
    };
  }
}

export const uraService = new URASpaceService();