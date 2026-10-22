// ShopFlow traffic model, shared by the background "production" traffic and `./lab verify`.
//
//   MODE=traffic  runs until the container is stopped
//   MODE=warmup   runs for DURATION and prints nothing
//   MODE=verify   runs for DURATION and writes the end-of-test summary to SUMMARY_PATH
//
// Every journey uses an open model (constant arrival rate): new requests keep
// arriving even when the API is slow, like real users do. A closed model would
// slow down with the server and hide the very latency we want to measure.
import { sleep } from 'k6';
import exec from 'k6/execution';
import http from 'k6/http';
import { Rate } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL ?? 'http://traefik';
const MODE = __ENV.MODE ?? 'traffic';
const DURATION = __ENV.DURATION ?? '60s';

const JOURNEYS = {
  catalog: { rate: 30, timeUnit: '1s' }, // browsing products
  checkout: { rate: 6, timeUnit: '1s' }, // placing and viewing orders
  account: { rate: 6, timeUnit: '1s' }, // order history: the mobile app's "My orders" screen
  reports: { rate: 1, timeUnit: '4s' }, // finance exports
  crawler: { rate: 24, timeUnit: '1s' }, // Googlebot, crawling product pages from the new Shopping feed
};

const CATEGORIES = [
  'laptops', 'smartphones', 'tablets', 'headphones', 'smartwatches', 'cameras', 'monitors', 'keyboards',
  'mice', 'printers', 'routers', 'speakers', 'televisions', 'gaming-consoles', 'drones', 'e-readers',
  'chargers', 'cables', 'storage', 'smart-home', 'kitchen-appliances', 'coffee-machines', 'vacuum-cleaners',
  'lighting', 'furniture', 'office-chairs', 'desks', 'backpacks', 'luggage', 'running-shoes', 'sneakers',
  'jackets', 't-shirts', 'watches', 'sunglasses', 'fitness-trackers', 'yoga-gear', 'bicycles', 'camping-gear',
  'books',
];

// TaxRate's database failovers: 10 s of slow quotes. In production, every 5 minutes
// after the first minute; during `./lab verify`, once, 10 s into the measurement.
const FAILOVER = {
  traffic: { executor: 'constant-arrival-rate', rate: 1, timeUnit: '300s', duration: '720h', startTime: '60s', preAllocatedVUs: 1 },
  verify: { executor: 'per-vu-iterations', vus: 1, iterations: 1, startTime: '10s' },
}[MODE];

export const options = {
  discardResponseBodies: true,
  scenarios: {
    ...Object.fromEntries(
      Object.entries(JOURNEYS).map(([name, { rate, timeUnit }]) => [
        name,
        {
          executor: 'constant-arrival-rate',
          exec: name,
          rate,
          timeUnit,
          duration: MODE === 'traffic' ? '720h' : DURATION,
          preAllocatedVUs: 10,
          maxVUs: 200,
          tags: { journey: name },
        },
      ]),
    ),
    ...(FAILOVER ? { failover: { ...FAILOVER, exec: 'failover', tags: { journey: 'failover' } } } : {}),
  },
  // Per-journey sub-metrics only show up in the summary when a threshold references them.
  thresholds:
    MODE === 'verify'
      ? Object.fromEntries(
          Object.keys(JOURNEYS).flatMap((name) => [
            [`http_req_duration{journey:${name}}`, ['max>=0']],
            [`http_req_failed{journey:${name}}`, ['rate>=0']],
          ]).concat([['checkouts_failed{phase:after}', ['rate>=0']]]),
        )
      : {},
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

const between = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1));
const pick = <T>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)] as T;
const isoDay = (date: Date) => date.toISOString().slice(0, 10);
// Browsers ask for compressed responses, and give up on a request after 10 s.
const params = (name: string) => ({ headers: { 'Accept-Encoding': 'gzip, deflate' }, tags: { name }, timeout: '10s' });

export function catalog() {
  const roll = Math.random();
  if (roll < 0.6) {
    http.get(`${BASE_URL}/api/products?category=${pick(CATEGORIES)}&page=${between(1, 5)}`, params('GET /api/products'));
  } else if (roll < 0.95) {
    http.get(`${BASE_URL}/api/products/${between(1, 20000)}`, params('GET /api/products/:id'));
  } else {
    http.get(`${BASE_URL}/api/categories`, params('GET /api/categories'));
  }
}

const VALID_COUPONS = ['AUTUMN20', 'WELCOME10'];
const ISSUERS = ['northwind', 'lakeside', 'firstcity', 'harbor', 'credibank'];

const randomId = () => Math.random().toString(36).slice(2, 12);
const uuid = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    return (char === 'x' ? random : (random % 4) + 8).toString(16);
  });

// The ShopFlow app (5.2): a checkout attempt that takes longer than 2 s is retried,
// up to 4 attempts, with the same body and the same Idempotency-Key. It also retries
// on 5xx, and whenever the API answers with a Retry-After header.
const ATTEMPTS = 4;
const BACKOFF_SECONDS = [0.5, 1, 2];
// Checkouts the app gave up on: no answer after every attempt. Tagged with the
// phase of the verify run they started in (TaxRate slow from 10 s to 20 s).
const checkoutsFailed = new Rate('checkouts_failed');
const phase = () => {
  const elapsed = exec.instance.currentTestRunDuration / 1000;
  return elapsed < 10 ? 'before' : elapsed < 20 ? 'failover' : elapsed < 40 ? 'recovery' : 'after';
};

export function checkout() {
  if (Math.random() < 0.5) {
    const items = Array.from({ length: between(1, 3) }, () => ({ productId: between(1, 20000), quantity: between(1, 2) }));
    const roll = Math.random();
    const couponCode = roll < 0.02 ? 'BACK2SCHOOL' : roll < 0.12 ? pick(VALID_COUPONS) : undefined;
    const paymentToken = Math.random() < 0.02 ? 'tok_chargeDeclined' : `tok_${pick(ISSUERS)}_${randomId()}`;
    const order = JSON.stringify({ customerId: between(1, 50000), items, paymentToken, ...(couponCode ? { couponCode } : {}) });
    const idempotencyKey = uuid();
    const startedIn = phase();

    let answered = false;
    for (let attempt = 0; attempt < ATTEMPTS && !answered; attempt++) {
      const response = http.post(`${BASE_URL}/api/orders`, order, {
        headers: { 'Content-Type': 'application/json', 'Accept-Encoding': 'gzip, deflate', 'Idempotency-Key': idempotencyKey },
        tags: { name: 'POST /api/orders' },
        timeout: '2s',
        // Orders, and refusals: sold-out product (409), expired coupon (400), declined card (402).
        responseCallback: http.expectedStatuses(200, 201, 400, 402, 409),
      });
      const retryAfter = Number(response.headers['Retry-After']);
      const retry = response.status === 0 || response.status >= 500 || Number.isFinite(retryAfter);
      if (!retry) answered = true;
      else if (attempt < ATTEMPTS - 1) sleep(Math.max(Number.isFinite(retryAfter) ? retryAfter : 0, BACKOFF_SECONDS[attempt] ?? 2));
    }
    checkoutsFailed.add(!answered, { phase: startedIn });
  } else {
    http.get(`${BASE_URL}/api/orders/${between(1, 484000)}`, params('GET /api/orders/:id'));
  }
}

export function account() {
  http.get(`${BASE_URL}/api/customers/${between(1, 50000)}/orders?limit=20`, params('GET /api/customers/:id/orders'));
}

/** Finance exports a random 1–4 week window of H1 2026. */
export function reports() {
  const days = between(7, 31);
  const offset = between(0, 181 - days);
  const from = new Date(Date.UTC(2026, 0, 1 + offset));
  const to = new Date(Date.UTC(2026, 0, offset + days));
  http.get(`${BASE_URL}/api/reports/sales?from=${isoDay(from)}&to=${isoDay(to)}`, params('GET /api/reports/sales'));
}

/** Googlebot follows the product links of the Shopping feed. */
export function crawler() {
  http.get(`${BASE_URL}/api/products/${between(1, 20000)}`, {
    headers: {
      'Accept-Encoding': 'gzip, deflate',
      'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    },
    tags: { name: 'GET /api/products/:id' },
    timeout: '10s',
  });
}

/** TaxRate's database fails over (an internal port, not part of the API). */
export function failover() {
  http.post('http://taxrate:9000/failover?seconds=10', null, { tags: { name: 'TaxRate failover' } });
}

export function handleSummary(data: unknown) {
  if (MODE !== 'verify') return {};
  return { [__ENV.SUMMARY_PATH ?? '/results/summary.json']: JSON.stringify(data, null, 2) };
}
