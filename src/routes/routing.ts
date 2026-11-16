import { Router, Response } from 'express';
import { z } from 'zod';
import { oneMapService } from '../services/oneMapService.js';
import { erpService } from '../services/erpService.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';

export const routingRouter = Router();

const routeQuerySchema = z.object({
  startLat: z.coerce.number().min(-90).max(90),
  startLng: z.coerce.number().min(-180).max(180),
  endLat: z.coerce.number().min(-90).max(90),
  endLng: z.coerce.number().min(-180).max(180),
  mode: z.enum(['drive', 'pt', 'walk', 'cycle']).default('drive'),
  departureTime: z.string().datetime().optional(),
});

const routePreviewSchema = z.object({
  origin: z.object({
    lat: z.number(),
    lng: z.number(),
    address: z.string().optional(),
  }),
  destination: z.object({
    lat: z.number(),
    lng: z.number(),
    address: z.string().optional(),
  }),
  departureTime: z.string().datetime().optional(),
});

const routePlanSchema = z.object({
  origin: z.object({
    lat: z.number(),
    lng: z.number(),
    address: z.string().optional(),
  }),
  destination: z.object({
    lat: z.number(),
    lng: z.number(),
    address: z.string().optional(),
  }),
  departureTime: z.string().datetime().optional(),
  waypoints: z.array(z.object({
    lat: z.number(),
    lng: z.number(),
  })).optional(),
});

routingRouter.post('/plan', asyncHandler(async (req, res: Response) => {
  const { startLat, startLng, endLat, endLng, mode, departureTime } = routeQuerySchema.parse(req.body);
  const depTime = departureTime ? new Date(departureTime) : new Date();

  const route = await oneMapService.getRoute(startLat, startLng, endLat, endLng, mode);
  const gantries = await erpService.getRouteGantries(route.geometry, route.instructions);
  const erpCost = await erpService.calculateRouteCost(gantries, depTime, route.geometry, route.duration);
  const departureWindows = await erpService.getDepartureWindows(gantries, depTime, route.geometry, route.duration);

  res.json({
    route: { distance: route.distance, duration: route.duration, geometry: route.geometry, instructions: route.instructions },
    erp: {
      totalCost: erpCost.totalCost,
      gantries: erpCost.gantries.map(g => ({
        code: g.gantryCode, name: g.name, rate: g.rate, arrivalTime: g.arrivalTime,
        appliedStartTime: g.appliedStartTime, rateGroup: g.rateGroup, roadName: g.roadName,
        rateBoundaryWarning: g.rateBoundaryWarning,
        adjacentRates: g.adjacentRates,
      })),
      departureTime: erpCost.departureTime,
      savings: erpCost.savings,
      departureWindows: departureWindows.slice(0, 12),
    },
    metadata: { mode, requestedAt: new Date().toISOString() },
  });
}));

routingRouter.post('/preview', asyncHandler(async (req, res: Response) => {
  const { origin, destination, departureTime } = routePreviewSchema.parse(req.body);
  const depTime = departureTime ? new Date(departureTime) : new Date();

  const route = await oneMapService.getRoute(origin.lat, origin.lng, destination.lat, destination.lng, 'drive');
  const gantries = await erpService.getRouteGantries(route.geometry, route.instructions);
  const erpCost = await erpService.calculateRouteCost(gantries, depTime, route.geometry, route.duration);
  const departureWindows = await erpService.getDepartureWindows(gantries, depTime, route.geometry, route.duration);

  res.json({
    route: { distance: route.distance, duration: route.duration, geometry: route.geometry, instructions: route.instructions },
    erp: {
      leaveNowCost: erpCost.totalCost,
      gantries: erpCost.gantries.map(g => ({
        code: g.gantryCode, name: g.name, rate: g.rate, arrivalTime: g.arrivalTime,
        appliedStartTime: g.appliedStartTime, rateGroup: g.rateGroup, roadName: g.roadName,
        rateBoundaryWarning: g.rateBoundaryWarning,
        adjacentRates: g.adjacentRates,
      })),
      savings: erpCost.savings,
      departureWindows: departureWindows.slice(0, 6),
    },
    destination: { lat: destination.lat, lng: destination.lng, address: destination.address },
  });
}));

routingRouter.post('/reroute', asyncHandler(async (req, res: Response) => {
  const { startLat, startLng, endLat, endLng, departureTime } = routeQuerySchema.parse(req.body);
  const depTime = departureTime ? new Date(departureTime) : new Date();

  const route = await oneMapService.getRoute(startLat, startLng, endLat, endLng, 'drive');
  const gantries = await erpService.getRouteGantries(route.geometry, route.instructions);
  const erpCost = await erpService.calculateRouteCost(gantries, depTime, route.geometry, route.duration);

  res.json({
    route: { distance: route.distance, duration: route.duration, geometry: route.geometry, instructions: route.instructions },
    erp: {
      totalCost: erpCost.totalCost,
      gantries: erpCost.gantries.map(g => ({
        code: g.gantryCode, name: g.name, rate: g.rate, arrivalTime: g.arrivalTime,
        appliedStartTime: g.appliedStartTime, rateGroup: g.rateGroup, roadName: g.roadName,
        rateBoundaryWarning: g.rateBoundaryWarning,
        adjacentRates: g.adjacentRates,
      })),
    },
  });
}));
