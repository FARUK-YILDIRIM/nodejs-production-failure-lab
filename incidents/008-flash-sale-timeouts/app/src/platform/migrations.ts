import fs from 'node:fs/promises';
import { pool } from './db.ts';
import { logger } from './logger.ts';

const MIGRATIONS_DIR = new URL('../migrations/', import.meta.url);

/**
 * Applies pending SQL migrations from src/migrations at startup, in file name
 * order, and records them in schema_migrations. A migration whose first line is
 * `-- no-transaction` runs outside a transaction (required for CREATE INDEX
 * CONCURRENTLY); every other one runs atomically.
 */
export async function migrate(): Promise<void> {
  await pool.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
  );
  const applied = new Set(
    (await pool.query<{ version: string }>('SELECT version FROM schema_migrations')).rows.map((row) => row.version),
  );
  const files = (await fs.readdir(MIGRATIONS_DIR)).filter((file) => file.endsWith('.sql')).sort();

  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    if (applied.has(version)) continue;

    const sql = await fs.readFile(new URL(file, MIGRATIONS_DIR), 'utf8');
    const startedAt = Date.now();
    if (sql.startsWith('-- no-transaction')) {
      await pool.query(sql);
      await pool.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
    } else {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }
    logger.info({ migration: version, durationMs: Date.now() - startedAt }, 'migration applied');
  }
}
