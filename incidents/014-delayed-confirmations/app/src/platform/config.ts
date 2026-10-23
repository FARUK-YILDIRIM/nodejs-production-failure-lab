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
  // The API and the worker run the same code, as different services.
  service: process.env.OTEL_SERVICE_NAME ?? pkg.name,
  version: pkg.version,
  port: intFromEnv('PORT', 3000),
  metricsPort: intFromEnv('METRICS_PORT', 9464),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://shop:shop@localhost:5432/shop',
  dbPoolSize: intFromEnv('DB_POOL_SIZE', 10),
  slowRequestMs: intFromEnv('SLOW_REQUEST_MS', 500),
  logLevel: process.env.LOG_LEVEL ?? 'info',
  mailwaveUrl: process.env.MAILWAVE_URL ?? 'http://localhost:8025',
  mailwaveApiKey: process.env.MAILWAVE_API_KEY ?? 'mw_test_key',
  taxrateUrl: process.env.TAXRATE_URL ?? 'http://api.taxrate.example',
  paymentsUrl: process.env.PAYMENTS_URL ?? 'http://localhost:8090',
  paymentsApiKey: process.env.PAYMENTS_API_KEY ?? 'pf_test_key',
  recommendationsUrl: process.env.RECOMMENDATIONS_URL ?? 'http://localhost:8100',
  kafkaBrokers: (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(','),
} as const;
