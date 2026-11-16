import { Router, Response } from 'express';
import { z } from 'zod';
import { oneMapService } from '../services/oneMapService.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';

export const geocodingRouter = Router();

const geocodeQuerySchema = z.object({
  q: z.string().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(10).default(5),
});

const reverseGeocodeSchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

// Forward geocoding: address -> coordinates
geocodingRouter.get('/search', asyncHandler(async (req, res: Response) => {
  const { q, limit } = geocodeQuerySchema.parse(req.query);

  const results = await oneMapService.geocode(q);

  res.json({
    query: q,
    results: results.slice(0, limit),
  });
}));

// Reverse geocoding: coordinates -> address
geocodingRouter.get('/reverse', asyncHandler(async (req, res: Response) => {
  const { lat, lng } = reverseGeocodeSchema.parse(req.query);

  const address = await oneMapService.reverseGeocode(lat, lng);

  if (!address) {
    throw AppError.notFound('Address not found for coordinates');
  }

  res.json({
    latitude: lat,
    longitude: lng,
    address,
  });
}));

// Batch geocoding (for multiple addresses)
const batchGeocodeSchema = z.object({
  queries: z.array(z.string().min(1).max(200)).min(1).max(20),
});

geocodingRouter.post('/batch', asyncHandler(async (req, res: Response) => {
  const { queries } = batchGeocodeSchema.parse(req.body);

  const results = await Promise.all(
    queries.map(async (q) => {
      try {
        const geocoded = await oneMapService.geocode(q);
        return { query: q, results: geocoded, error: null };
      } catch (error) {
        return { query: q, results: [], error: 'Geocoding failed' };
      }
    })
  );

  res.json({ results });
}));