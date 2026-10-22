# Incident 009 · Fix

## 1. Mitigate first (minutes)

- **Take Recommendations off the page**: a hotfix that always shows "more from this category" (the query from before 2.24.0). Product pages come back at once. Shoppers lose "Customers also bought" everywhere, which is still better than losing product pages.
- **Don't retry, and don't wait longer.** Every extra request joins the queue that is the problem.
- **Ask the data team for more workers**, if they can add them. The slow requests need 25 to 60 busy workers; more workers shorten the queue, but don't remove it.

## 2. Fix: a nice-to-have gets a short leash

[`fix.patch`](../fix.patch) (`git apply spoilers/009-product-pages-down/fix.patch`):

1. **A timeout from the page's budget, not from the dependency's usual latency.** Healthy, Recommendations answers in ~20 ms; a product page should answer within a few hundred. After 250 ms, the page goes on without it.
2. **A timeout that cancels the request.** `AbortSignal.timeout()` aborts the request itself: the connection closes, and Recommendations stops working on a request nobody waits for anymore. Its slow requests now hold a worker for 250 ms instead of up to 30 s, and the queue disappears.
3. **A fallback.** Without an answer in time, the page shows more products from the same category, as it did before 2.24.0. A counter (`recommendations_fallbacks_total{reason}`) shows how often that happens.

### Measured with `./lab verify 009`

Apple Silicon laptop, Docker Desktop with 2 vCPUs, ~66 req/s including ~35 product pages per second. Clients give up after 10 s. After: four runs.

| | Before | After |
|---|---|---|
| Product pages p95 | 10 s (clients give up) | 270–330 ms |
| Catalog p95 (listings and product pages) | 10 s | 130–270 ms |
| Error rate | 47 % | 0 % |
| Product pages without "Customers also bought" | 97 % | 9–11 % |
| Recommendations: busy workers, queue | 8 of 8, ~800 waiting | ~1 of 8, none waiting |
| Open sockets in the API | ~1,100 | ~40 |

The ~10 % without recommendations are the products Recommendations has no vector for: their pages wait 250 ms, then show more products from the same category. That lasts until the data team has computed the missing vectors. It's their bug, and no longer your outage.

### Fixes that look right but aren't

| Attempt | What happens |
|---|---|
| `Promise.race([call, sleep(250)])` | The page answers in time, but the request goes on. Recommendations keeps computing every slow request until the 30 s timeout, stays saturated, and almost every call loses the race: nearly every page goes without "Customers also bought". |
| A short timeout, no fallback | The slow 10 % fail with 500 after 250 ms, instead of hanging. Errors instead of timeouts. |
| A fallback, with the 30 s timeout | Pages still wait 30 s before falling back. Shoppers have left by then. |
| A very short timeout (20 ms) | Healthy answers get cut off too, and pages lose their recommendations for nothing. |
| Retries | More requests in the same queue. Never retry a nice-to-have on the critical path, and never after a timeout. |

## 3. Alternatives and refinements

| Approach | Verdict |
|---|---|
| Load recommendations from the browser, after the page (a separate endpoint) | The best design for an optional widget: the product page no longer depends on Recommendations at all, and Googlebot never waits for it. A bigger change than tonight's fix. |
| Circuit breaker | When Recommendations is down entirely, stop calling it for a while: pages don't pay the 250 ms each time, and it gets room to recover. With 90 % of requests still fine, a breaker would rarely open here. |
| Cache recommendations per product (minutes to hours), serve stale ones when it's slow | Fewer calls, and suggestions even during an outage, for products seen recently. |
| Limit concurrent calls to Recommendations (bulkhead) | Bounds what the API spends on a dependency that hangs: sockets, memory, pending requests. Fail fast beyond the limit. |
| Propagate cancellation | When a client gives up, abort the downstream calls it started (`req` `close` → `AbortController`). Before the fix, the API waited up to 30 s for pages nobody would see. |

## 4. Prevent

- **Every outbound call gets a timeout derived from its caller's budget.** "The dependency usually answers in 20 ms" tells you nothing about how long your page can wait.
- **Classify dependencies as critical or optional.** Optional ones need a fallback, and a test where the dependency is slow, not just down.
- **Watch dependencies from your side**: latency, errors and timeouts per peer, and requests still in flight. A dependency's own dashboard only shows what it finished.
- **Alert on clients giving up** (499s at the edge): a hanging service produces no errors.
- For the data team: measure time in the queue and worker saturation, not just inference time; give the slow path its own workers, or a deadline of its own.
