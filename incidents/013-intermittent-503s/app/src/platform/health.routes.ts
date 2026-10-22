import express from 'express';
import { config } from './config.ts';
import { pool } from './db.ts';
import { isDraining } from './lifecycle.ts';

/** Every service the API calls. An instance that can't reach one of them shouldn't get traffic. */
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
 * Readiness: the proxy may send requests here. Not while shutting down, and not
 * while any dependency is unhealthy.
 */
healthRouter.get('/ready', async (_req, res) => {
  if (isDraining()) {
    res.status(503).json({ status: 'draining' });
    return;
  }
  const dependencies = await checkDependencies();
  const ready = Object.values(dependencies).every((result) => result === 'ok');
  res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'degraded', dependencies });
});
