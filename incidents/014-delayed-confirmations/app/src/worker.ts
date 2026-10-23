// The worker: reads the order-events topic and sends each order's confirmation
// email through MailWave. Runs as its own service, from the same code as the API.
import { Counter, Histogram } from 'prom-client';
import { sendOrderConfirmation } from './notifications/order-confirmation.ts';
import type { OrderPlaced } from './orders/order-events.ts';
import { findCustomer, markConfirmationSent } from './orders/orders.repository.ts';
import { config } from './platform/config.ts';
import { pool } from './platform/db.ts';
import { kafka, ORDER_EVENTS_TOPIC } from './platform/kafka.ts';
import { logger } from './platform/logger.ts';
import { registry, startMetricsServer } from './telemetry/metrics.ts';

const confirmationsSent = new Counter({
  name: 'order_confirmations_sent_total',
  help: 'Order confirmation emails accepted by MailWave.',
  registers: [registry],
});

const confirmationFailures = new Counter({
  name: 'order_confirmation_failures_total',
  help: 'Order confirmation emails that could not be sent, even after retries.',
  registers: [registry],
});

const confirmationDelay = new Histogram({
  name: 'order_confirmation_delay_seconds',
  help: 'Time from an order being placed to its confirmation email being accepted by MailWave.',
  buckets: [0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600, 1800, 3600],
  registers: [registry],
});

const metricsServer = startMetricsServer(config.metricsPort);
const consumer = kafka.consumer({ groupId: 'order-confirmations' });

/** Sends one order's confirmation email, and records that it went out. */
async function confirm(event: OrderPlaced): Promise<void> {
  const customer = await findCustomer(event.customerId);
  if (!customer) return;
  await sendOrderConfirmation({
    orderId: event.orderId,
    to: customer.email,
    customerName: customer.name,
    total: event.total,
    itemCount: event.itemCount,
  });
  await markConfirmationSent(event.orderId);
  confirmationsSent.inc();
  confirmationDelay.observe((Date.now() - Date.parse(event.placedAt)) / 1000);
}

await consumer.connect();
await consumer.subscribe({ topic: ORDER_EVENTS_TOPIC, fromBeginning: true });
await consumer.run({
  // Each message is handled when the previous one is done, and its offset committed.
  eachMessage: async ({ message }) => {
    const event = JSON.parse(message.value?.toString() ?? '{}') as OrderPlaced;
    try {
      await confirm(event);
    } catch (err) {
      // MailWave was retried already; one email isn't worth stopping the others for.
      confirmationFailures.inc();
      logger.error({ err, orderId: event.orderId }, 'order confirmation email could not be sent');
    }
  },
});
logger.info({ topic: ORDER_EVENTS_TOPIC, groupId: 'order-confirmations' }, 'worker consuming');

let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'worker shutting down');
  setTimeout(() => process.exit(1), 8_000).unref();
  await consumer.disconnect();
  metricsServer.close();
  await pool.end();
  process.exit(0);
}
process.on('SIGTERM', (signal) => void shutdown(signal));
process.on('SIGINT', (signal) => void shutdown(signal));
