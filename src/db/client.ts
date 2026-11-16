import pg from 'pg';
import { getDatabaseUrl } from '../config/env.js';
import { logger } from '../utils/logger.js';

const { Pool } = pg;

export const db = new Pool({
  connectionString: getDatabaseUrl(),
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  // Enable PostGIS types
  types: {
    getTypeParser: (oid: number) => {
      if (oid === 1082 || oid === 1114 || oid === 1184) { // date, timestamp, timestamptz
        return (val: string) => val;
      }
      return pg.types.getTypeParser(oid);
    },
  },
});

db.on('error', (err) => {
  logger.error({ err }, 'Unexpected database pool error');
});

db.on('connect', () => {
  logger.debug('New database connection established');
});

// Helper for transactions
export const withTransaction = async <T>(
  callback: (client: pg.PoolClient) => Promise<T>
): Promise<T> => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

// Health check
export const checkDatabaseHealth = async (): Promise<boolean> => {
  try {
    await db.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
};