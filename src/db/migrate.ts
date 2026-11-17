import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { db } from './client.js';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function migrate(): Promise<void> {
  logger.info('Running database migrations...');

  const schemaPath = join(__dirname, '../../schema.sql');
  if (!existsSync(schemaPath)) {
    throw new Error(`Database schema not found at ${schemaPath}`);
  }
  const schema = readFileSync(schemaPath, 'utf-8');

  // Split by semicolon but handle dollar-quoted function bodies ($$...$$)
  // Track dollar-quote state to avoid splitting inside function bodies
  const statements: string[] = [];
  let current = '';
  let inDollarQuote = false;
  
  for (let i = 0; i < schema.length; i++) {
    const char = schema[i];
    const nextChar = schema[i + 1] || '';
    
    // Check for $$ dollar quote start/end
    if (char === '$' && nextChar === '$') {
      inDollarQuote = !inDollarQuote;
      current += '$$';
      i++; // skip next $
      continue;
    }
    
    current += char;
    
    // Split on semicolon only when not in dollar quote
    if (char === ';' && !inDollarQuote) {
      const stmt = current.trim();
      // Skip only if statement is empty (line comments like -- ... are OK, PostgreSQL ignores them)
      if (stmt.length > 0) {
        statements.push(stmt);
      }
      current = '';
    }
  }
  
  // Add any remaining
  const finalStmt = current.trim();
  if (finalStmt.length > 0) {
    statements.push(finalStmt);
  }

  for (const statement of statements) {
    try {
      await db.query(statement);
      logger.debug({ statement: statement.slice(0, 80) + '...' }, 'Migration step executed');
    } catch (error) {
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
