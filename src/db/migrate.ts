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
  // Track dollar-quote depth to avoid splitting inside function bodies
  const statements: string[] = [];
  let current = '';
  let inDollarQuote = false;
  let dollarTag = '';
  
  for (let i = 0; i < schema.length; i++) {
    const char = schema[i];
    const nextChar = schema[i + 1] || '';
    
    // Check for dollar quote start/end ($$ or $tag$)
    if (char === '$' && nextChar === '$') {
      if (!inDollarQuote) {
        inDollarQuote = true;
        dollarTag = '$$';
      } else if (dollarTag === '$$') {
        inDollarQuote = false;
        dollarTag = '';
      }
      current += '$$';
      i++; // skip next $
      continue;
    }
    
    // Check for $tag$ style quotes
    if (char === '$' && !inDollarQuote && /^[A-Za-z0-9_]*\$/.test(schema.slice(i))) {
      const match = schema.slice(i).match(/^\$([A-Za-z0-9_]*)\$/);
      if (match) {
        inDollarQuote = true;
        dollarTag = `$${match[1]}$`;
        current += match[0];
        i += match[0].length - 1;
        continue;
      }
    }
    
    if (char === '$' && inDollarQuote && schema.slice(i).startsWith(dollarTag)) {
      inDollarQuote = false;
      current += dollarTag;
      i += dollarTag.length - 1;
      continue;
    }
    
    current += char;
    
    // Split on semicolon only when not in dollar quote
    if (char === ';' && !inDollarQuote) {
      const stmt = current.trim();
      if (stmt.length > 0 && !stmt.startsWith('--')) {
        statements.push(stmt);
      }
      current = '';
    }
  }
  
  // Add any remaining
  const finalStmt = current.trim();
  if (finalStmt.length > 0 && !finalStmt.startsWith('--')) {
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
