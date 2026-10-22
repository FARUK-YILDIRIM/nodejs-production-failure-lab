import type { RequestHandler } from 'express';
import { httpRequestDuration } from '../telemetry/metrics.ts';
import { config } from './config.ts';
import { logger } from './logger.ts';

/** "/api/orders/123?x=1" → "/api/orders/:id", so the route label stays low-cardinality. */
function routeTemplate(url: string): string {
  const path = url.split('?', 1)[0] ?? url;
  return path.replace(/\/\d+(?=\/|$)/g, '/:id').replace(/(.)\/$/, '$1');
}

/**
 * Records a latency histogram per route and logs requests that fail or are slow.
 * Fast, successful requests are only logged at debug level to keep logs readable.
 */
export function requestTelemetry(): RequestHandler {
  return (req, res, next) => {
    const startedAt = process.hrtime.bigint();

    res.once('finish', () => {
      const seconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
      // Only requests that matched a route get their own label; anything else
      // (scanners, typos) would otherwise create a new time series per URL.
      const route = req.route ? routeTemplate(req.originalUrl) : 'unmatched';
      httpRequestDuration.observe({ method: req.method, route, status_code: res.statusCode }, seconds);

      const fields = { method: req.method, route, status: res.statusCode, durationMs: Math.round(seconds * 1000) };
      if (res.statusCode >= 500) logger.error(fields, 'request failed');
      else if (fields.durationMs >= config.slowRequestMs) logger.warn(fields, 'slow request');
      else logger.debug(fields, 'request completed');
    });

    next();
  };
}
