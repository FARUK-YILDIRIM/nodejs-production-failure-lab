import { config } from '../platform/config.ts';
import { callService } from '../platform/http-client.ts';

export interface TaxQuote {
  rateBasisPoints: number;
  taxCents: number;
}

// A quote normally takes well under 100 ms. If TaxRate doesn't answer within a
// second, or answers with an error, ask again: a blip at TaxRate shouldn't fail
// the customer's checkout.
const ATTEMPTS = 4;
const TIMEOUT_MS = 1_000;

/**
 * Sales tax / VAT for an order, from TaxRate.
 *
 * Uses the shared HTTP client, which keeps connections to TaxRate open and
 * reuses them: a DNS lookup and a TCP handshake only happen when a new
 * connection is needed, not on every quote. It also closes idle connections
 * before TaxRate does (it reads the server's Keep-Alive timeout), which is
 * what caused the ECONNRESET errors of #596.
 */
export async function quoteTax(request: { country: string; amountCents: number }): Promise<TaxQuote> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const response = await callService('taxrate', new URL('/v1/quotes', config.taxrateUrl).href, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (response.ok) return (await response.json()) as TaxQuote;
      lastError = new Error(`TaxRate responded ${response.status}: ${await response.text()}`);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}
