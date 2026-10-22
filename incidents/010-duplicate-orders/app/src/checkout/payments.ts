import { config } from '../platform/config.ts';
import { callService } from '../platform/http-client.ts';
import { paymentRequired } from '../shared/http-errors.ts';

export interface Authorization {
  id: string;
  amountCents: number;
}

const headers = (idempotencyKey?: string) => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${config.paymentsApiKey}`,
  ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
});

/** Holds the amount on the customer's card with PayFlow. Throws 402 when the card is declined. */
export async function authorizePayment(request: {
  amountCents: number;
  paymentToken: string;
  idempotencyKey: string;
}): Promise<Authorization> {
  const response = await callService('payments', `${config.paymentsUrl}/v1/authorizations`, {
    method: 'POST',
    headers: headers(request.idempotencyKey),
    body: JSON.stringify({ amountCents: request.amountCents, currency: 'USD', paymentToken: request.paymentToken }),
  });
  if (response.status === 402) throw paymentRequired('the card was declined');
  if (!response.ok) throw new Error(`PayFlow responded ${response.status}: ${await response.text()}`);
  return (await response.json()) as Authorization;
}

/** Releases a hold that won't be captured. */
export async function voidPayment(authorizationId: string): Promise<void> {
  const response = await callService('payments', `${config.paymentsUrl}/v1/authorizations/${authorizationId}/void`, {
    method: 'POST',
    headers: headers(),
  });
  if (!response.ok) throw new Error(`PayFlow responded ${response.status} when voiding ${authorizationId}`);
}
