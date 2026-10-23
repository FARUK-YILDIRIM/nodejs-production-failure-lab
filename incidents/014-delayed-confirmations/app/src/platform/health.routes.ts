import express from 'express';
import { config } from './config.ts';
import { pool } from './db.ts';
import { isDraining } from './lifecycle.ts';

/** Every service the API calls, for dashboards and humans: GET /health/dependencies. */
const DEPENDENCIES: Record<string, () => Promise<unknown>> = {
  database: () => pool.query('SELECT 1'),
  taxrate: () => ping(new URL('/health', config.taxrateUrl).href),
  payments: () => ping(`${config.paymentsUrl}/health`),
  recommendations: () => ping(`${config.recommendationsUrl}/health`),
  mailwave: () => ping(`${config.mailwaveUrl}/health`),
};

async function ping(url: string): Promise<void> {
  const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
  await response.body?.cancel();
  if (!response.ok) throw new Error(`answered ${response.status}`);
}

async function checkDependencies(): Promise<Record<string, string>> {
  const results = await Promise.all(
    Object.entries(DEPENDENCIES).map(async ([name, check]) => {
      try {
        await check();
        return [name, 'ok'];
      } catch (err) {
        return [name, err instanceof Error ? err.message : String(err)];
      }
    }),
  );
  return Object.fromEntries(results);
}

export const healthRouter = express.Router();

/** Liveness: the process is up and its event loop answers. */
healthRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: config.version });
});

/**
 * Readiness: the proxy may send requests here. Not while shutting down. It only
 * checks what every request needs, the database: the other dependencies are shared
 * by all instances, so failing readiness over one of them would take every
 * instance out at once, and with them every page, even those that don't use it.
 * Requests that need a failing dependency fail on their own.
 */
healthRouter.get('/ready', async (_req, res) => {
  if (isDraining()) {
    res.status(503).json({ status: 'draining' });
    return;
  }
  await pool.query('SELECT 1');
  res.json({ status: 'ready' });
});

/** The state of every dependency: for dashboards and humans, never for the proxy. */
healthRouter.get('/health/dependencies', async (_req, res) => {
  const dependencies = await checkDependencies();
  const healthy = Object.values(dependencies).every((result) => result === 'ok');
  res.json({ status: healthy ? 'ok' : 'degraded', dependencies });
});
