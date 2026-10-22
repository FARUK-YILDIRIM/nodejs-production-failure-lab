import pg from 'pg';
import { Gauge } from 'prom-client';
import { dbQueryDuration, registry } from '../telemetry/metrics.ts';
import { config } from './config.ts';
import { logger } from './logger.ts';

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: config.dbPoolSize,
  idleTimeoutMillis: 30_000,
  // Never wait for a connection forever: a timeout turns a silent hang into an error.
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => logger.error({ err }, 'unexpected error on idle database client'));

new Gauge({
  name: 'db_pool_connections',
  help: 'Database connection pool: total, idle and waiting clients.',
  labelNames: ['state'] as const,
  registers: [registry],
  collect() {
    this.set({ state: 'total' }, pool.totalCount);
    this.set({ state: 'idle' }, pool.idleCount);
    this.set({ state: 'waiting' }, pool.waitingCount);
  },
});

/**
 * Runs a query and returns its rows. `name` identifies the query in metrics.
 * Pass `client` to run inside a transaction.
 */
export async function query<T extends pg.QueryResultRow>(
  name: string,
  sql: string,
  params: unknown[] = [],
  client?: pg.PoolClient,
): Promise<T[]> {
  const stopTimer = dbQueryDuration.startTimer({ query: name });
  try {
    const result = client ? await client.query<T>(sql, params) : await pool.query<T>(sql, params);
    return result.rows;
  } finally {
    stopTimer();
  }
}

export async function transaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
