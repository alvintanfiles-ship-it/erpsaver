import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy: (times: number) => {
    if (times > 3) {
      logger.error('Redis max retries reached');
      return null;
    }
    return Math.min(times * 200, 2000);
  },
  lazyConnect: true,
});

redis.on('connect', () => {
  logger.debug('Redis connected');
});

redis.on('error', (err: Error) => {
  logger.error({ err }, 'Redis error');
});

redis.on('close', () => {
  logger.warn('Redis connection closed');
});

// Initialize connection
export async function initRedis(): Promise<void> {
  await redis.connect();
}

// Cache helpers
export const cache = {
  async get<T>(key: string): Promise<T | null> {
    try {
      const data = await redis.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      logger.error({ error, key }, 'Cache get error');
      return null;
    }
  },

  async set(key: string, value: unknown, ttlSeconds: number = env.REDIS_TTL_SECONDS): Promise<void> {
    try {
      await redis.setex(key, ttlSeconds, JSON.stringify(value));
    } catch (error) {
      logger.error({ error, key }, 'Cache set error');
    }
  },

  async del(key: string): Promise<void> {
    try {
      await redis.del(key);
    } catch (error) {
      logger.error({ error, key }, 'Cache del error');
    }
  },

  async delPattern(pattern: string): Promise<void> {
    try {
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } catch (error) {
      logger.error({ error, pattern }, 'Cache delPattern error');
    }
  },

  // Coalesce duplicate requests - returns cached value or executes fn once
  async coalesce<T>(
    key: string,
    fn: () => Promise<T>,
    ttlSeconds: number = env.REDIS_TTL_SECONDS
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;

    // Use SETNX for distributed locking
    const lockKey = `lock:${key}`;
    const lockAcquired = await redis.set(lockKey, '1', 'EX', 10, 'NX');

    if (lockAcquired) {
      try {
        const result = await fn();
        await this.set(key, result, ttlSeconds);
        return result;
      } finally {
        await redis.del(lockKey);
      }
    } else {
      // Wait for the other request to complete
      for (let i = 0; i < 50; i++) {
        await new Promise(resolve => setTimeout(resolve, 100));
        const cached = await this.get<T>(key);
        if (cached !== null) return cached;
      }
      // Fallback: execute anyway
      return fn();
    }
  },
};

export const checkRedisHealth = async (): Promise<boolean> => {
  try {
    await redis.ping();
    return true;
  } catch {
    return false;
  }
};