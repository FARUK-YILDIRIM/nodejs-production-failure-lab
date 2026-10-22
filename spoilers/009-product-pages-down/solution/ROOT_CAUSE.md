# Incident 009 · Root cause

> ⚠️ Spoilers. Read this after `./lab verify 009` passes, or once you've decided to stop.

## In one sentence

Since model v7, Recommendations takes 8 to 20 seconds for the one product in ten it has no precomputed vector for. A few of those requests per second keep all 8 of its workers busy, so every other request waits in its queue too. Since 2.24.0, a product page can't be shown without an answer from Recommendations, and waits up to 30 s for one: product pages hang for every shopper, for a feature the page could do without.

## What happens

```ts
// catalog/recommendations.ts (2.24.0)
const TIMEOUT_MS = 30_000;   // "generous on purpose": the data team's inference p99 is under 40 ms
const response = await callService('recommendations', url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
if (!response.ok) throw …    // no answer, no page

// catalog/catalog.routes.ts
const [relatedIds, purchases] = await Promise.all([customersAlsoBought(product.id, 4), countPurchases(product.id)]);
```

1. Product pages ask Recommendations for "Customers also bought", about 30 times per second.
2. About 3 of these per second are for products without a precomputed vector. Recommendations computes it on the fly, which takes one of its 8 workers for 8 to 20 seconds. That's 25 to 60 busy workers needed, for 8 available.
3. All 8 workers are soon busy with slow requests, and the other requests, which need 20 ms of work each, queue behind them. The queue grows to hundreds of requests and nearly 30 seconds of waiting.
4. The API waits up to 30 s. Shoppers and Googlebot give up after 10 s: the edge records a 499 for the product page, and no 5xx.
5. Requests that wait longer than the API's 30 s are abandoned: the API closes the connection, and Recommendations stops working on them. That's the only thing limiting how long a slow request holds a worker. The queue settles at whatever wait makes a slow request hold its worker for the ~2 s that 8 workers can afford: about 28 s.
6. Meanwhile, the API holds a socket and a pending request for every product page still waiting: over a thousand open sockets, for pages nobody will ever see.

## The evidence chain

| Observation | Where | What it means |
|---|---|---|
| A third of all requests end in 499 at the edge, all of them product pages; no 5xx | *Requests per second by status*, Traefik metrics | Clients give up: something hangs. |
| The API's latency for product pages looks normal, but it counts only a few pages per second | *In-API latency*, request rate by route | Requests that never finish are never measured. |
| Over a thousand open TCP sockets in the API, at a constant request rate | *Active libuv resources* | The API is waiting on something, a lot of times over. |
| Calls to Recommendations take up to 30 s; ~10 % end in `error` | *Calls to other services* | Product pages wait for Recommendations, up to the API's timeout. |
| A product page trace: two queries of a few milliseconds, then the `GET` to `recommendations`, which outlives the page: the server span ends when the client leaves at 10 s, the call ~28 s after it started | Jaeger | The page's time is Recommendations' time. |
| `recs_workers_busy` = `recs_workers` = 8; `recs_queue_length` in the hundreds | Prometheus | Recommendations is saturated. |
| `recs_inference_duration_seconds` p99 under 40 ms, yet `recs_request_duration_seconds` p95 around 29 s | Prometheus | Answered requests spent their time waiting for a worker, not computing. Slow computations are never answered, so they never appear in the inference histogram. |
| Logs: "no precomputed vector for this product, computing it now", then "client went away, stopped computing" 30 s later | `./lab logs recommendations` | A few requests take seconds, and hold a worker until the API gives up. |

### Red herrings

- **"Recommendations is healthy, its dashboard says so."** Its histograms only count requests it answered. The slow ones are never answered.
- **"Too much traffic: Googlebot."** 30 requests per second at 20 ms each keep less than one of Recommendations' 8 workers busy. It's the few slow ones that fill every worker.
- **"More connections to Recommendations."** The API doesn't limit them: it already has a thousand. The queue is inside Recommendations.
- **"Retry the failed calls."** They already take 30 s to fail. A retry would add a request to the queue it's waiting in.

## Trigger vs. root cause

- **Root cause**: an optional feature on the page's critical path. The page waits for Recommendations longer than any shopper would, and can't be shown without it.
- **Trigger**: model v7, which made a tenth of the requests take seconds.
- **Why it wasn't caught**: in every test, Recommendations answered in milliseconds. A 30 s timeout looked generous because nobody compared it with how long a shopper waits, only with how long Recommendations usually takes.

Next: [FIX.md](FIX.md) and an example [POSTMORTEM.md](POSTMORTEM.md).
