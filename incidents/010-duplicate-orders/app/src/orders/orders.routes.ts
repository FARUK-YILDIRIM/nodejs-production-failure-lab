import express from 'express';
import { notFound } from '../shared/http-errors.ts';
import { positiveInt } from '../shared/validation.ts';
import { getOrder, parseNewOrder, placeOrder } from './orders.service.ts';

export const ordersRouter = express.Router();

ordersRouter.post('/', async (req, res) => {
  const order = await placeOrder(parseNewOrder(req.body));
  res.status(201).location(`/api/orders/${order.id}`).json(order);
});

ordersRouter.get('/:id', async (req, res) => {
  const order = await getOrder(positiveInt(req.params.id, 'id'));
  if (!order) throw notFound('order');
  res.json(order);
});
