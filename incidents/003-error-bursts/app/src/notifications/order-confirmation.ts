import { config } from '../platform/config.ts';
import { callService } from '../platform/http-client.ts';

export interface OrderConfirmation {
  orderId: number;
  to: string;
  customerName: string;
  total: string;
  itemCount: number;
}

/** Sends the order confirmation email through MailWave (transactional email provider). */
export async function sendOrderConfirmation(message: OrderConfirmation): Promise<void> {
  const response = await callService('mailwave', `${config.mailwaveUrl}/v1/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.mailwaveApiKey}` },
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

  if (!response.ok) {
    throw new Error(`MailWave responded ${response.status}: ${await response.text()}`);
  }
}
