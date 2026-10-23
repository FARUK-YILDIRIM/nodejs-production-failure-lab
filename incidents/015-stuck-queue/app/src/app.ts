import compression from 'compression';
import express from 'express';
import { catalogRouter } from './catalog/catalog.routes.ts';
import { customersRouter } from './customers/customers.routes.ts';
import { ordersRouter } from './orders/orders.routes.ts';
import { errorHandler, notFoundHandler } from './platform/error-handler.ts';
import { healthRouter } from './platform/health.routes.ts';
import { closeConnectionsWhileDraining } from './platform/lifecycle.ts';
import { requestTelemetry } from './platform/request-telemetry.ts';
import { reportsRouter } from './reports/reports.routes.ts';

export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');

  app.use(closeConnectionsWhileDraining);
  app.use(healthRouter);
  app.use(requestTelemetry());
  app.use(compression());
  app.use(express.json({ limit: '100kb' }));

  app.use('/api', catalogRouter);
  app.use('/api/orders', ordersRouter);
  app.use('/api/customers', customersRouter);
  app.use('/api/reports', reportsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
