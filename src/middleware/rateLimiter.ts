import { Request, Response, NextFunction } from 'express';
import { redis } from '../cache/redis.js';

const WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS = 100; // per window

export const rateLimiter = async (req: Request, res: Response, next: NextFunction) => {
  const key = `ratelimit:${req.ip}:${req.path}`;
  try {
    const current = await redis.incr(key);
    if (current === 1) {
      await redis.pexpire(key, WINDOW_MS);
    }

    const ttl = await redis.pttl(key);
    const remaining = Math.max(0, MAX_REQUESTS - current);
    const resetTime = Math.ceil((Date.now() + ttl) / 1000);

    res.setHeader('X-RateLimit-Limit', MAX_REQUESTS);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', resetTime);

    if (current > MAX_REQUESTS) {
      res.setHeader('Retry-After', Math.ceil(ttl / 1000));
      return res.status(429).json({
        error: 'Too Many Requests',
        code: 'RATE_LIMIT_EXCEEDED',
        message: `Rate limit exceeded. Try again in ${Math.ceil(ttl / 1000)}s`,
      });
    }

    next();
  } catch (error) {
    next(error);
  }
};

// Stricter limiter for parking check endpoint
export const parkingRateLimiter = async (req: Request, res: Response, next: NextFunction) => {
  const key = `ratelimit:parking:${req.ip}`;
  try {
    const current = await redis.incr(key);
    if (current === 1) {
      await redis.pexpire(key, 60 * 1000); // 1 minute
    }

    const ttl = await redis.pttl(key);

    // Allow max 10 parking checks per minute per IP
    if (current > 10) {
      res.setHeader('Retry-After', Math.ceil(ttl / 1000));
      return res.status(429).json({
        error: 'Too Many Requests',
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many parking requests. Please wait.',
      });
    }

    next();
  } catch (error) {
    next(error);
  }
};