import axios, { AxiosInstance } from 'axios';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { cache } from '../cache/redis.js';
import { AppError } from '../middleware/errorHandler.js';

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

  // Sync to database - only syncs live data (traffic, carparks)
  // ERP data is handled by separate syncErpStatic.ts script
  async syncToDatabase(): Promise<void> {
    logger.info('LTA sync: ERP data is static (seeded via syncErpStatic.ts). Skipping ERP sync.');
    // Could sync traffic/carpark data here if needed for caching
  }
}

export const ltaService = new LTADataMallService();