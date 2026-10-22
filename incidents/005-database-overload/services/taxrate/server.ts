// TaxRate: a stand-in for a third-party sales tax / VAT API, reached at
// api.taxrate.example. Students don't own this service. Its answers are fast;
// like most Node.js servers it closes idle keep-alive connections after 5 s.
import http from 'node:http';

const PORT = Number(process.env.PORT ?? 80);
const METRICS_PORT = Number(process.env.METRICS_PORT ?? 9464);
const LATENCY_MS = { min: 15, max: 45 };

/** Standard rates by destination country, in basis points. */
const RATES: Record<string, number> = {
  US: 725, CA: 500, GB: 2000, DE: 1900, FR: 2000, NL: 2100, ES: 2100, IT: 2200, SE: 2500, TR: 2000,
};

const BUCKETS = [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1];
const latency = { buckets: BUCKETS.map(() => 0), count: 0, sum: 0 };
let connections = 0;

function observe(seconds: number): void {
  latency.count += 1;
  latency.sum += seconds;
  BUCKETS.forEach((bound, index) => {
    if (seconds <= bound) latency.buckets[index] = (latency.buckets[index] ?? 0) + 1;
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/v1/quotes') {
    const startedAt = performance.now();
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const quote = JSON.parse(raw || '{}') as { country?: string; amountCents?: number };
    await new Promise((resolve) => setTimeout(resolve, LATENCY_MS.min + Math.random() * (LATENCY_MS.max - LATENCY_MS.min)));

    const rateBasisPoints = RATES[quote.country ?? ''] ?? 0;
    const taxCents = Math.round(((quote.amountCents ?? 0) * rateBasisPoints) / 10_000);
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ rateBasisPoints, taxCents }));
    observe((performance.now() - startedAt) / 1000);
    return;
  }
  res.writeHead(req.url === '/health' ? 200 : 404).end();
});
server.on('connection', () => (connections += 1));
server.listen(PORT);

http
  .createServer((req, res) => {
    if (req.url !== '/metrics') return res.writeHead(404).end();
    const lines = [
      '# HELP taxrate_request_duration_seconds Time to answer a quote request.',
      '# TYPE taxrate_request_duration_seconds histogram',
      ...BUCKETS.map((bound, index) => `taxrate_request_duration_seconds_bucket{le="${bound}"} ${latency.buckets[index]}`),
      `taxrate_request_duration_seconds_bucket{le="+Inf"} ${latency.count}`,
      `taxrate_request_duration_seconds_sum ${latency.sum}`,
      `taxrate_request_duration_seconds_count ${latency.count}`,
      '# HELP taxrate_connections_total TCP connections accepted.',
      '# TYPE taxrate_connections_total counter',
      `taxrate_connections_total ${connections}`,
    ];
    res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' }).end(`${lines.join('\n')}\n`);
  })
  .listen(METRICS_PORT);
