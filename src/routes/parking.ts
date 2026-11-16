import { Router, Response } from 'express';
import { z } from 'zod';
import { parkingService } from '../services/parkingService.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { parkingRateLimiter } from '../middleware/rateLimiter.js';

export const parkingRouter = Router();

// Find nearby carparks (Flow A: "Check Nearby Parking" button)
parkingRouter.post('/nearby', parkingRateLimiter, asyncHandler(async (req, res: Response) => {
  const schema = z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    radius: z.number().int().min(100).max(5000).default(1000),
    providers: z.array(z.enum(['HDB', 'URA', 'MALL'])).optional(),
    minLots: z.number().int().min(0).default(0),
  });

  const { lat, lng, radius, providers, minLots } = schema.parse(req.body);

  const carparks = await parkingService.findNearby(lat, lng, radius, providers, minLots);

  // Add status colors and labels for UI
  const results = carparks.map(cp => ({
    ...cp,
    statusColor: parkingService.getStatusColor(cp.status),
    statusLabel: parkingService.getStatusLabel(cp.status),
    distanceLabel: formatDistance(cp.distanceMeters),
  }));

  res.json({
    searchLocation: { lat, lng },
    radiusMeters: radius,
    count: results.length,
    carparks: results,
    timestamp: new Date().toISOString(),
  });
}));

// Get carpark detail by ID
parkingRouter.get('/:id', asyncHandler(async (req, res: Response) => {
  const { id } = req.params;

  const detail = await parkingService.getCarparkDetail(id);

  if (!detail) {
    throw AppError.notFound('Carpark not found');
  }

  res.json({
    ...detail,
    statusColor: parkingService.getStatusColor(detail.status),
    statusLabel: parkingService.getStatusLabel(detail.status),
  });
}));

// Get carpark by code (e.g., from QR code scan)
parkingRouter.get('/code/:code', asyncHandler(async (req, res: Response) => {
  const { code } = req.params;

  const detail = await parkingService.getCarparkByCode(code.toUpperCase());

  if (!detail) {
    throw AppError.notFound('Carpark not found');
  }

  res.json({
    ...detail,
    statusColor: parkingService.getStatusColor(detail.status),
    statusLabel: parkingService.getStatusLabel(detail.status),
  });
}));

// Search carparks by name/address
const searchSchema = z.object({
  q: z.string().min(1).max(100),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  radius: z.number().int().min(100).max(10000).default(5000),
});

parkingRouter.get('/search', asyncHandler(async (req, res: Response) => {
  const { q, lat, lng, radius } = searchSchema.parse(req.query);

  // If location provided, search nearby first then filter
  // Otherwise, do text search in DB
  let carparks;

  if (lat !== undefined && lng !== undefined) {
    const nearby = await parkingService.findNearby(lat, lng, radius);
    carparks = nearby.filter(cp =>
      cp.name.toLowerCase().includes(q.toLowerCase()) ||
      cp.address.toLowerCase().includes(q.toLowerCase())
    );
  } else {
    // Text search fallback
    const { db } = await import('../db/client.js');
    const result = await db.query(
      `SELECT * FROM carparks
       WHERE is_active = true
         AND (name ILIKE $1 OR address ILIKE $1)
       LIMIT 20`,
      [`%${q}%`]
    );
    carparks = result.rows.map(r => ({
      id: r.id,
      carparkCode: r.carpark_code,
      name: r.name,
      provider: r.provider,
      address: r.address,
      distanceMeters: 0,
      totalLots: r.total_lots,
      availableLots: 0,
      status: 'UNKNOWN' as const,
      rateScheduleId: r.rate_schedule_id,
      operatingHours: r.operating_hours,
    }));
  }

  res.json({
    query: q,
    count: carparks.length,
    carparks: carparks.map(cp => ({
      ...cp,
      statusColor: parkingService.getStatusColor(cp.status),
      statusLabel: parkingService.getStatusLabel(cp.status),
    })),
  });
}));

function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}