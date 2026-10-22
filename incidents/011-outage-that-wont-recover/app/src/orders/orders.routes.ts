import express from 'express';
import { badRequest, notFound } from '../shared/http-errors.ts';
import { positiveInt } from '../shared/validation.ts';
import { getOrder, parseNewOrder, placeOrder } from './orders.service.ts';

export const ordersRouter = express.Router();

ordersRouter.post('/', async (req, res) => {
  const order = await placeOrder(parseNewOrder(req.body), idempotencyKey(req));
  res.status(201).location(`/api/orders/${order.id}`).json(order);
});

/** The app sends the same Idempotency-Key with every attempt of a checkout. */
function idempotencyKey(req: express.Request): string | undefined {
  const key = req.get('Idempotency-Key');
  if (key === undefined) return undefined;
  if (!/^[\w-]{8,128}$/.test(key)) throw badRequest('Idempotency-Key must be 8 to 128 letters, digits, "-" or "_"');
  return key;
}

ordersRouter.get('/:id', async (req, res) => {
  const order = await getOrder(positiveInt(req.params.id, 'id'));
  if (!order) throw notFound('order');
  res.json(order);
});
