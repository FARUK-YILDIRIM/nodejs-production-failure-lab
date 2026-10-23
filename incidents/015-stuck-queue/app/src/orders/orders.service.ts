import { randomUUID } from 'node:crypto';
import { authorizePayment, voidPayment } from '../checkout/payments.ts';
import { quoteTax } from '../checkout/tax.ts';
import { transaction } from '../platform/db.ts';
import { logger } from '../platform/logger.ts';
import { badRequest, conflict, notFound } from '../shared/http-errors.ts';
import { formatMoney } from '../shared/money.ts';
import { positiveInt } from '../shared/validation.ts';
import {
  findCoupon,
  findCustomer,
  findOrder,
  findOrderIdByIdempotencyKey,
  findPrices,
  insertOrder,
  listOrderItems,
  lockCoupon,
  redeemCoupon,
  reserveStock,
  type Coupon,
} from './orders.repository.ts';
import { publishOrderPlaced } from './order-events.ts';

const MAX_LINE_ITEMS = 10;
const MAX_QUANTITY = 10;

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

/**
 * Places an order. The app sends the same `idempotencyKey` with every attempt of a
 * checkout, so an attempt whose order already exists gets that order back.
 */
export async function placeOrder(input: NewOrder, idempotencyKey?: string) {
  if (idempotencyKey) {
    const placed = await findOrderIdByIdempotencyKey(input.customerId, idempotencyKey);
    if (placed !== undefined) return existingOrder(placed);
  }

  const customer = await findCustomer(input.customerId);
  if (!customer) throw notFound('customer');

  const prices = await findPrices([...new Set(input.items.map((item) => item.productId))]);
  const items = input.items.map((item) => {
    const unitPriceCents = prices.get(item.productId);
    if (unitPriceCents === undefined) throw badRequest(`product ${item.productId} does not exist`);
    return { ...item, unitPriceCents };
  });
  const subtotalCents = items.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0);

  // Price the order first, without taking any lock: the coupon is only read here,
  // and redeemed for real when the order is written.
  let discountCents = 0;
  if (input.couponCode) {
    const coupon = await findCoupon(input.couponCode);
    if (!coupon || !isRedeemable(coupon)) throw badRequest(`coupon ${input.couponCode} is not valid`);
    discountCents = Math.round((subtotalCents * coupon.percentOff) / 100);
  }
  const { taxCents } = await quoteTax({ country: customer.country, amountCents: subtotalCents - discountCents });
  const totalCents = subtotalCents - discountCents + taxCents;

  // The slow part (a few hundred milliseconds at the card network) happens
  // before any row is locked, so it can't make other checkouts wait.
  const authorization = await authorizePayment({
    amountCents: totalCents,
    paymentToken: input.paymentToken,
    // Every attempt of a checkout uses the same key at PayFlow, which answers a retry
    // with the first authorization instead of putting a second hold on the card.
    idempotencyKey: idempotencyKey ? `order-${input.customerId}-${idempotencyKey}` : randomUUID(),
  });

  let orderId: number;
  try {
    // Locks are now held for milliseconds: take the stock only where enough is
    // left (in product id order, so concurrent checkouts can't deadlock),
    // redeem the coupon, write the order.
    orderId = await transaction(async (client) => {
      for (const item of [...items].sort((a, b) => a.productId - b.productId)) {
        if (!(await reserveStock(item, client))) throw conflict(`product ${item.productId} is out of stock`);
      }
      if (input.couponCode) {
        const coupon = await lockCoupon(input.couponCode, client);
        if (!coupon || !isRedeemable(coupon)) throw badRequest(`coupon ${input.couponCode} is not valid`);
        await redeemCoupon(coupon.code, client);
      }
      return insertOrder(
        {
          customerId: input.customerId,
          totalCents,
          taxCents,
          discountCents,
          couponCode: input.couponCode ?? null,
          paymentId: authorization.id,
          idempotencyKey: idempotencyKey ?? null,
          items,
        },
        client,
      );
    });
  } catch (err) {
    // Another attempt of this checkout wrote its order first (the unique index stopped
    // this one): answer with that order. It holds this same authorization, so keep it.
    if (idempotencyKey) {
      const placed = await findOrderIdByIdempotencyKey(input.customerId, idempotencyKey);
      if (placed !== undefined) return existingOrder(placed);
    }
    // Nothing was sold: release the hold on the customer's card.
    await voidPayment(authorization.id).catch((voidErr: unknown) =>
      logger.error({ err: voidErr, authorizationId: authorization.id }, 'could not void the card authorization'),
    );
    throw err;
  }

  const order = await getOrder(orderId);
  if (!order) throw new Error(`order ${orderId} vanished after insert`);

  // The confirmation email is sent by the worker, from the order-events topic:
  // if MailWave is down, the event waits there instead of being lost.
  await publishOrderPlaced({
    orderId: order.id,
    customerId: order.customerId,
    total: order.total,
    itemCount: order.items.length,
    placedAt: new Date(order.createdAt).toISOString(),
  });
  return order;
}

async function existingOrder(id: number) {
  const order = await getOrder(id);
  if (!order) throw new Error(`order ${id} vanished`);
  return order;
}

function isRedeemable(coupon: Coupon): boolean {
  if (coupon.expiresAt <= new Date()) return false;
  return coupon.maxRedemptions === null || coupon.redemptions < coupon.maxRedemptions;
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
