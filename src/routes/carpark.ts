import { Router, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/client.js';
import { uraService } from '../services/uraService.js';
import { ltaService } from '../services/ltaService.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';

export const carparkRouter = Router();

// Admin: Trigger URA carpark sync
carparkRouter.post('/sync/ura', asyncHandler(async (_req, res: Response) => {
  await uraService.syncToDatabase();
  res.json({ success: true, message: 'URA carpark data synced' });
}));

// Admin: Trigger LTA ERP sync
carparkRouter.post('/sync/lta', asyncHandler(async (_req, res: Response) => {
  await ltaService.syncToDatabase();
  res.json({ success: true, message: 'LTA ERP data synced' });
}));

// Admin: Refresh live availability
carparkRouter.post('/refresh/availability', asyncHandler(async (_req, res: Response) => {
  await uraService.updateLiveAvailability();
  res.json({ success: true, message: 'Live availability refreshed' });
}));

// Get carpark statistics
carparkRouter.get('/stats', asyncHandler(async (_req, res: Response) => {
  const [total, byProvider, availability] = await Promise.all([
    db.query('SELECT COUNT(*) as count FROM carparks WHERE is_active = true'),
    db.query(`SELECT provider, COUNT(*) as count FROM carparks WHERE is_active = true GROUP BY provider`),
    db.query(`SELECT status, COUNT(*) as count FROM carpark_availability GROUP BY status`),
  ]);

  res.json({
    totalCarparks: parseInt(total.rows[0].count),
    byProvider: byProvider.rows.map(r => ({ provider: r.provider, count: parseInt(r.count) })),
    availabilityStatus: availability.rows.map(r => ({ status: r.status, count: parseInt(r.count) })),
  });
}));

// Get carpark by ID with full details
carparkRouter.get('/:id', asyncHandler(async (req, res: Response) => {
  const { id } = req.params;

  const result = await db.query(
    `SELECT c.*, ca.available_lots, ca.lot_type_breakdown, ca.status, ca.last_updated,
            rs.rate_json, rs.name as rate_schedule_name
     FROM carparks c
     LEFT JOIN carpark_availability ca ON ca.carpark_id = c.id
     LEFT JOIN rate_schedules rs ON rs.id = c.rate_schedule_id
     WHERE c.id = $1`,
    [id]
  );

  if (result.rows.length === 0) {
    throw AppError.notFound('Carpark not found');
  }

  res.json(result.rows[0]);
}));

// List carparks with filters
const listSchema = z.object({
  provider: z.enum(['HDB', 'URA', 'MALL']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  search: z.string().optional(),
});

carparkRouter.get('/', asyncHandler(async (req, res: Response) => {
  const { provider, limit, offset, search } = listSchema.parse(req.query);

  let query = `SELECT c.*, ca.available_lots, ca.status
               FROM carparks c
               LEFT JOIN carpark_availability ca ON ca.carpark_id = c.id
               WHERE c.is_active = true`;
  const params: unknown[] = [];
  let paramIndex = 1;

  if (provider) {
    query += ` AND c.provider = $${paramIndex++}`;
    params.push(provider);
  }

  if (search) {
    query += ` AND (c.name ILIKE $${paramIndex} OR c.address ILIKE $${paramIndex})`;
    params.push(`%${search}%`);
  }

  query += ` ORDER BY c.name LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
  params.push(limit, offset);

  const result = await db.query(query, params);

  res.json({
    carparks: result.rows,
    pagination: { limit, offset },
  });
}));

// Update carpark (admin)
const updateSchema = z.object({
  name: z.string().optional(),
  address: z.string().optional(),
  totalLots: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
  operatingHours: z.record(z.string()).optional(),
});

carparkRouter.patch('/:id', asyncHandler(async (req, res: Response) => {
  const { id } = req.params;
  const updates = updateSchema.parse(req.body);

  const setClause: string[] = [];
  const params: unknown[] = [id];
  let paramIndex = 2;

  if (updates.name !== undefined) {
    setClause.push(`name = $${paramIndex++}`);
    params.push(updates.name);
  }
  if (updates.address !== undefined) {
    setClause.push(`address = $${paramIndex++}`);
    params.push(updates.address);
  }
  if (updates.totalLots !== undefined) {
    setClause.push(`total_lots = $${paramIndex++}`);
    params.push(updates.totalLots);
  }
  if (updates.isActive !== undefined) {
    setClause.push(`is_active = $${paramIndex++}`);
    params.push(updates.isActive);
  }
  if (updates.operatingHours !== undefined) {
    setClause.push(`operating_hours = $${paramIndex++}`);
    params.push(JSON.stringify(updates.operatingHours));
  }

  if (setClause.length === 0) {
    throw AppError.badRequest('No valid fields to update');
  }

  setClause.push('updated_at = NOW()');

  const result = await db.query(
    `UPDATE carparks SET ${setClause.join(', ')} WHERE id = $1 RETURNING *`,
    params
  );

  if (result.rows.length === 0) {
    throw AppError.notFound('Carpark not found');
  }

  res.json(result.rows[0]);
}));

// Create rate schedule
const rateScheduleSchema = z.object({
  name: z.string().min(1).max(100),
  rateJson: z.record(z.unknown()),
  effectiveFrom: z.string().date().optional(),
  effectiveTo: z.string().date().optional(),
});

carparkRouter.post('/rate-schedules', asyncHandler(async (req, res: Response) => {
  const { name, rateJson, effectiveFrom, effectiveTo } = rateScheduleSchema.parse(req.body);

  const result = await db.query(
    `INSERT INTO rate_schedules (name, rate_json, effective_from, effective_to)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [name, JSON.stringify(rateJson), effectiveFrom || null, effectiveTo || null]
  );

  res.status(201).json(result.rows[0]);
}));

// List rate schedules
carparkRouter.get('/rate-schedules', asyncHandler(async (_req, res: Response) => {
  const result = await db.query(
    `SELECT * FROM rate_schedules ORDER BY effective_from DESC`
  );

  res.json({ rateSchedules: result.rows });
}));