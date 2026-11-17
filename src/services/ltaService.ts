import axios, { AxiosInstance } from 'axios';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { cache } from '../cache/redis.js';
import { AppError } from '../middleware/errorHandler.js';
import { db } from '../db/client.js';

interface LTATrafficSpeedResponse {
  value: Array<{
    LinkID: string;
    RoadName: string;
    SpeedBand: number; // 1-4
    MinimumSpeed: number;
    MaximumSpeed: number;
    Location: string;
    Direction: string;
  }>;
}

interface LTACarParkResponse {
  value: Array<{
    CarParkID: string;
    Development: string;
    Location: string;
    AvailableLots: number;
    LotType: string;
    Agency: string;
  }>;
}

class LTADataMallService {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: env.LTA_DATAMALL_URL,
      timeout: 10000,
      headers: {
        'AccountKey': env.LTA_API_KEY || '',
        'accept': 'application/json',
      },
    });
  }

  // Traffic speeds - still works
  async fetchTrafficSpeeds(): Promise<Array<{
    linkId: string;
    roadName: string;
    speedBand: number;
    minSpeed: number;
    maxSpeed: number;
    location: string;
    direction: string;
  }>> {
    type TrafficResult = {
      linkId: string;
      roadName: string;
      speedBand: number;
      minSpeed: number;
      maxSpeed: number;
      location: string;
      direction: string;
    };
    const cacheKey = 'lta:traffic';
    const cached = await cache.get<TrafficResult[]>(cacheKey);
    if (cached) return cached;

    try {
      const response = await this.client.get<LTATrafficSpeedResponse>('/TrafficSpeedBands');

      const speeds = response.data.value.map(s => ({
        linkId: s.LinkID,
        roadName: s.RoadName,
        speedBand: s.SpeedBand,
        minSpeed: s.MinimumSpeed,
        maxSpeed: s.MaximumSpeed,
        location: s.Location,
        direction: s.Direction,
      }));

      await cache.set(cacheKey, speeds, 300); // 5 minutes
      return speeds;
    } catch (error) {
      logger.error({ error }, 'LTA DataMall traffic speeds fetch failed');
      throw AppError.serviceUnavailable('Traffic data service unavailable');
    }
  }

  // Car park availability - still works
  async fetchCarParkAvailability(): Promise<Array<{
    carParkId: string;
    development: string;
    location: string;
    availableLots: number;
    lotType: string;
    agency: string;
  }>> {
    type CarParkResult = {
      carParkId: string;
      development: string;
      location: string;
      availableLots: number;
      lotType: string;
      agency: string;
    };
    const cacheKey = 'lta:carpark_availability';
    const cached = await cache.get<CarParkResult[]>(cacheKey);
    if (cached) return cached;

    try {
      const response = await this.client.get<LTACarParkResponse>('/CarParkAvailabilityv2');

      const carparks = response.data.value.map(c => ({
        carParkId: c.CarParkID,
        development: c.Development,
        location: c.Location,
        availableLots: c.AvailableLots,
        lotType: c.LotType,
        agency: c.Agency,
      }));

      await cache.set(cacheKey, carparks, 60); // 1 minute (per spec)
      return carparks;
    } catch (error) {
      logger.error({ error }, 'LTA DataMall car park availability fetch failed');
      throw AppError.serviceUnavailable('Car park availability service unavailable');
    }
  }

  // ERP gantries/rates are now static - no live API available (removed 30 Sep 2024)
  // Data is seeded from static datasets via syncErpStatic.ts
  async fetchGantries(): Promise<never[]> {
    logger.warn('LTA ERP Gantries API removed (30 Sep 2024). Using static seeded data.');
    return [];
  }

  async fetchRates(): Promise<never[]> {
    logger.warn('LTA ERP Rates API removed (30 Sep 2024). Using static seeded data.');
    return [];
  }

  // Sync LTA carparks and their live availability into the nearby-parking catalog.
  // ERP data is handled by the separate static-data import.
  async syncToDatabase(): Promise<void> {
    const records = await this.fetchCarParkAvailability();
    const grouped = new Map<string, {
      carParkId: string;
      development: string;
      location: string;
      agency: string;
      availableLots: number;
      lotTypeBreakdown: Record<string, number>;
    }>();

    for (const record of records) {
      const existing = grouped.get(record.carParkId);
      if (existing) {
        existing.availableLots += record.availableLots;
        existing.lotTypeBreakdown[record.lotType] =
          (existing.lotTypeBreakdown[record.lotType] || 0) + record.availableLots;
      } else {
        grouped.set(record.carParkId, {
          ...record,
          lotTypeBreakdown: { [record.lotType]: record.availableLots },
        });
      }
    }

    const client = await db.connect();
    let synced = 0;
    let skipped = 0;
    try {
      await client.query('BEGIN');

      for (const carpark of grouped.values()) {
        const coordinates = this.parseCoordinates(carpark.location);
        if (!coordinates) {
          skipped++;
          continue;
        }

        const provider = this.toProvider(carpark.agency);
        await client.query(
          `INSERT INTO carparks (
             carpark_code, name, provider, address, location, entrance_location,
             total_lots, lot_types, operating_hours, is_active
           ) VALUES (
             $1, $2, $3::carpark_provider, $4,
             ST_SetSRID(ST_MakePoint($5, $6), 4326),
             ST_SetSRID(ST_MakePoint($5, $6), 4326),
             0, '{}'::jsonb, NULL, true
           )
           ON CONFLICT (carpark_code) DO UPDATE SET
             name = EXCLUDED.name,
             provider = EXCLUDED.provider,
             address = EXCLUDED.address,
             location = EXCLUDED.location,
             entrance_location = EXCLUDED.entrance_location,
             is_active = true,
             updated_at = NOW()`,
          [
            carpark.carParkId,
            carpark.development || carpark.carParkId,
            provider,
            carpark.development || null,
            coordinates.lng,
            coordinates.lat,
          ]
        );

        await client.query(
          `INSERT INTO carpark_availability (
             carpark_id, available_lots, lot_type_breakdown, last_updated, source
           )
           SELECT id, $2, $3, NOW(), 'LTA'
           FROM carparks WHERE carpark_code = $1
           ON CONFLICT (carpark_id) DO UPDATE SET
             available_lots = EXCLUDED.available_lots,
             lot_type_breakdown = EXCLUDED.lot_type_breakdown,
             last_updated = EXCLUDED.last_updated,
             source = EXCLUDED.source`,
          [carpark.carParkId, carpark.availableLots, JSON.stringify(carpark.lotTypeBreakdown)]
        );
        synced++;
      }

      await client.query('COMMIT');
      await cache.delPattern('parking:nearby:*');
      logger.info({ synced, skipped }, 'LTA carparks and availability synced to database');
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error({ error }, 'LTA database sync failed');
      throw error;
    } finally {
      client.release();
    }
  }

  private parseCoordinates(location: string): { lat: number; lng: number } | null {
    const values = location.match(/-?\d+(?:\.\d+)?/g)?.map(Number) || [];
    if (values.length < 2) return null;

    const [lat, lng] = values;
    return lat >= 1 && lat <= 2 && lng >= 103 && lng <= 105 ? { lat, lng } : null;
  }

  private toProvider(agency: string): 'HDB' | 'URA' | 'LTA' {
    if (agency === 'HDB' || agency === 'URA') return agency;
    return 'LTA';
  }
}

export const ltaService = new LTADataMallService();
