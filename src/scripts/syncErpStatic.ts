#!/usr/bin/env node
/**
 * ERP Static Data Sync Script
 * Seeds erp_gantries and erp_rates from parsed JSON files into PostgreSQL/PostGIS
 * Usage: npm run sync:erp
 */

import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Database config
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const DATA_DIR = 'C:/Users/tanbb/erp-data';

// Day type to day_of_week mapping (0=Sunday, 6=Saturday)
const DAY_TYPE_TO_DOW: Record<string, number[]> = {
  'WEEKDAY': [1, 2, 3, 4, 5], // Mon-Fri
  'SATURDAY': [6], // Saturday
  'SUNDAY': [0], // Sunday
};

async function syncGantries() {
  const filePath = path.join(DATA_DIR, 'erp_gantries_db.json');
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const gantries = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  console.log(`Syncing ${gantries.length} ERP gantries...`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Upsert gantries
    const upsertQuery = `
      INSERT INTO erp_gantries (gantry_code, name, type, location, road_name, direction, is_active)
      VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326), $6, $7, $8)
      ON CONFLICT (gantry_code) DO UPDATE SET
        name = EXCLUDED.name,
        type = EXCLUDED.type,
        location = EXCLUDED.location,
        road_name = EXCLUDED.road_name,
        direction = EXCLUDED.direction,
        is_active = EXCLUDED.is_active,
        updated_at = NOW()
    `;

    for (const g of gantries) {
      // Map gantry_type to enum
      const type = g.gantry_type === 'ORCHARD_CBD' ? 'CORDON' : 'GANTRY';
      
      await client.query(upsertQuery, [
        g.gantry_id,
        g.gantry_id, // name = gantry_id for now
        type,
        g.longitude,
        g.latitude,
        g.road_name,
        g.direction,
        true,
      ]);
    }

    await client.query('COMMIT');
    console.log(`✓ Synced ${gantries.length} gantries`);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function syncRates() {
  const filePath = path.join(DATA_DIR, 'erp_rates_db.json');
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const rates = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  console.log(`Syncing ${rates.length} ERP rate records...`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // First get gantry UUIDs for FK
    const gantryMap = new Map<string, string>();
    const gantryResult = await client.query('SELECT id, gantry_code FROM erp_gantries');
    for (const row of gantryResult.rows) {
      gantryMap.set(row.gantry_code, row.id);
    }

    const upsertQuery = `
      INSERT INTO erp_rate_tiers (gantry_id, day_of_week, start_time, end_time, rate, season_start, season_end, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (gantry_id, day_of_week, start_time, end_time) DO UPDATE SET
        rate = EXCLUDED.rate,
        season_start = EXCLUDED.season_start,
        season_end = EXCLUDED.season_end,
        is_active = EXCLUDED.is_active,
        updated_at = NOW()
    `;

    let synced = 0;
    for (const r of rates) {
      const gantryUuid = gantryMap.get(r.gantry_id);
      if (!gantryUuid) {
        console.warn(`  ⚠ Gantry ${r.gantry_id} not found in DB, skipping rate`);
        continue;
      }

      const dowList = DAY_TYPE_TO_DOW[r.day_type] || [1, 2, 3, 4, 5];
      
      for (const dow of dowList) {
        await client.query(upsertQuery, [
          gantryUuid,
          dow,
          r.start_time,
          r.end_time,
          r.rate,
          r.effective_from,
          r.effective_to,
          true,
        ]);
        synced++;
      }
    }

    await client.query('COMMIT');
    console.log(`✓ Synced ${synced} rate tier records (expanded to ${synced} day-of-week entries)`);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function verifySync() {
  const client = await pool.connect();
  try {
    const gantryCount = await client.query('SELECT COUNT(*) FROM erp_gantries');
    const rateCount = await client.query('SELECT COUNT(*) FROM erp_rate_tiers');
    const rateByDow = await client.query('SELECT day_of_week, COUNT(*) FROM erp_rate_tiers GROUP BY day_of_week ORDER BY day_of_week');
    const gantryTypes = await client.query('SELECT type, COUNT(*) FROM erp_gantries GROUP BY type');

    console.log('\n=== VERIFICATION ===');
    console.log(`Gantries: ${gantryCount.rows[0].count}`);
    console.log(`Rate tiers: ${rateCount.rows[0].count}`);
    console.log('Rates by day_of_week (0=Sun):', rateByDow.rows);
    console.log('Gantries by type:', gantryTypes.rows);
  } finally {
    client.release();
  }
}

async function main() {
  console.log('=== ERP Static Data Sync ===');
  console.log(`Database: ${process.env.DATABASE_URL?.split('@')[1] || 'local'}`);
  console.log(`Data dir: ${DATA_DIR}\n`);

  try {
    await syncGantries();
    await syncRates();
    await verifySync();
    console.log('\n✅ Sync completed successfully!');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('\n❌ Sync failed:', msg);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();