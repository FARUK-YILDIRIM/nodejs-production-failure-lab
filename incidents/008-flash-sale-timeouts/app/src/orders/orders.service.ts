import { randomUUID } from 'node:crypto';
import { Counter } from 'prom-client';
import { authorizePayment } from '../checkout/payments.ts';
import { quoteTax } from '../checkout/tax.ts';
import { sendOrderConfirmation } from '../notifications/order-confirmation.ts';
import { transaction } from '../platform/db.ts';
import { logger } from '../platform/logger.ts';
import { badRequest, conflict, notFound } from '../shared/http-errors.ts';
import { formatMoney } from '../shared/money.ts';
import { positiveInt } from '../shared/validation.ts';
import { registry } from '../telemetry/metrics.ts';
import {
  decrementStock,
  findCustomer,
  findOrder,
  findPrices,
  insertOrder,
  listOrderItems,
  lockCoupon,
  lockStock,
  redeemCoupon,
  type Coupon,
} from './orders.repository.ts';

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
  couponCode?: string;
  /** Card token from PayFlow's payment form. */
  paymentToken: string;
}

export function parseNewOrder(body: unknown): NewOrder {
  if (typeof body !== 'object' || body === null) throw badRequest('body must be a JSON object');
  const { customerId, items, couponCode, paymentToken } = body as {
    customerId?: unknown;
    items?: unknown;
    couponCode?: unknown;
    paymentToken?: unknown;
  };

  if (!Array.isArray(items) || items.length === 0) throw badRequest('items must be a non-empty array');
  if (items.length > MAX_LINE_ITEMS) throw badRequest(`an order can have at most ${MAX_LINE_ITEMS} line items`);
  if (couponCode !== undefined && (typeof couponCode !== 'string' || !/^[A-Za-z0-9]{3,32}$/.test(couponCode))) {
    throw badRequest('couponCode must be 3 to 32 letters or digits');
  }
  if (typeof paymentToken !== 'string' || !/^tok_\w{1,64}$/.test(paymentToken)) {
    throw badRequest('paymentToken must be a PayFlow card token (tok_…)');
  }

  return {
    customerId: positiveInt(customerId, 'customerId'),
    ...(couponCode === undefined ? {} : { couponCode: couponCode.toUpperCase() }),
    paymentToken,
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

  // One transaction for the coupon and the order: the coupon row stays locked
  // until the order is written, so a limited coupon can't be used twice.
  // transaction() rolls back and returns the connection to the pool on every
  // path, including the early "invalid coupon" exit.
  const orderId = await transaction(async (client) => {
    // Lock the products being bought until the order is written: two customers
    // can never both get the last unit of a doorbuster.
    const stock = await lockStock([...new Set(items.map((item) => item.productId))], client);
    for (const item of items) {
      if ((stock.get(item.productId) ?? 0) < item.quantity) throw conflict(`product ${item.productId} is out of stock`);
    }

    let discountCents = 0;
    if (input.couponCode) {
      const coupon = await lockCoupon(input.couponCode, client);
      if (!coupon || !isRedeemable(coupon)) throw badRequest(`coupon ${input.couponCode} is not valid`);
      discountCents = Math.round((subtotalCents * coupon.percentOff) / 100);
      await redeemCoupon(coupon.code, client);
    }

    const { taxCents } = await quoteTax({ country: customer.country, amountCents: subtotalCents - discountCents });
    const totalCents = subtotalCents - discountCents + taxCents;

    // Charge while the stock is reserved; a declined card rolls everything back.
    const authorization = await authorizePayment({
      amountCents: totalCents,
      paymentToken: input.paymentToken,
      idempotencyKey: randomUUID(),
    });
    await decrementStock(items, client);
    return insertOrder(
      {
        customerId: input.customerId,
        totalCents,
        taxCents,
        discountCents,
        couponCode: input.couponCode ?? null,
        paymentId: authorization.id,
        items,
      },
      client,
    );
  });

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

function isRedeemable(coupon: Coupon): boolean {
  if (coupon.expiresAt <= new Date()) return false;
  return coupon.maxRedemptions === null || coupon.redemptions < coupon.maxRedemptions;
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
    discount: formatMoney(order.discountCents),
    discountCents: order.discountCents,
    couponCode: order.couponCode,
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
