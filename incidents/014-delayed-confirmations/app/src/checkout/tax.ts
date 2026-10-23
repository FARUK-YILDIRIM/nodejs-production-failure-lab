import { setTimeout as sleep } from 'node:timers/promises';
import { config } from '../platform/config.ts';
import { callService } from '../platform/http-client.ts';

export interface TaxQuote {
  rateBasisPoints: number;
  taxCents: number;
}

// A quote normally takes well under 100 ms: after a second, that attempt failed.
const TIMEOUT_MS = 1_000;

// A retry helps when a request got lost, and hurts when TaxRate is overloaded:
// it's one more request in its queue, behind the one we gave up on, which TaxRate
// still computes. So: one retry at most, after a random pause, and only while
// retries stay under a tenth of the quotes we ask for.
const MAX_ATTEMPTS = 2;
const MAX_BACKOFF_MS = 250;

const retryBudget = {
  tokens: 10,
  /** Every quote earns a tenth of a retry, up to a reserve of 10. */
  earn() {
    this.tokens = Math.min(10, this.tokens + 0.1);
  },
  /** A retry spends a whole one. */
  spend(): boolean {
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  },
};

type Attempt = { quote: TaxQuote; error?: undefined } | { quote?: undefined; error: unknown; retryable: boolean };

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
  retryBudget.earn();
  for (let attempt = 1; ; attempt++) {
    const result = await askTaxRate(request);
    if (result.quote) return result.quote;
    if (!result.retryable || attempt >= MAX_ATTEMPTS || !retryBudget.spend()) throw result.error;
    // Full jitter: retries from many checkouts don't arrive at TaxRate all at once.
    await sleep(Math.random() * MAX_BACKOFF_MS);
  }
}

async function askTaxRate(request: { country: string; amountCents: number }): Promise<Attempt> {
  try {
    const response = await callService('taxrate', new URL('/v1/quotes', config.taxrateUrl).href, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.ok) return { quote: (await response.json()) as TaxQuote };
    // Server errors may go away on a second try; a request TaxRate rejects won't.
    const error = new Error(`TaxRate responded ${response.status}: ${await response.text()}`);
    return { error, retryable: response.status >= 500 };
  } catch (err) {
    return { error: err, retryable: true };
  }
}
