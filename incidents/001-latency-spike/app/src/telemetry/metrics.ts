import http from 'node:http';
import { performance } from 'node:perf_hooks';
import { Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

export const registry = new Registry();

// Process and Node.js runtime metrics: CPU, memory, heap, GC, event loop lag, handles…
collectDefaultMetrics({ register: registry });

export const httpRequestDuration = new Histogram({
  name: 'http_server_request_duration_seconds',
  help: 'HTTP request duration measured by the API, from the moment Express starts handling the request until the response is sent.',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

export const dbQueryDuration = new Histogram({
  name: 'db_client_query_duration_seconds',
  help: 'Database query duration as observed by the API.',
  labelNames: ['query'] as const,
  buckets: [0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

let lastUtilization = performance.eventLoopUtilization();

new Gauge({
  name: 'nodejs_eventloop_utilization',
  help: 'Fraction of time the event loop was busy since the previous scrape (0 to 1).',
  registers: [registry],
  collect() {
    const current = performance.eventLoopUtilization();
    this.set(performance.eventLoopUtilization(current, lastUtilization).utilization);
    lastUtilization = current;
  },
});

/** Serves /metrics for Prometheus on its own port, away from public traffic. */
export function startMetricsServer(port: number): http.Server {
  return http
    .createServer((req, res) => {
      if (req.url !== '/metrics') {
        res.writeHead(404).end();
        return;
      }
      registry.metrics().then(
        (body) => res.writeHead(200, { 'Content-Type': registry.contentType }).end(body),
        (err: unknown) => res.writeHead(500).end(String(err)),
      );
    })
    .listen(port);
}
