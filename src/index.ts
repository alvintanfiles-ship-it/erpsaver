import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pino from 'pino';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { errorHandler } from './middleware/errorHandler.js';
import { requestLogger } from './middleware/requestLogger.js';
import { rateLimiter } from './middleware/rateLimiter.js';
import { healthRouter } from './routes/health.js';
import { geocodingRouter } from './routes/geocoding.js';
import { routingRouter } from './routes/routing.js';
import { parkingRouter } from './routes/parking.js';
import { erpRouter } from './routes/erp.js';
import { carparkRouter } from './routes/carpark.js';
import { db } from './db/client.js';
import { migrate } from './db/migrate.js';
import { redis, initRedis } from './cache/redis.js';
import { seed } from './db/seed.js';

const app = express();
const PORT = env.PORT;

// Initialize Redis
await initRedis();

// Run database migrations FIRST
await migrate();

// Seed database on startup
await seed();

// Middleware
app.use(helmet({
  contentSecurityPolicy: false, // Allow inline scripts for development
}));
app.use(cors({
  origin: env.CORS_ORIGIN?.split(',') || ['http://localhost:3000', 'http://localhost:5173'],
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);
app.use(rateLimiter);

// Routes
app.use(`${env.API_PREFIX}/health`, healthRouter);
app.use(`${env.API_PREFIX}/geocoding`, geocodingRouter);
app.use(`${env.API_PREFIX}/routing`, routingRouter);
app.use(`${env.API_PREFIX}/parking`, parkingRouter);
app.use(`${env.API_PREFIX}/erp`, erpRouter);
app.use(`${env.API_PREFIX}/carparks`, carparkRouter);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Not Found', message: 'Route not found' });
});

// Error handler
app.use(errorHandler);

// Graceful shutdown
const shutdown = async (signal: string) => {
  logger.info({ signal }, 'Shutting down gracefully...');
  try {
    await db.end();
    await redis.quit();
    logger.info('Connections closed');
    process.exit(0);
  } catch (error) {
    logger.error({ error }, 'Error during shutdown');
    process.exit(1);
  }
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Start server
app.listen(PORT, () => {
  logger.info({ port: PORT, env: env.NODE_ENV }, 'ERPsaver API server started');
});

export { app };
