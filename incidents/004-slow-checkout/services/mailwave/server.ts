// MailWave: a stand-in for a third-party transactional email API.
// Students don't own this service; it behaves like a real provider would,
// including the occasional failed request that a client is expected to handle.
import { randomUUID } from 'node:crypto';
import http from 'node:http';

const PORT = Number(process.env.PORT ?? 8025);
const METRICS_PORT = Number(process.env.METRICS_PORT ?? 9464);
const API_KEY = process.env.API_KEY ?? 'mw_test_key';
/** Share of requests answered with 503, as during a provider's partial outage. */
const FAILURE_RATE = Number(process.env.FAILURE_RATE ?? 0.006);
const LATENCY_MS = { min: 40, max: 140 };
const KEEP_ATTEMPTS = 20_000;

interface Attempt {
  id: string;
  to: string;
  template: string;
  orderId: number | null;
  status: number;
  receivedAt: string;
}

const attempts: Attempt[] = [];

// Minimal Prometheus exposition, so the mock needs no dependencies.
const BUCKETS = [0.025, 0.05, 0.1, 0.25, 0.5, 1];
const requests = new Map<string, number>();
const latency = { buckets: BUCKETS.map(() => 0), count: 0, sum: 0 };

function observe(status: number, seconds: number): void {
  requests.set(String(status), (requests.get(String(status)) ?? 0) + 1);
  latency.count += 1;
  latency.sum += seconds;
  BUCKETS.forEach((bound, index) => {
    if (seconds <= bound) latency.buckets[index] = (latency.buckets[index] ?? 0) + 1;
  });
}

function metrics(): string {
  const lines = [
    '# HELP mailwave_requests_total Messages API requests, by response status.',
    '# TYPE mailwave_requests_total counter',
    ...[...requests].map(([status, count]) => `mailwave_requests_total{status="${status}"} ${count}`),
    '# HELP mailwave_request_duration_seconds Time to answer a Messages API request.',
    '# TYPE mailwave_request_duration_seconds histogram',
    ...BUCKETS.map((bound, index) => `mailwave_request_duration_seconds_bucket{le="${bound}"} ${latency.buckets[index]}`),
    `mailwave_request_duration_seconds_bucket{le="+Inf"} ${latency.count}`,
    `mailwave_request_duration_seconds_sum ${latency.sum}`,
    `mailwave_request_duration_seconds_count ${latency.count}`,
  ];
  return `${lines.join('\n')}\n`;
}

const json = (res: http.ServerResponse, status: number, body: unknown) =>
  res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown> | undefined> {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://mailwave');

    if (req.method === 'POST' && url.pathname === '/v1/messages') {
      const startedAt = performance.now();
      if (req.headers.authorization !== `Bearer ${API_KEY}`) return json(res, 401, { error: 'unauthorized' });
      const message = await readJson(req);
      if (!message || typeof message.to !== 'string') return json(res, 422, { error: 'invalid_message' });

      await new Promise((resolve) => setTimeout(resolve, LATENCY_MS.min + Math.random() * (LATENCY_MS.max - LATENCY_MS.min)));
      const status = Math.random() < FAILURE_RATE ? 503 : 202;
      const metadata = (message.metadata ?? {}) as { orderId?: unknown };
      const attempt: Attempt = {
        id: randomUUID(),
        to: message.to,
        template: String(message.template ?? ''),
        orderId: typeof metadata.orderId === 'number' ? metadata.orderId : null,
        status,
        receivedAt: new Date().toISOString(),
      };
      attempts.push(attempt);
      if (attempts.length > KEEP_ATTEMPTS) attempts.shift();
      observe(status, (performance.now() - startedAt) / 1000);

      return status === 202
        ? json(res, 202, { id: attempt.id, status: 'queued' })
        : json(res, 503, { error: 'service_unavailable', message: 'Temporary failure, please retry later.' });
    }

    // Delivery log, like a provider's dashboard: GET /v1/messages?orderId=123
    if (req.method === 'GET' && url.pathname === '/v1/messages') {
      const orderId = Number(url.searchParams.get('orderId'));
      return json(res, 200, { items: attempts.filter((attempt) => attempt.orderId === orderId) });
    }

    if (url.pathname === '/health') return json(res, 200, { status: 'ok' });
    json(res, 404, { error: 'not_found' });
  })
  .listen(PORT);

http
  .createServer((req, res) => {
    if (req.url !== '/metrics') return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' }).end(metrics());
  })
  .listen(METRICS_PORT);
