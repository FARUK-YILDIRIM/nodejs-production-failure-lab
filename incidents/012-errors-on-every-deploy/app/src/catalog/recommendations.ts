import { Counter } from 'prom-client';
import { config } from '../platform/config.ts';
import { callService } from '../platform/http-client.ts';
import { logger } from '../platform/logger.ts';
import { registry } from '../telemetry/metrics.ts';

// Recommendations are a nice-to-have: a product page must never wait long for them.
// Healthy, the service answers in ~20 ms; after 250 ms the page goes on without it.
const TIMEOUT_MS = 250;

const fallbacks = new Counter({
  name: 'recommendations_fallbacks_total',
  help: 'Product pages shown without "Customers also bought", because Recommendations failed or was too slow.',
  labelNames: ['reason'] as const,
  registers: [registry],
});

/**
 * "Customers also bought": product ids from the Recommendations service, best match
 * first, or `undefined` if it doesn't answer in time.
 */
export async function customersAlsoBought(productId: number, limit: number): Promise<number[] | undefined> {
  try {
    // The signal aborts the request itself, not just our wait for it: the connection
    // closes, and Recommendations stops working on a request nobody needs anymore.
    const response = await callService(
      'recommendations',
      `${config.recommendationsUrl}/v1/products/${productId}/recommendations?limit=${limit}`,
      { signal: AbortSignal.timeout(TIMEOUT_MS) },
    );
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Recommendations answered ${response.status}`);
    }
    const { items } = (await response.json()) as { items: { productId: number }[] };
    return items.map((item) => item.productId);
  } catch (err) {
    fallbacks.inc({ reason: err instanceof Error && err.name === 'TimeoutError' ? 'timeout' : 'error' });
    logger.debug({ err, productId }, 'no recommendations, showing the page without them');
    return undefined;
  }
}
