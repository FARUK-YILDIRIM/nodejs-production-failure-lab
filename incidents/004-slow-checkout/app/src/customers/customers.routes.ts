import express from 'express';
import { customerExists, listCustomerOrders } from '../orders/orders.repository.ts';
import { notFound } from '../shared/http-errors.ts';
import { formatMoney } from '../shared/money.ts';
import { optionalIntInRange, positiveInt } from '../shared/validation.ts';

export const customersRouter = express.Router();

customersRouter.get('/:id/orders', async (req, res) => {
  const customerId = positiveInt(req.params.id, 'id');
  const limit = optionalIntInRange(req.query.limit, 'limit', { min: 1, max: 50, fallback: 10 });
  if (!(await customerExists(customerId))) throw notFound('customer');

  const orders = await listCustomerOrders(customerId, limit);
  res.json({
    items: orders.map((order) => ({ ...order, total: formatMoney(order.totalCents) })),
  });
});
