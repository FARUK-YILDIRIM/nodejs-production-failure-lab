// ShopFlow traffic model, shared by the background "production" traffic and `./lab verify`.
//
//   MODE=traffic  runs until the container is stopped
//   MODE=warmup   runs for DURATION and prints nothing
//   MODE=verify   runs for DURATION and writes the end-of-test summary to SUMMARY_PATH
//
// Every journey uses an open model (constant arrival rate): new requests keep
// arriving even when the API is slow, like real users do. A closed model would
// slow down with the server and hide the very latency we want to measure.
import http from 'k6/http';

const BASE_URL = __ENV.BASE_URL ?? 'http://traefik';
const MODE = __ENV.MODE ?? 'traffic';
const DURATION = __ENV.DURATION ?? '60s';

const JOURNEYS = {
  catalog: { rate: 45, timeUnit: '1s' }, // browsing products (up ~50% since the campaign started)
  checkout: { rate: 6, timeUnit: '1s' }, // placing and viewing orders
  account: { rate: 2, timeUnit: '1s' }, // order history
  reports: { rate: 1, timeUnit: '4s' }, // finance exports
};

const CATEGORIES = [
  'laptops', 'smartphones', 'tablets', 'headphones', 'smartwatches', 'cameras', 'monitors', 'keyboards',
  'mice', 'printers', 'routers', 'speakers', 'televisions', 'gaming-consoles', 'drones', 'e-readers',
  'chargers', 'cables', 'storage', 'smart-home', 'kitchen-appliances', 'coffee-machines', 'vacuum-cleaners',
  'lighting', 'furniture', 'office-chairs', 'desks', 'backpacks', 'luggage', 'running-shoes', 'sneakers',
  'jackets', 't-shirts', 'watches', 'sunglasses', 'fitness-trackers', 'yoga-gear', 'bicycles', 'camping-gear',
  'books',
];

export const options = {
  discardResponseBodies: true,
  scenarios: Object.fromEntries(
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
  // Per-journey sub-metrics only show up in the summary when a threshold references them.
  thresholds:
    MODE === 'verify'
      ? Object.fromEntries(
          Object.keys(JOURNEYS).flatMap((name) => [
            [`http_req_duration{journey:${name}}`, ['max>=0']],
            [`http_req_failed{journey:${name}}`, ['rate>=0']],
          ]),
        )
      : {},
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

const between = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1));
const pick = <T>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)] as T;
const isoDay = (date: Date) => date.toISOString().slice(0, 10);

// Most visitors arrive from the Summer Sale ads: the landing pages list 48 products,
// and every link carries tracking parameters, with a click id unique per click.
const CAMPAIGN_SHARE = 0.8;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
const clickId = () => `IwAR${Array.from({ length: 40 }, () => pick([...ALPHABET])).join('')}`;
const tracking = () => `utm_source=facebook&utm_medium=paid_social&utm_campaign=summer_sale&fbclid=${clickId()}`;

export function catalog() {
  const fromCampaign = Math.random() < CAMPAIGN_SHARE;
  const roll = Math.random();
  if (roll < 0.6) {
    const campaign = fromCampaign ? `&limit=48&${tracking()}` : '';
    http.get(`${BASE_URL}/api/products?category=${pick(CATEGORIES)}&page=${between(1, 5)}${campaign}`, {
      tags: { name: 'GET /api/products' },
    });
  } else if (roll < 0.95) {
    const campaign = fromCampaign ? `?${tracking()}` : '';
    http.get(`${BASE_URL}/api/products/${between(1, 20000)}${campaign}`, { tags: { name: 'GET /api/products/:id' } });
  } else {
    http.get(`${BASE_URL}/api/categories`, { tags: { name: 'GET /api/categories' } });
  }
}

export function checkout() {
  if (Math.random() < 0.5) {
    const items = Array.from({ length: between(1, 3) }, () => ({ productId: between(1, 20000), quantity: between(1, 2) }));
    http.post(`${BASE_URL}/api/orders`, JSON.stringify({ customerId: between(1, 50000), items }), {
      headers: { 'Content-Type': 'application/json' },
      tags: { name: 'POST /api/orders' },
    });
  } else {
    http.get(`${BASE_URL}/api/orders/${between(1, 120000)}`, { tags: { name: 'GET /api/orders/:id' } });
  }
}

export function account() {
  http.get(`${BASE_URL}/api/customers/${between(1, 50000)}/orders`, { tags: { name: 'GET /api/customers/:id/orders' } });
}

/** Finance exports a random 1–4 week window of H1 2026. */
export function reports() {
  const days = between(7, 31);
  const offset = between(0, 181 - days);
  const from = new Date(Date.UTC(2026, 0, 1 + offset));
  const to = new Date(Date.UTC(2026, 0, offset + days));
  http.get(`${BASE_URL}/api/reports/sales?from=${isoDay(from)}&to=${isoDay(to)}`, {
    tags: { name: 'GET /api/reports/sales' },
  });
}

export function handleSummary(data: unknown) {
  if (MODE !== 'verify') return {};
  return { [__ENV.SUMMARY_PATH ?? '/results/summary.json']: JSON.stringify(data, null, 2) };
}
