import type { Request, RequestHandler } from 'express';
import { Counter } from 'prom-client';
import { registry } from '../telemetry/metrics.ts';

interface Entry {
  body: unknown;
  expiresAt: number;
}

interface CacheOptions {
  ttlMs: number;
  /** Query parameters that change the response. Anything else (utm_*, fbclid…) is ignored. */
  params?: string[];
  /** Upper bound on entries; the least recently used ones are evicted first. */
  maxEntries?: number;
}

const lookups = new Counter({
  name: 'http_response_cache_lookups_total',
  help: 'Response cache lookups, by result (hit or miss).',
  labelNames: ['result'] as const,
  registers: [registry],
});

function cacheKey(req: Request, params: string[]): string {
  const query = new URLSearchParams();
  for (const name of params) {
    const value = req.query[name];
    if (typeof value === 'string') query.set(name, value);
  }
  const path = `${req.baseUrl}${req.path}`;
  return query.size > 0 ? `${path}?${query}` : path;
}

/**
 * Serves successful JSON responses from memory for `ttlMs`.
 * The catalog changes a few times a day, so a minute of staleness is fine.
 *
 * Keys only contain the parameters the route uses, and the cache is bounded:
 * a cache must never grow with the number of distinct URLs clients can invent.
 */
export function cacheResponses({ ttlMs, params = [], maxEntries = 1_000 }: CacheOptions): RequestHandler {
  // A Map iterates in insertion order, so re-inserting on every hit keeps the
  // least recently used entry first: a small LRU without a dependency.
  const entries = new Map<string, Entry>();

  return (req, res, next) => {
    const key = cacheKey(req, params);
    const hit = entries.get(key);
    if (hit) entries.delete(key);
    if (hit && hit.expiresAt > Date.now()) {
      entries.set(key, hit);
      lookups.inc({ result: 'hit' });
      res.set('X-Cache', 'HIT').json(hit.body);
      return;
    }

    lookups.inc({ result: 'miss' });
    const send = res.json.bind(res);
    res.json = (body: unknown) => {
      if (res.statusCode === 200) {
        entries.set(key, { body, expiresAt: Date.now() + ttlMs });
        if (entries.size > maxEntries) entries.delete(entries.keys().next().value as string);
      }
      return send(body);
    };
    res.set('X-Cache', 'MISS');
    next();
  };
}
