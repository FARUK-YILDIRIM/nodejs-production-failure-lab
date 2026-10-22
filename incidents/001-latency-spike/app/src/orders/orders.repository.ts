import type pg from 'pg';
import { query } from '../platform/db.ts';

export interface Order {
  id: number;
  customerId: number;
  status: string;
  totalCents: number;
  createdAt: Date;
}

export interface OrderItem {
  productId: number;
  sku: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
}

export interface OrderSummary {
  id: number;
  status: string;
  totalCents: number;
  itemCount: number;
  createdAt: Date;
}

export async function findOrder(id: number, client?: pg.PoolClient): Promise<Order | undefined> {
  const [order] = await query<Order>(
    'orders.by-id',
    `SELECT id, customer_id AS "customerId", status, total_cents AS "totalCents", created_at AS "createdAt"
       FROM orders
      WHERE id = $1`,
    [id],
    client,
  );
  return order;
}

export function listOrderItems(orderId: number, client?: pg.PoolClient): Promise<OrderItem[]> {
  return query<OrderItem>(
    'orders.items',
    `SELECT i.product_id AS "productId", p.sku, p.name, i.quantity, i.unit_price_cents AS "unitPriceCents"
       FROM order_items i
       JOIN products p ON p.id = i.product_id
      WHERE i.order_id = $1
      ORDER BY i.id`,
    [orderId],
    client,
  );
}

export function listCustomerOrders(customerId: number, limit: number): Promise<OrderSummary[]> {
  return query<OrderSummary>(
    'orders.by-customer',
    `SELECT o.id, o.status, o.total_cents AS "totalCents", count(i.id)::int AS "itemCount", o.created_at AS "createdAt"
       FROM orders o
       JOIN order_items i ON i.order_id = o.id
      WHERE o.customer_id = $1
      GROUP BY o.id
      ORDER BY o.created_at DESC, o.id DESC
      LIMIT $2`,
    [customerId, limit],
  );
}

export async function customerExists(customerId: number, client?: pg.PoolClient): Promise<boolean> {
  const rows = await query('customers.exists', 'SELECT 1 FROM customers WHERE id = $1', [customerId], client);
  return rows.length > 0;
}

export async function findPrices(productIds: number[], client: pg.PoolClient): Promise<Map<number, number>> {
  const rows = await query<{ id: number; priceCents: number }>(
    'products.prices',
    'SELECT id, price_cents AS "priceCents" FROM products WHERE id = ANY($1::int[])',
    [productIds],
    client,
  );
  return new Map(rows.map((row) => [row.id, row.priceCents]));
}

export async function insertOrder(
  order: { customerId: number; totalCents: number; items: { productId: number; quantity: number; unitPriceCents: number }[] },
  client: pg.PoolClient,
): Promise<number> {
  const [inserted] = await query<{ id: number }>(
    'orders.insert',
    `INSERT INTO orders (customer_id, status, total_cents) VALUES ($1, 'paid', $2) RETURNING id`,
    [order.customerId, order.totalCents],
    client,
  );
  if (!inserted) throw new Error('INSERT INTO orders returned no row');

  await query(
    'orders.insert-items',
    `INSERT INTO order_items (order_id, product_id, quantity, unit_price_cents)
     SELECT $1, product_id, quantity, unit_price_cents
       FROM unnest($2::int[], $3::int[], $4::int[]) AS t(product_id, quantity, unit_price_cents)`,
    [
      inserted.id,
      order.items.map((item) => item.productId),
      order.items.map((item) => item.quantity),
      order.items.map((item) => item.unitPriceCents),
    ],
    client,
  );
  return inserted.id;
}
