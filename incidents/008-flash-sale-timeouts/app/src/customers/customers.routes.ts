import express from 'express';
import { customerExists } from '../orders/orders.repository.ts';
import { notFound } from '../shared/http-errors.ts';
import { optionalIntInRange, positiveInt } from '../shared/validation.ts';
import { orderHistory } from './order-history.ts';

export const customersRouter = express.Router();

customersRouter.get('/:id/orders', async (req, res) => {
  const customerId = positiveInt(req.params.id, 'id');
  const limit = optionalIntInRange(req.query.limit, 'limit', { min: 1, max: 50, fallback: 10 });
  if (!(await customerExists(customerId))) throw notFound('customer');

  res.json({ items: await orderHistory(customerId, limit) });
});
