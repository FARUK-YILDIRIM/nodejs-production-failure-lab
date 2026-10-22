// Functional checks run by `./lab verify` before the load test. A fix must keep
// every endpoint returning exactly what the original service returned.
import { CheckFailure, expect, expectBody, expectStatus, sha256, type Check } from '../../cli/src/lib/checks.ts';

const MAILWAVE = `http://localhost:${process.env.LAB_PORT_MAILWAVE ?? 8025}`;

/** Product pages change as orders come in (the purchase counter); everything else must stay identical. */
async function expectProductPage(response: Response, expectedSha256: string): Promise<void> {
  expectStatus(response, 200);
  const { purchases, ...product } = (await response.json()) as { purchases?: unknown };
  expect(Number.isInteger(purchases) && (purchases as number) >= 0, 'the product page should show how many units were bought');
  expect(sha256(JSON.stringify(product)) === expectedSha256, 'the product page changed');
}

interface Order {
  totalCents: number;
  taxCents: number;
  items: { productId: number; quantity: number; unitPriceCents: number }[];
}

export const checks: Check[] = [
  {
    name: 'GET /health',
    run: async (api) => expectStatus(await api.get('/health'), 200),
  },
  {
    name: 'GET /api/categories',
    run: async (api) =>
      expectBody(await api.get('/api/categories'), '043bc095126c3715bf9b5c1f97d26deed01dea4bb6f9c1dfcd9473974dad1551'),
  },
  {
    name: 'GET /api/products?category=headphones&page=3',
    run: async (api) =>
      expectBody(
        await api.get('/api/products?category=headphones&page=3'),
        'ddb95a773828f4858005ed89f932013b287248ff75d9fbb04ded3b866690a663',
      ),
  },
  {
    name: 'GET /api/products/4242',
    run: async (api) =>
      expectProductPage(await api.get('/api/products/4242'), 'aec96554f527bfa48bdd33fb70cecc99b3b98b2eb820eebbd351b6084363174d'),
  },
  {
    name: 'Catalog responses are still cached',
    run: async (api) => {
      await (await api.get('/api/products?category=laptops&page=2')).arrayBuffer();
      const repeat = await api.get('/api/products?category=laptops&page=2');
      await repeat.arrayBuffer();
      expect(repeat.headers.get('x-cache') === 'HIT', 'a repeated catalog request should be served from the cache (X-Cache: HIT)');
    },
  },
  {
    name: 'Tracking parameters don\'t change a listing',
    run: async (api) =>
      expectBody(
        await api.get('/api/products?category=headphones&page=3&utm_source=facebook&utm_campaign=summer_sale&fbclid=IwAR0check'),
        'ddb95a773828f4858005ed89f932013b287248ff75d9fbb04ded3b866690a663',
      ),
  },
  {
    name: 'Tracking parameters don\'t change a product page',
    run: async (api) =>
      expectProductPage(
        await api.get('/api/products/4242?utm_source=facebook&fbclid=IwAR1check'),
        'aec96554f527bfa48bdd33fb70cecc99b3b98b2eb820eebbd351b6084363174d',
      ),
  },
  {
    name: 'GET /api/products/999999 → 404',
    run: async (api) => expectStatus(await api.get('/api/products/999999'), 404),
  },
  {
    name: 'GET /api/orders/12345',
    run: async (api) =>
      expectBody(await api.get('/api/orders/12345'), 'bc61ca99c8e8c010796ccd6681c51e67a91ea71e60fe6cc5bf79f07792ed0b91'),
  },
  {
    name: 'POST /api/orders',
    run: async (api) => {
      const product = (await (await api.get('/api/products/4242')).json()) as { priceCents: number };
      const response = await api.post('/api/orders', { customerId: 4242, items: [{ productId: 4242, quantity: 2 }] });
      expectStatus(response, 201);
      const order = (await response.json()) as Order;
      expect(order.items.length === 1, 'the order should have exactly one line item');
      expect(order.taxCents > 0, 'the order should include sales tax / VAT');
      expect(order.totalCents === product.priceCents * 2 + order.taxCents, 'the order total should be 2 × the product price + tax');
    },
  },
  {
    name: 'Placing an order sends a confirmation email',
    run: async (api) => {
      const response = await api.post('/api/orders', { customerId: 77, items: [{ productId: 7, quantity: 1 }] });
      expectStatus(response, 201);
      const { id } = (await response.json()) as { id: number };
      for (let attempt = 0; attempt < 20; attempt++) {
        const { items } = (await (await fetch(`${MAILWAVE}/v1/messages?orderId=${id}`)).json()) as { items: unknown[] };
        if (items.length > 0) return;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      throw new CheckFailure(`MailWave never received a confirmation email for order ${id}`);
    },
  },
  {
    name: 'POST /api/orders with 11 line items → 400',
    run: async (api) => {
      const items = Array.from({ length: 11 }, (_, index) => ({ productId: index + 1, quantity: 1 }));
      expectStatus(await api.post('/api/orders', { customerId: 4242, items }), 400);
    },
  },
  {
    name: 'GET /api/customers/77/orders',
    run: async (api) => {
      const response = await api.get('/api/customers/77/orders');
      expectStatus(response, 200);
      const { items } = (await response.json()) as { items: { createdAt: string }[] };
      expect(items.length > 0 && items.length <= 10, 'expected between 1 and 10 orders');
      const dates = items.map((order) => Date.parse(order.createdAt));
      expect(
        dates.every((date, index) => index === 0 || date <= (dates[index - 1] ?? date)),
        'orders should be sorted newest first',
      );
    },
  },
  {
    name: 'GET /api/customers/19852/orders?limit=25',
    run: async (api) => {
      const response = await api.get('/api/customers/19852/orders?limit=25');
      expectStatus(response, 200);
      const { items } = (await response.json()) as { items: { createdAt: string }[] };
      // Orders placed by today's traffic come first; the seeded history must be unchanged.
      const seeded = items.filter((order) => Date.parse(order.createdAt) < Date.parse('2026-07-01'));
      expect(seeded.length === 23, `expected the customer's 23 past orders, got ${seeded.length}`);
      expect(
        sha256(JSON.stringify(seeded)) === 'a7e2a9858c16d926232a7575c42b1e700f92fa34077bbed0c73b9c3783614c9e',
        'the order history changed',
      );
    },
  },
  {
    name: 'GET /api/reports/sales (2 weeks)',
    run: async (api) => {
      const response = await api.get('/api/reports/sales?from=2026-02-02&to=2026-02-15');
      expect(response.headers.get('content-type')?.startsWith('text/csv'), 'the report should be served as text/csv');
      await expectBody(response, 'dc0c8c74161a8b13a03909f6a432ceae2550f1e3dade9ec502ec60545360e9b5');
    },
  },
  {
    name: 'GET /api/reports/sales (June)',
    run: async (api) =>
      expectBody(
        await api.get('/api/reports/sales?from=2026-06-01&to=2026-06-30'),
        '250e43ffd091352a3bce88ffe7e699eb3a95566454ed38eb55a92e74886f95bb',
      ),
  },
  {
    name: 'GET /api/reports/sales with to < from → 400',
    run: async (api) => expectStatus(await api.get('/api/reports/sales?from=2026-03-10&to=2026-03-01'), 400),
  },
];
