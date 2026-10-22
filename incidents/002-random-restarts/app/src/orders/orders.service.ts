import { transaction } from '../platform/db.ts';
import { badRequest, notFound } from '../shared/http-errors.ts';
import { formatMoney } from '../shared/money.ts';
import { positiveInt } from '../shared/validation.ts';
import { customerExists, findOrder, findPrices, insertOrder, listOrderItems } from './orders.repository.ts';

const MAX_LINE_ITEMS = 10;
const MAX_QUANTITY = 10;

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
  const orderId = await transaction(async (client) => {
    if (!(await customerExists(input.customerId, client))) throw notFound('customer');

    const prices = await findPrices([...new Set(input.items.map((item) => item.productId))], client);
    const items = input.items.map((item) => {
      const unitPriceCents = prices.get(item.productId);
      if (unitPriceCents === undefined) throw badRequest(`product ${item.productId} does not exist`);
      return { ...item, unitPriceCents };
    });
    const totalCents = items.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0);

    return insertOrder({ customerId: input.customerId, totalCents, items }, client);
  });

  const order = await getOrder(orderId);
  if (!order) throw new Error(`order ${orderId} vanished after insert`);
  return order;
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
