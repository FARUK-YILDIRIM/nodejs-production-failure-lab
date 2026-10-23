// TaxRate: a stand-in for a third-party sales tax / VAT API, reached at
// api.taxrate.example. Students don't own this service.
//
// ShopFlow's plan lets TaxRate compute 2 quotes at a time; further requests wait
// in line, up to 1,000, after which TaxRate answers 503 right away. Like most
// servers, it finishes what it started: a quote whose client has gone away is
// still computed, then thrown away. Now and then its database fails over, and
// for a few seconds every quote takes seconds.
import http from 'node:http';

const PORT = Number(process.env.PORT ?? 80);
const METRICS_PORT = Number(process.env.METRICS_PORT ?? 9464);
const ADMIN_PORT = Number(process.env.ADMIN_PORT ?? 9000);
const WORKERS = Number(process.env.WORKERS ?? 2);
const MAX_QUEUE = Number(process.env.MAX_QUEUE ?? 1_000);
const LATENCY_MS = { min: 60, max: 100 };
const SLOW_LATENCY_MS = { min: 2_000, max: 3_000 };

/** Standard rates by destination country, in basis points. */
const RATES: Record<string, number> = {
  US: 725, CA: 500, GB: 2000, DE: 1900, FR: 2000, NL: 2100, ES: 2100, IT: 2200, SE: 2500, TR: 2000,
};

const log = (msg: string, fields: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ level: 'info', time: new Date().toISOString(), service: 'taxrate', msg, ...fields }));

// --- Capacity ------------------------------------------------------------------

let busy = 0;
const queue: (() => void)[] = [];
let slowUntil = 0;

function acquire(): Promise<() => void> | undefined {
  const release = () => {
    busy -= 1;
    queue.shift()?.();
  };
  if (busy < WORKERS) {
    busy += 1;
    return Promise.resolve(release);
  }
  if (queue.length >= MAX_QUEUE) return undefined;
  return new Promise((resolve) =>
    queue.push(() => {
      busy += 1;
      resolve(release);
    }),
  );
}

// --- Metrics -------------------------------------------------------------------

const BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30];
const latency = { buckets: BUCKETS.map(() => 0), count: 0, sum: 0 };
const responses = new Map<string, number>();
let received = 0;
let abandoned = 0;
let connections = 0;

function count(status: number, reason: string): void {
  const key = `status="${status}",reason="${reason}"`;
  responses.set(key, (responses.get(key) ?? 0) + 1);
}

function observe(seconds: number): void {
  latency.count += 1;
  latency.sum += seconds;
  BUCKETS.forEach((bound, index) => {
    if (seconds <= bound) latency.buckets[index] = (latency.buckets[index] ?? 0) + 1;
  });
}

// --- API -----------------------------------------------------------------------

const json = (res: http.ServerResponse, status: number, body: unknown) =>
  res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/v1/quotes') {
    const startedAt = performance.now();
    received += 1;
    let raw = '';
    for await (const chunk of req) raw += chunk;

    const worker = acquire();
    if (!worker) {
      count(503, 'queue_full');
      return json(res, 503, { error: 'too_busy', message: 'Too many requests in progress for this account.' });
    }
    const release = await worker;
    try {
      const { min, max } = Date.now() < slowUntil ? SLOW_LATENCY_MS : LATENCY_MS;
      await new Promise((resolve) => setTimeout(resolve, min + Math.random() * (max - min)));
    } finally {
      release();
    }

    const quote = JSON.parse(raw || '{}') as { country?: string; amountCents?: number };
    const rateBasisPoints = RATES[quote.country ?? ''] ?? 0;
    const taxCents = Math.round(((quote.amountCents ?? 0) * rateBasisPoints) / 10_000);
    // The quote is ready; is anyone still waiting for it?
    if (res.destroyed || req.socket.destroyed) {
      abandoned += 1;
      count(200, 'abandoned');
      return;
    }
    count(200, 'ok');
    json(res, 200, { rateBasisPoints, taxCents });
    observe((performance.now() - startedAt) / 1000);
    return;
  }
  if (req.url === '/health') {
    // Like most providers' health endpoints, it reports degraded performance.
    const degraded = Date.now() < slowUntil;
    return json(res, degraded ? 503 : 200, { status: degraded ? 'degraded' : 'ok' });
  }
  res.writeHead(404).end();
});
server.on('connection', () => (connections += 1));
server.listen(PORT);

// Database failovers, triggered by the lab's traffic: POST /failover?seconds=10
// (on a port that isn't published: it plays the part of TaxRate's own infrastructure).
http
  .createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://taxrate');
    if (req.method === 'POST' && url.pathname === '/failover') {
      const seconds = Math.min(Number(url.searchParams.get('seconds') ?? 10) || 10, 120);
      slowUntil = Date.now() + seconds * 1000;
      log('database failover: quotes are slow', { seconds });
      setTimeout(() => log('database failover complete'), seconds * 1000);
      return json(res, 202, { slowUntil: new Date(slowUntil).toISOString() });
    }
    res.writeHead(404).end();
  })
  .listen(ADMIN_PORT);

http
  .createServer((req, res) => {
    if (req.url !== '/metrics') return res.writeHead(404).end();
    const lines = [
      '# HELP taxrate_requests_received_total Quote requests received, answered or not yet.',
      '# TYPE taxrate_requests_received_total counter',
      `taxrate_requests_received_total ${received}`,
      '# HELP taxrate_requests_total Quote requests, by response status and reason (abandoned: computed after the client went away).',
      '# TYPE taxrate_requests_total counter',
      ...[...responses].map(([labels, value]) => `taxrate_requests_total{${labels}} ${value}`),
      '# HELP taxrate_request_duration_seconds Time to answer a quote request, waiting time included (answered requests only).',
      '# TYPE taxrate_request_duration_seconds histogram',
      ...BUCKETS.map((bound, index) => `taxrate_request_duration_seconds_bucket{le="${bound}"} ${latency.buckets[index]}`),
      `taxrate_request_duration_seconds_bucket{le="+Inf"} ${latency.count}`,
      `taxrate_request_duration_seconds_sum ${latency.sum}`,
      `taxrate_request_duration_seconds_count ${latency.count}`,
      '# HELP taxrate_abandoned_quotes_total Quotes computed for a client that had already gone away.',
      '# TYPE taxrate_abandoned_quotes_total counter',
      `taxrate_abandoned_quotes_total ${abandoned}`,
      '# HELP taxrate_workers Quotes TaxRate computes at the same time for this account.',
      '# TYPE taxrate_workers gauge',
      `taxrate_workers ${WORKERS}`,
      '# HELP taxrate_workers_busy Quotes being computed right now.',
      '# TYPE taxrate_workers_busy gauge',
      `taxrate_workers_busy ${busy}`,
      '# HELP taxrate_queue_length Requests waiting for a worker.',
      '# TYPE taxrate_queue_length gauge',
      `taxrate_queue_length ${queue.length}`,
      '# HELP taxrate_connections_total TCP connections accepted.',
      '# TYPE taxrate_connections_total counter',
      `taxrate_connections_total ${connections}`,
    ];
    res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' }).end(`${lines.join('\n')}\n`);
  })
  .listen(METRICS_PORT);
