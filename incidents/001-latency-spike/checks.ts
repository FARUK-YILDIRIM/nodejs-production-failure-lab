// Functional checks run by `./lab verify` before the load test. A fix must keep
// every endpoint returning exactly what the original service returned.
import { expect, expectBody, expectStatus, type Check } from '../../cli/src/lib/checks.ts';

interface Order {
  totalCents: number;
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
        'e16c0c2bf1680c16c47d6928fe8b92ecc9ead12d0a3fe17b816463ce9d718f76',
      ),
  },
  {
    name: 'GET /api/products/4242',
    run: async (api) =>
      expectBody(await api.get('/api/products/4242'), '23bfab23de2846246318dd76d8f16802b35871184503212061de34904360730d'),
  },
  {
    name: 'GET /api/products/999999 → 404',
    run: async (api) => expectStatus(await api.get('/api/products/999999'), 404),
  },
  {
    name: 'GET /api/orders/12345',
    run: async (api) =>
      expectBody(await api.get('/api/orders/12345'), '5f2856db131a6ea19c966911926e81fd227cc55db8236e2fbd5d77527538fc19'),
  },
  {
    name: 'POST /api/orders',
    run: async (api) => {
      const product = (await (await api.get('/api/products/4242')).json()) as { priceCents: number };
      const response = await api.post('/api/orders', { customerId: 4242, items: [{ productId: 4242, quantity: 2 }] });
      expectStatus(response, 201);
      const order = (await response.json()) as Order;
      expect(order.items.length === 1, 'the order should have exactly one line item');
      expect(order.totalCents === product.priceCents * 2, 'the order total should be 2 × the product price');
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
    name: 'GET /api/reports/sales (2 weeks)',
    run: async (api) => {
      const response = await api.get('/api/reports/sales?from=2026-02-02&to=2026-02-15');
      expect(response.headers.get('content-type')?.startsWith('text/csv'), 'the report should be served as text/csv');
      await expectBody(response, '49a1a32ea51e253a645cc36909fd4e9925f212cd4e01114a01e988ace70efff7');
    },
  },
  {
    name: 'GET /api/reports/sales (June)',
    run: async (api) =>
      expectBody(
        await api.get('/api/reports/sales?from=2026-06-01&to=2026-06-30'),
        '707c54d10c49e035a855d8b58b856f845ce9750fe9a70b6e91e8e42852eba231',
      ),
  },
  {
    name: 'GET /api/reports/sales with to < from → 400',
    run: async (api) => expectStatus(await api.get('/api/reports/sales?from=2026-03-10&to=2026-03-01'), 400),
  },
];
