import { config } from '../platform/config.ts';
import { callService } from '../platform/http-client.ts';

// Generous on purpose: the data team's dashboard shows an inference p99 under 40 ms.
const TIMEOUT_MS = 30_000;

/** "Customers also bought": product ids from the Recommendations service, best match first. */
export async function customersAlsoBought(productId: number, limit: number): Promise<number[]> {
  const response = await callService(
    'recommendations',
    `${config.recommendationsUrl}/v1/products/${productId}/recommendations?limit=${limit}`,
    { signal: AbortSignal.timeout(TIMEOUT_MS) },
  );
  if (!response.ok) throw new Error(`Recommendations answered ${response.status}`);
  const { items } = (await response.json()) as { items: { productId: number }[] };
  return items.map((item) => item.productId);
}
