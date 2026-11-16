import { Router, Response } from 'express';
import { db } from '../db/client.js';
import { redis } from '../cache/redis.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';

export const healthRouter = Router();

// Basic health check
healthRouter.get('/', asyncHandler(async (_req, res: Response) => {
  res.json({
    status: 'ok',
    service: 'parkerp-api',
    timestamp: new Date().toISOString(),
  });
}));

// Detailed health check with dependencies
healthRouter.get('/detailed', asyncHandler(async (_req, res: Response) => {
  const [dbHealthy, redisHealthy] = await Promise.all([
    db.query('SELECT 1').then(() => true).catch(() => false),
    redis.ping().then(() => true).catch(() => false),
  ]);

  const status = dbHealthy && redisHealthy ? 'healthy' : 'degraded';

  res.status(status === 'healthy' ? 200 : 503).json({
    status,
    service: 'parkerp-api',
    timestamp: new Date().toISOString(),
    dependencies: {
      database: dbHealthy ? 'up' : 'down',
      redis: redisHealthy ? 'up' : 'down',
    },
  });
}));

// Readiness probe for Kubernetes
healthRouter.get('/ready', asyncHandler(async (_req, res: Response) => {
  const dbHealthy = await db.query('SELECT 1').then(() => true).catch(() => false);
  const redisHealthy = await redis.ping().then(() => true).catch(() => false);

  if (dbHealthy && redisHealthy) {
    res.json({ ready: true });
  } else {
    res.status(503).json({ ready: false, database: dbHealthy, redis: redisHealthy });
  }
}));

// Liveness probe
healthRouter.get('/live', (_req, res: Response) => {
  res.json({ alive: true });
});