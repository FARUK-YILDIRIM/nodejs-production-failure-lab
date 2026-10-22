import http from 'node:http';
import { constants, PerformanceObserver, performance, type PerformanceEntry } from 'node:perf_hooks';
import v8 from 'node:v8';
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

new Gauge({
  name: 'nodejs_heap_size_limit_bytes',
  help: 'Maximum size of the V8 heap; allocating beyond it crashes the process.',
  registers: [registry],
  collect() {
    this.set(v8.getHeapStatistics().heap_size_limit);
  },
});

// Heap usage swings with every allocation burst; right after a full GC it shows
// what is actually still referenced. A steady climb of this line is a leak.
const heapAfterGc = new Gauge({
  name: 'nodejs_heap_used_after_gc_bytes',
  help: 'V8 heap in use right after the last major (mark-sweep-compact) garbage collection.',
  registers: [registry],
});
heapAfterGc.set(v8.getHeapStatistics().used_heap_size);
new PerformanceObserver((list) => {
  const isMajor = (entry: PerformanceEntry) =>
    (entry as PerformanceEntry & { detail?: { kind?: number } }).detail?.kind === constants.NODE_PERFORMANCE_GC_MAJOR;
  if (list.getEntries().some(isMajor)) heapAfterGc.set(v8.getHeapStatistics().used_heap_size);
}).observe({ entryTypes: ['gc'] });

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
