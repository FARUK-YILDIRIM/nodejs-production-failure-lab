import { kafka, ORDER_EVENTS_TOPIC } from '../platform/kafka.ts';

export interface OrderPlaced {
  orderId: number;
  customerId: number;
  total: string;
  itemCount: number;
  placedAt: string;
}

const producer = kafka.producer();
let connected: Promise<void> | undefined;

/** Publishes an `order placed` event to the order-events topic. */
export async function publishOrderPlaced(event: OrderPlaced): Promise<void> {
  connected ??= producer.connect();
  await connected;
  await producer.send({
    topic: ORDER_EVENTS_TOPIC,
    messages: [{ key: String(event.customerId), value: JSON.stringify(event) }],
  });
}

export async function disconnectProducer(): Promise<void> {
  if (connected) await producer.disconnect();
}
