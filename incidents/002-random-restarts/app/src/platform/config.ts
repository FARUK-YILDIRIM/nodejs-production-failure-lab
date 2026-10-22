import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  name: string;
  version: string;
};

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value)) throw new Error(`${name} must be an integer, got "${raw}"`);
  return value;
}

export const config = {
  service: pkg.name,
  version: pkg.version,
  port: intFromEnv('PORT', 3000),
  metricsPort: intFromEnv('METRICS_PORT', 9464),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://shop:shop@localhost:5432/shop',
  dbPoolSize: intFromEnv('DB_POOL_SIZE', 10),
  slowRequestMs: intFromEnv('SLOW_REQUEST_MS', 500),
  logLevel: process.env.LOG_LEVEL ?? 'info',
} as const;
