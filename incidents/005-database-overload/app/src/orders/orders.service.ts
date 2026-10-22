import { Counter } from 'prom-client';
import { quoteTax } from '../checkout/tax.ts';
import { sendOrderConfirmation } from '../notifications/order-confirmation.ts';
import { transaction } from '../platform/db.ts';
import { logger } from '../platform/logger.ts';
import { badRequest, notFound } from '../shared/http-errors.ts';
import { formatMoney } from '../shared/money.ts';
import { positiveInt } from '../shared/validation.ts';
import { registry } from '../telemetry/metrics.ts';
import { findCustomer, findOrder, findPrices, insertOrder, listOrderItems } from './orders.repository.ts';

const MAX_LINE_ITEMS = 10;
const MAX_QUANTITY = 10;

const confirmationFailures = new Counter({
  name: 'order_confirmation_failures_total',
  help: 'Order confirmation emails that could not be sent, even after retries.',
  registers: [registry],
});

export interface NewOrder {
  customerId: number;
  items: { productId: number; quantity: number }[];
}

export function parseNewOrder(body: unknown): NewOrder {
  if (typeof body !== 'object' || body === null) throw badRequest('body must be a JSON object');
  const { customerId, items } = body as { customerId?: unknown; items?: unknown };

  if (!Array.isArray(items) || items.length === 0) throw badRequest('items must be a non-empty array');
  if (items.length > MAX_LINE_ITEMS) throw badRequest(`an order can have at most ${MAX_LINE_ITEMS} line items`);

  return {
    customerId: positiveInt(customerId, 'customerId'),
    items: items.map((item: { productId?: unknown; quantity?: unknown }, index) => {
      const quantity = positiveInt(item?.quantity, `items[${index}].quantity`);
      if (quantity > MAX_QUANTITY) throw badRequest(`items[${index}].quantity must be at most ${MAX_QUANTITY}`);
      return { productId: positiveInt(item?.productId, `items[${index}].productId`), quantity };
    }),
  };
}

export async function placeOrder(input: NewOrder) {
  const customer = await findCustomer(input.customerId);
  if (!customer) throw notFound('customer');

  const prices = await findPrices([...new Set(input.items.map((item) => item.productId))]);
  const items = input.items.map((item) => {
    const unitPriceCents = prices.get(item.productId);
    if (unitPriceCents === undefined) throw badRequest(`product ${item.productId} does not exist`);
    return { ...item, unitPriceCents };
  });
  const subtotalCents = items.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0);
  const { taxCents } = await quoteTax({ country: customer.country, amountCents: subtotalCents });

  const orderId = await transaction((client) =>
    insertOrder({ customerId: input.customerId, totalCents: subtotalCents + taxCents, taxCents, items }, client),
  );

  const order = await getOrder(orderId);
  if (!order) throw new Error(`order ${orderId} vanished after insert`);

  // Customers shouldn't wait for the email provider: confirm in the background.
  // Nothing awaits this promise, so it has to handle its own failure: an
  // unhandled rejection terminates the whole Node.js process.
  confirmOrder(order).catch((err: unknown) => {
    confirmationFailures.inc();
    logger.error({ err, orderId: order.id }, 'order confirmation email could not be sent');
  });
  return order;
}

async function confirmOrder(order: { id: number; customerId: number; total: string; items: unknown[] }): Promise<void> {
  const customer = await findCustomer(order.customerId);
  if (!customer) return;
  await sendOrderConfirmation({
    orderId: order.id,
    to: customer.email,
    customerName: customer.name,
    total: order.total,
    itemCount: order.items.length,
  });
}

export async function getOrder(id: number) {
  const order = await findOrder(id);
  if (!order) return undefined;

  const items = await listOrderItems(id);
  return {
    id: order.id,
    customerId: order.customerId,
    status: order.status,
    total: formatMoney(order.totalCents),
    totalCents: order.totalCents,
    tax: formatMoney(order.taxCents),
    taxCents: order.taxCents,
    createdAt: order.createdAt,
    items: items.map((item) => ({
      productId: item.productId,
      sku: item.sku,
      name: item.name,
      quantity: item.quantity,
      unitPrice: formatMoney(item.unitPriceCents),
      unitPriceCents: item.unitPriceCents,
    })),
  };
}
