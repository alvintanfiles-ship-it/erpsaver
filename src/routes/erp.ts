import { Router, Response } from 'express';
import { z } from 'zod';
import { erpService } from '../services/erpService.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { db } from '../db/client.js';

export const erpRouter = Router();

// Get ERP cost for a route (by gantry IDs)
erpRouter.post('/cost', asyncHandler(async (req, res: Response) => {
  const schema = z.object({
    gantryIds: z.array(z.string().uuid()).min(1).max(50),
    departureTime: z.string().datetime().optional(),
  });

  const { gantryIds, departureTime } = schema.parse(req.body);
  const depTime = departureTime ? new Date(departureTime) : new Date();

  // Fetch gantry details from DB
  const gantryResult = await db.query(
    `SELECT id, gantry_code, name, 
            ST_Y(location::geometry) as lat, ST_X(location::geometry) as lng
     FROM erp_gantries
     WHERE id = ANY($1) AND is_active = true`,
    [gantryIds]
  );

  const gantries = gantryResult.rows.map(r => ({
    id: r.id,
    gantryCode: r.gantry_code,
    name: r.name,
    location: { lat: parseFloat(r.lat), lng: parseFloat(r.lng) },
    distFromStartM: 0, // Not available without route geometry
  }));

  const cost = await erpService.calculateRouteCost(gantries, depTime);

  res.json({
    ...cost,
    departureTime: cost.departureTime.toISOString(),
    savings: {
      ...cost.savings,
      offPeakTime: cost.savings.offPeakTime?.toISOString() || null,
    },
  });
}));

// Get departure windows for a route
erpRouter.post('/windows', asyncHandler(async (req, res: Response) => {
  const schema = z.object({
    gantryIds: z.array(z.string().uuid()).min(1).max(50),
    fromTime: z.string().datetime().optional(),
  });

  const { gantryIds, fromTime } = schema.parse(req.body);
  const startTime = fromTime ? new Date(fromTime) : new Date();

  // Fetch gantry details from DB
  const gantryResult = await db.query(
    `SELECT id, gantry_code, name, 
            ST_Y(location::geometry) as lat, ST_X(location::geometry) as lng
     FROM erp_gantries
     WHERE id = ANY($1) AND is_active = true`,
    [gantryIds]
  );

  const gantries = gantryResult.rows.map(r => ({
    id: r.id,
    gantryCode: r.gantry_code,
    name: r.name,
    location: { lat: parseFloat(r.lat), lng: parseFloat(r.lng) },
    distFromStartM: 0, // Not available without route geometry
  }));

  const windows = await erpService.getDepartureWindows(gantries, startTime);

  res.json({
    windows: windows.map(w => ({
      label: w.label,
      time: w.time.toISOString(),
      cost: w.cost,
      savings: w.savings,
    })),
    referenceTime: startTime.toISOString(),
  });
}));

// Get baseline ERP schedule for a gantry (fallback data)
erpRouter.get('/gantry/:id/schedule', asyncHandler(async (req, res: Response) => {
  const { id } = req.params;

  const schedule = await erpService.getBaselineSchedule(id);

  if (schedule.length === 0) {
    throw AppError.notFound('No ERP schedule found for gantry');
  }

  // Format for UI
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const formatted = schedule.map(s => ({
    day: dayNames[s.dayOfWeek],
    dayOfWeek: s.dayOfWeek,
    startTime: s.startTime,
    endTime: s.endTime,
    rate: s.rate,
    period: `${s.startTime} - ${s.endTime}`,
  }));

  res.json({
    gantryId: id,
    schedule: formatted,
  });
}));

// Get all active gantries (for map display)
erpRouter.get('/gantries', asyncHandler(async (_req, res: Response) => {
  const result = await db.query(
    `SELECT id, gantry_code, name, road_name, direction,
            ST_Y(location::geometry) as lat, ST_X(location::geometry) as lng
     FROM erp_gantries
     WHERE is_active = true
     ORDER BY gantry_code`
  );

  res.json({
    gantries: result.rows.map(r => ({
      id: r.id,
      code: r.gantry_code,
      name: r.name,
      roadName: r.road_name,
      direction: r.direction,
      location: { lat: parseFloat(r.lat), lng: parseFloat(r.lng) },
    })),
  });
}));

// Check if live ERP tracking is available
erpRouter.get('/status', asyncHandler(async (_req, res: Response) => {
  const available = await erpService.isTrackingAvailable();

  res.json({
    liveTrackingAvailable: available,
    message: available
      ? 'Live ERP rates available'
      : '⚠️ Live tracking unavailable - displaying baseline schedules',
    timestamp: new Date().toISOString(),
  });
}));

// Get ERP rates for specific gantries at a time (for map overlay)
erpRouter.post('/rates', asyncHandler(async (req, res: Response) => {
  const schema = z.object({
    gantryIds: z.array(z.string().uuid()).min(1).max(50),
    time: z.string().datetime().optional(),
  });

  const { gantryIds, time } = schema.parse(req.body);
  const checkTime = time ? new Date(time) : new Date();

  // Fetch gantry details from DB
  const gantryResult = await db.query(
    `SELECT id, gantry_code, name, 
            ST_Y(location::geometry) as lat, ST_X(location::geometry) as lng
     FROM erp_gantries
     WHERE id = ANY($1) AND is_active = true`,
    [gantryIds]
  );

  const gantries = gantryResult.rows.map(r => ({
    id: r.id,
    gantryCode: r.gantry_code,
    name: r.name,
    location: { lat: parseFloat(r.lat), lng: parseFloat(r.lng) },
    distFromStartM: 0,
  }));

  const results = await Promise.all(
    gantries.map(async (g) => {
      const schedule = await erpService.getBaselineSchedule(g.id);
      const dow = checkTime.getDay();
      const currentTime = checkTime.toTimeString().slice(0, 5);

      const activeTier = schedule.find(s =>
        s.dayOfWeek === dow &&
        s.startTime <= currentTime &&
        s.endTime > currentTime
      );

      return {
        gantryId: g.id,
        rate: activeTier?.rate || 0,
        isActive: !!activeTier,
        period: activeTier ? `${activeTier.startTime} - ${activeTier.endTime}` : null,
      };
    })
  );

  res.json({
    time: checkTime.toISOString(),
    rates: results,
  });
}));