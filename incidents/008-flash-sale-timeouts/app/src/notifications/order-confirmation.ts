import { setTimeout as sleep } from 'node:timers/promises';
import { config } from '../platform/config.ts';
import { callService } from '../platform/http-client.ts';

export interface OrderConfirmation {
  orderId: number;
  to: string;
  customerName: string;
  total: string;
  itemCount: number;
}

const MAX_ATTEMPTS = 3;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

/**
 * Sends the order confirmation email through MailWave (transactional email provider).
 * Transient failures are retried with backoff; the idempotency key lets the
 * provider drop duplicates if a retry follows a request that actually went through.
 */
export async function sendOrderConfirmation(message: OrderConfirmation): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    let failure: string;
    try {
      const response = await callService('mailwave', `${config.mailwaveUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.mailwaveApiKey}`,
          'Idempotency-Key': `order-confirmation-${message.orderId}`,
        },
        body: JSON.stringify({
          to: message.to,
          template: 'order-confirmation',
          variables: {
            name: message.customerName,
            orderId: message.orderId,
            total: message.total,
            itemCount: message.itemCount,
          },
          metadata: { orderId: message.orderId },
        }),
      });
      if (response.ok) return;
      failure = `MailWave responded ${response.status}: ${await response.text()}`;
      if (!RETRYABLE_STATUSES.has(response.status)) throw new Error(failure);
    } catch (err) {
      if (!(err instanceof TypeError)) throw err; // fetch() throws TypeError on network errors
      failure = `MailWave unreachable: ${err.message}`;
    }

    if (attempt === MAX_ATTEMPTS) throw new Error(`${failure} (after ${attempt} attempts)`);
    await sleep(250 * 2 ** (attempt - 1));
  }
}
