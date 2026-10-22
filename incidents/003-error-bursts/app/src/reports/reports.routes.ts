import express from 'express';
import { badRequest } from '../shared/http-errors.ts';
import { isoDate } from '../shared/validation.ts';
import { buildSalesReport } from './sales-report.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RANGE_DAYS = 92;

export const reportsRouter = express.Router();

/** GET /api/reports/sales?from=2026-06-01&to=2026-06-30 (both days inclusive) → CSV download. */
reportsRouter.get('/sales', async (req, res) => {
  const from = isoDate(req.query.from, 'from');
  const lastDay = isoDate(req.query.to, 'to');
  if (lastDay < from) throw badRequest('to must not be before from');

  const days = (lastDay.getTime() - from.getTime()) / DAY_MS + 1;
  if (days > MAX_RANGE_DAYS) throw badRequest(`a report can cover at most ${MAX_RANGE_DAYS} days`);

  const csv = await buildSalesReport({ from, to: new Date(lastDay.getTime() + DAY_MS) });
  res
    .type('text/csv')
    .attachment(`sales-${req.query.from}-to-${req.query.to}.csv`)
    .send(csv);
});
