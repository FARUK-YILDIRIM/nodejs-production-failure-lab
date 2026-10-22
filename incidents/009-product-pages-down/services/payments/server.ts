// PayFlow: a stand-in for a third-party card payment API. Students don't own it.
// Authorizations take a few hundred milliseconds, like real card networks;
// the test token `tok_chargeDeclined` is always declined.
import { randomUUID } from 'node:crypto';
import http from 'node:http';

const PORT = Number(process.env.PORT ?? 8090);
const METRICS_PORT = Number(process.env.METRICS_PORT ?? 9464);
const API_KEY = process.env.API_KEY ?? 'pf_test_key';
const LATENCY_MS = { min: Number(process.env.LATENCY_MIN_MS ?? 250), max: Number(process.env.LATENCY_MAX_MS ?? 550) };

interface Authorization {
  id: string;
  amountCents: number;
  paymentToken: string;
  status: 'authorized' | 'voided';
}

// Recent requests only, so the mock's memory stays flat however long the lab runs.
const KEEP = 100_000;
const authorizations = new Map<string, Authorization>();
const byIdempotencyKey = new Map<string, { status: number; body: unknown }>();

function remember<K, V>(map: Map<K, V>, key: K, value: V): void {
  map.set(key, value);
  if (map.size > KEEP) map.delete(map.keys().next().value as K);
}

const BUCKETS = [0.1, 0.25, 0.5, 0.75, 1, 2.5];
const requests = new Map<string, number>();
const latency = { buckets: BUCKETS.map(() => 0), count: 0, sum: 0 };

function observe(operation: string, status: number, seconds: number): void {
  const key = `operation="${operation}",status="${status}"`;
  requests.set(key, (requests.get(key) ?? 0) + 1);
  latency.count += 1;
  latency.sum += seconds;
  BUCKETS.forEach((bound, index) => {
    if (seconds <= bound) latency.buckets[index] = (latency.buckets[index] ?? 0) + 1;
  });
}

const json = (res: http.ServerResponse, status: number, body: unknown) =>
  res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  try {
    return JSON.parse(raw || '{}') as Record<string, unknown>;
  } catch {
    return {};
  }
}

const delay = () =>
  new Promise((resolve) => setTimeout(resolve, LATENCY_MS.min + Math.random() * (LATENCY_MS.max - LATENCY_MS.min)));

http
  .createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://payments');
    const startedAt = performance.now();
    if (url.pathname === '/health') return json(res, 200, { status: 'ok' });

    // Authorizations on a card, like the provider's dashboard: GET /v1/authorizations?paymentToken=tok_…
    if (req.method === 'GET' && url.pathname === '/v1/authorizations') {
      const paymentToken = url.searchParams.get('paymentToken');
      return json(res, 200, { items: [...authorizations.values()].filter((item) => item.paymentToken === paymentToken) });
    }

    if (req.headers.authorization !== `Bearer ${API_KEY}`) return json(res, 401, { error: 'unauthorized' });

    // POST /v1/authorizations: hold an amount on the customer's card.
    if (req.method === 'POST' && url.pathname === '/v1/authorizations') {
      const body = await readJson(req);
      const idempotencyKey = req.headers['idempotency-key'];
      const replay = typeof idempotencyKey === 'string' ? byIdempotencyKey.get(idempotencyKey) : undefined;
      await delay();
      if (replay) return json(res, replay.status, replay.body);

      let status: number;
      let response: unknown;
      if (typeof body.amountCents !== 'number' || typeof body.paymentToken !== 'string') {
        status = 422;
        response = { error: 'invalid_request' };
      } else if (body.paymentToken === 'tok_chargeDeclined') {
        status = 402;
        response = { status: 'declined', declineCode: 'card_declined' };
      } else {
        const authorization: Authorization = {
          id: `auth_${randomUUID()}`,
          amountCents: body.amountCents,
          paymentToken: body.paymentToken,
          status: 'authorized',
        };
        remember(authorizations, authorization.id, authorization);
        status = 201;
        response = authorization;
      }
      if (typeof idempotencyKey === 'string') remember(byIdempotencyKey, idempotencyKey, { status, body: response });
      observe('authorize', status, (performance.now() - startedAt) / 1000);
      return json(res, status, response);
    }

    // POST /v1/authorizations/:id/void: release the hold.
    const voidMatch = /^\/v1\/authorizations\/([\w-]+)\/void$/.exec(url.pathname);
    if (req.method === 'POST' && voidMatch) {
      await delay();
      const authorization = authorizations.get(voidMatch[1] ?? '');
      const status = authorization ? 200 : 404;
      if (authorization) authorization.status = 'voided';
      observe('void', status, (performance.now() - startedAt) / 1000);
      return json(res, status, authorization ?? { error: 'not_found' });
    }

    json(res, 404, { error: 'not_found' });
  })
  .listen(PORT);

http
  .createServer((req, res) => {
    if (req.url !== '/metrics') return res.writeHead(404).end();
    const lines = [
      '# HELP payflow_requests_total Payment API requests, by operation and response status.',
      '# TYPE payflow_requests_total counter',
      ...[...requests].map(([labels, count]) => `payflow_requests_total{${labels}} ${count}`),
      '# HELP payflow_request_duration_seconds Time to answer a payment API request.',
      '# TYPE payflow_request_duration_seconds histogram',
      ...BUCKETS.map((bound, index) => `payflow_request_duration_seconds_bucket{le="${bound}"} ${latency.buckets[index]}`),
      `payflow_request_duration_seconds_bucket{le="+Inf"} ${latency.count}`,
      `payflow_request_duration_seconds_sum ${latency.sum}`,
      `payflow_request_duration_seconds_count ${latency.count}`,
    ];
    res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' }).end(`${lines.join('\n')}\n`);
  })
  .listen(METRICS_PORT);
