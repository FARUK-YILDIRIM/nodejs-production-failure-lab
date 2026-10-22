// PayFlow: a stand-in for a third-party card payment API. Students don't own it.
// Authorizations take a few hundred milliseconds, like real card networks, or
// longer when the card's issuing bank is slow to answer. The test token
// `tok_chargeDeclined` is always declined.
import { randomUUID } from 'node:crypto';
import http from 'node:http';

const PORT = Number(process.env.PORT ?? 8090);
const METRICS_PORT = Number(process.env.METRICS_PORT ?? 9464);
const API_KEY = process.env.API_KEY ?? 'pf_test_key';
const LATENCY_MS = { min: Number(process.env.LATENCY_MIN_MS ?? 250), max: Number(process.env.LATENCY_MAX_MS ?? 550) };
/** Issuing banks having a bad day, e.g. `credibank:2500-4000`. Tokens look like `tok_<issuer>_<card>`. */
const SLOW_ISSUERS = new Map(
  (process.env.SLOW_ISSUERS ?? '')
    .split(',')
    .filter(Boolean)
    .map((entry) => {
      const [issuer = '', range = ''] = entry.split(':');
      const [min = 0, max = 0] = range.split('-').map(Number);
      return [issuer, { min, max }] as const;
    }),
);
/** Window in which a second hold of the same amount on the same card looks like a duplicate charge. */
const DUPLICATE_WINDOW_MS = 10 * 60_000;

interface Authorization {
  id: string;
  amountCents: number;
  paymentToken: string;
  status: 'authorized' | 'voided';
  createdAt: string;
}

// Recent requests only, so the mock's memory stays flat however long the lab runs.
const KEEP = 100_000;
const authorizations = new Map<string, Authorization>();
const byToken = new Map<string, Authorization[]>();
const byIdempotencyKey = new Map<string, { status: number; body: unknown }>();
const inFlight = new Set<string>();
const flagged: { paymentToken: string; amountCents: number; flaggedAt: string }[] = [];

function remember<K, V>(map: Map<K, V>, key: K, value: V): void {
  map.set(key, value);
  if (map.size > KEEP) map.delete(map.keys().next().value as K);
}

const BUCKETS = [0.1, 0.25, 0.5, 0.75, 1, 2.5, 5];
const requests = new Map<string, number>();
const latency = { buckets: BUCKETS.map(() => 0), count: 0, sum: 0 };
let duplicates = 0;

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

const between = ({ min, max }: { min: number; max: number }) => min + Math.random() * (max - min);
const delay = (paymentToken?: unknown) => {
  const issuer = typeof paymentToken === 'string' ? paymentToken.split('_')[1] : undefined;
  const range = (issuer && SLOW_ISSUERS.get(issuer)) || LATENCY_MS;
  return new Promise((resolve) => setTimeout(resolve, between(range)));
};

/** PayFlow's risk check: another active hold of the same amount on the same card, minutes ago. */
function looksLikeDuplicate(authorization: Authorization): boolean {
  const since = Date.now() - DUPLICATE_WINDOW_MS;
  return (byToken.get(authorization.paymentToken) ?? []).some(
    (other) =>
      other.status === 'authorized' && other.amountCents === authorization.amountCents && Date.parse(other.createdAt) >= since,
  );
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://payments');
    const startedAt = performance.now();
    if (url.pathname === '/health') return json(res, 200, { status: 'ok' });

    // Authorizations on a card, like the provider's dashboard: GET /v1/authorizations?paymentToken=tok_…
    if (req.method === 'GET' && url.pathname === '/v1/authorizations') {
      const paymentToken = url.searchParams.get('paymentToken') ?? '';
      return json(res, 200, { items: byToken.get(paymentToken) ?? [] });
    }

    // Possible duplicate charges flagged by PayFlow's risk engine, most recent first.
    if (req.method === 'GET' && url.pathname === '/v1/risk/duplicates') {
      return json(res, 200, { items: flagged.slice(-50).reverse() });
    }

    if (req.headers.authorization !== `Bearer ${API_KEY}`) return json(res, 401, { error: 'unauthorized' });

    // POST /v1/authorizations: hold an amount on the customer's card.
    if (req.method === 'POST' && url.pathname === '/v1/authorizations') {
      const body = await readJson(req);
      const idempotencyKey = typeof req.headers['idempotency-key'] === 'string' ? req.headers['idempotency-key'] : undefined;
      if (idempotencyKey !== undefined) {
        // Same key, request still being processed: like most payment APIs, refuse rather than wait.
        if (inFlight.has(idempotencyKey)) {
          observe('authorize', 409, (performance.now() - startedAt) / 1000);
          return json(res, 409, { error: 'idempotency_key_in_use', message: 'A request with this key is still in progress.' });
        }
        const replay = byIdempotencyKey.get(idempotencyKey);
        if (replay) {
          observe('authorize', replay.status, (performance.now() - startedAt) / 1000);
          return json(res, replay.status, replay.body);
        }
        inFlight.add(idempotencyKey);
      }

      try {
        await delay(body.paymentToken);
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
            createdAt: new Date().toISOString(),
          };
          if (looksLikeDuplicate(authorization)) {
            duplicates += 1;
            flagged.push({ paymentToken: authorization.paymentToken, amountCents: authorization.amountCents, flaggedAt: authorization.createdAt });
            if (flagged.length > 1_000) flagged.shift();
          }
          remember(authorizations, authorization.id, authorization);
          remember(byToken, authorization.paymentToken, [...(byToken.get(authorization.paymentToken) ?? []), authorization]);
          status = 201;
          response = authorization;
        }
        if (idempotencyKey !== undefined) remember(byIdempotencyKey, idempotencyKey, { status, body: response });
        observe('authorize', status, (performance.now() - startedAt) / 1000);
        return json(res, status, response);
      } finally {
        if (idempotencyKey !== undefined) inFlight.delete(idempotencyKey);
      }
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
      '# HELP payflow_duplicate_authorizations_total Authorizations PayFlow flagged as possible duplicate charges: same card, same amount, another hold still active.',
      '# TYPE payflow_duplicate_authorizations_total counter',
      `payflow_duplicate_authorizations_total ${duplicates}`,
    ];
    res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' }).end(`${lines.join('\n')}\n`);
  })
  .listen(METRICS_PORT);
