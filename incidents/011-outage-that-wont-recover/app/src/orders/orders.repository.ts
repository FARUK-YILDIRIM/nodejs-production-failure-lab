import type pg from 'pg';
import { query } from '../platform/db.ts';

export interface Order {
  id: number;
  customerId: number;
  status: string;
  totalCents: number;
  taxCents: number;
  discountCents: number;
  couponCode: string | null;
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
    `SELECT id, customer_id AS "customerId", status, total_cents AS "totalCents", tax_cents AS "taxCents",
            discount_cents AS "discountCents", coupon_code AS "couponCode", created_at AS "createdAt"
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

export interface HistoryItem extends OrderItem {
  orderId: number;
  categorySlug: string;
}

/** The line items of several orders at once, with their product's category. */
export function listItemsForOrders(orderIds: number[]): Promise<HistoryItem[]> {
  return query<HistoryItem>(
    'orders.items-for-orders',
    `SELECT i.order_id AS "orderId", i.product_id AS "productId", p.sku, p.name, i.quantity,
            i.unit_price_cents AS "unitPriceCents", c.slug AS "categorySlug"
       FROM order_items i
       JOIN products p ON p.id = i.product_id
       JOIN categories c ON c.id = p.category_id
      WHERE i.order_id = ANY($1::int[])
      ORDER BY i.order_id, i.id`,
    [orderIds],
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

export interface Customer {
  id: number;
  email: string;
  name: string;
  country: string;
}

export async function findCustomer(customerId: number): Promise<Customer | undefined> {
  const [customer] = await query<Customer>('customers.by-id', 'SELECT id, email, name, country FROM customers WHERE id = $1', [
    customerId,
  ]);
  return customer;
}

export async function customerExists(customerId: number, client?: pg.PoolClient): Promise<boolean> {
  const rows = await query('customers.exists', 'SELECT 1 FROM customers WHERE id = $1', [customerId], client);
  return rows.length > 0;
}

export async function findPrices(productIds: number[], client?: pg.PoolClient): Promise<Map<number, number>> {
  const rows = await query<{ id: number; priceCents: number }>(
    'products.prices',
    'SELECT id, price_cents AS "priceCents" FROM products WHERE id = ANY($1::int[])',
    [productIds],
    client,
  );
  return new Map(rows.map((row) => [row.id, row.priceCents]));
}

export async function insertOrder(
  order: {
    customerId: number;
    totalCents: number;
    taxCents: number;
    discountCents: number;
    couponCode: string | null;
    paymentId: string;
    idempotencyKey: string | null;
    items: { productId: number; quantity: number; unitPriceCents: number }[];
  },
  client: pg.PoolClient,
): Promise<number> {
  const [inserted] = await query<{ id: number }>(
    'orders.insert',
    `INSERT INTO orders (customer_id, status, total_cents, tax_cents, discount_cents, coupon_code, payment_id, idempotency_key)
     VALUES ($1, 'paid', $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      order.customerId,
      order.totalCents,
      order.taxCents,
      order.discountCents,
      order.couponCode,
      order.paymentId,
      order.idempotencyKey,
    ],
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

/** The order a customer's checkout with this Idempotency-Key already placed, if any. */
export async function findOrderIdByIdempotencyKey(customerId: number, idempotencyKey: string): Promise<number | undefined> {
  const [order] = await query<{ id: number }>(
    'orders.by-idempotency-key',
    'SELECT id FROM orders WHERE customer_id = $1 AND idempotency_key = $2',
    [customerId, idempotencyKey],
  );
  return order?.id;
}

export interface Coupon {
  code: string;
  percentOff: number;
  expiresAt: Date;
  maxRedemptions: number | null;
  redemptions: number;
}

/** Reads a coupon and locks its row until the transaction ends. */
export async function lockCoupon(code: string, client: pg.PoolClient): Promise<Coupon | undefined> {
  const [coupon] = await query<Coupon>(
    'coupons.lock',
    `SELECT code, percent_off AS "percentOff", expires_at AS "expiresAt",
            max_redemptions AS "maxRedemptions", redemptions
       FROM coupons
      WHERE code = $1
        FOR UPDATE`,
    [code],
    client,
  );
  return coupon;
}

export async function redeemCoupon(code: string, client: pg.PoolClient): Promise<void> {
  await query('coupons.redeem', 'UPDATE coupons SET redemptions = redemptions + 1 WHERE code = $1', [code], client);
}

/**
 * Takes `quantity` units if at least that many are left. The row lock lasts only
 * until the surrounding transaction commits, a few milliseconds later.
 */
export async function reserveStock(item: { productId: number; quantity: number }, client: pg.PoolClient): Promise<boolean> {
  const rows = await query(
    'products.reserve-stock',
    'UPDATE products SET stock = stock - $2 WHERE id = $1 AND stock >= $2 RETURNING id',
    [item.productId, item.quantity],
    client,
  );
  return rows.length > 0;
}

export async function findCoupon(code: string): Promise<Coupon | undefined> {
  const [coupon] = await query<Coupon>(
    'coupons.by-code',
    `SELECT code, percent_off AS "percentOff", expires_at AS "expiresAt",
            max_redemptions AS "maxRedemptions", redemptions
       FROM coupons
      WHERE code = $1`,
    [code],
  );
  return coupon;
}
