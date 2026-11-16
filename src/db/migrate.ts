import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { db } from './client.js';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function migrate(): Promise<void> {
  logger.info('Running database migrations...');

  // schema.sql lives at backend/schema.sql in both source and compiled layouts.
  const schemaPath = join(__dirname, '../../schema.sql');
  if (!existsSync(schemaPath)) {
    throw new Error(`Database schema not found at ${schemaPath}`);
  }
  const schema = readFileSync(schemaPath, 'utf-8');

  // Split by semicolon but handle function definitions
  const statements = schema
    .split(/;\s*(?=(?:CREATE|INSERT|UPDATE|DELETE|ALTER|DROP|COMMENT|GRANT|REVOKE|SET|TRUNCATE|VACUUM|ANALYZE|EXPLAIN|WITH|SELECT|$))/g)
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  for (const statement of statements) {
    try {
      await db.query(statement);
      logger.debug({ statement: statement.slice(0, 80) + '...' }, 'Migration step executed');
    } catch (error) {
      // Some statements might fail if already applied (e.g., CREATE EXTENSION)
      const err = error as Error;
      if (err.message.includes('already exists') || err.message.includes('duplicate')) {
        logger.debug({ statement: statement.slice(0, 80) + '...' }, 'Migration step skipped (already exists)');
      } else {
        logger.error({ error: err, statement: statement.slice(0, 200) }, 'Migration step failed');
        throw error;
      }
    }
  }

  logger.info('Database migrations completed');
}

export async function rollback(): Promise<void> {
  logger.warn('Rollback not implemented - manual intervention required');
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  await migrate()
    .then(() => process.exit(0))
    .catch(err => {
      logger.error({ err }, 'Migration failed');
      process.exit(1);
    });
}
