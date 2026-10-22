import type { RequestHandler } from 'express';
import { Counter } from 'prom-client';
import { registry } from '../telemetry/metrics.ts';

interface Entry {
  body: unknown;
  expiresAt: number;
}

const entries = new Map<string, Entry>();

const lookups = new Counter({
  name: 'http_response_cache_lookups_total',
  help: 'Response cache lookups, by result (hit or miss).',
  labelNames: ['result'] as const,
  registers: [registry],
});

/**
 * Serves successful JSON responses from memory for `ttlMs`, keyed by URL.
 * The catalog changes a few times a day, so a minute of staleness is fine.
 */
export function cacheResponses(ttlMs: number): RequestHandler {
  return (req, res, next) => {
    const key = req.originalUrl;
    const hit = entries.get(key);
    if (hit && hit.expiresAt > Date.now()) {
      lookups.inc({ result: 'hit' });
      res.set('X-Cache', 'HIT').json(hit.body);
      return;
    }

    lookups.inc({ result: 'miss' });
    const send = res.json.bind(res);
    res.json = (body: unknown) => {
      if (res.statusCode === 200) entries.set(key, { body, expiresAt: Date.now() + ttlMs });
      return send(body);
    };
    res.set('X-Cache', 'MISS');
    next();
  };
}
