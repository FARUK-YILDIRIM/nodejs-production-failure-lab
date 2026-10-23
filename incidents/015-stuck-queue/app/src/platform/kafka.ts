import { Kafka, logLevel } from 'kafkajs';
import { config } from './config.ts';
import { logger } from './logger.ts';

/** One message per order placed. The worker (src/worker.ts) sends the confirmation emails from it. */
export const ORDER_EVENTS_TOPIC = 'order-events';

const LEVELS = { [logLevel.ERROR]: 'error', [logLevel.WARN]: 'warn', [logLevel.INFO]: 'info', [logLevel.DEBUG]: 'debug' } as const;

export const kafka = new Kafka({
  clientId: config.service,
  brokers: config.kafkaBrokers,
  logLevel: logLevel.WARN,
  // kafkajs logs through pino, like the rest of the service.
  logCreator:
    () =>
    ({ namespace, level, log }) => {
      const { message, ...extra } = log;
      logger[LEVELS[level as keyof typeof LEVELS] ?? 'info']({ namespace, ...extra }, `kafka: ${message}`);
    },
});
