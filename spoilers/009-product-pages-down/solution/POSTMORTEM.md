# Postmortem · Incident 009: Product pages down

> An example postmortem for this incident, in the lab's blameless format. Times are from the scenario.

## Summary

On Friday, December 4, from 17:10 to 18:55, product pages didn't load for shoppers or for Googlebot. Model v7 of Recommendations, shipped at 17:00, took 8 to 20 seconds for the one product in ten it had no precomputed vector for. These few requests filled all of its workers, and every other request queued behind them. Since 2.24.0, product pages waited up to 30 s for "Customers also bought" and couldn't be shown without it. Product pages now wait at most 250 ms for Recommendations, cancel the request after that, and show products from the same category instead.

## Impact

- **Customers**: for 1 h 45 min, in the busiest hour of the week, product pages didn't load. Listings, checkout and order history worked, but nobody could open a product.
- **Revenue**: orders ~60 % below a normal Friday evening during the outage.
- **Marketing**: Google Merchant Center flagged ~4,000 products as "Landing page unavailable"; their Shopping ads stayed paused until Saturday noon, when Google crawled them again.

## Timeline

| Time | Event |
|---|---|
| Tue, Dec 1 | v2.24.0: "Customers also bought" on product pages, from Recommendations. |
| Fri 17:00 | The data team ships Recommendations model v7. |
| 17:10 | Product pages start hanging; 499s at the edge. |
| 17:14 | `ClientsGivingUp` fires. No 5xx, and the API's latency for product pages looks normal: the edge proxy is suspected and restarted. No change. |
| 17:45 | The API holds over a thousand open sockets; product page traces show the call to Recommendations taking up to 30 s. |
| 18:00 | The data team: "our dashboard is green, inference p99 under 40 ms". |
| 18:30 | Recommendations' own metrics: 8 of 8 workers busy, ~800 requests queued. Its logs: on-the-fly vector computations, 8 to 20 s each. |
| 18:55 | **Mitigation**: hotfix that skips Recommendations; every product page shows products from the same category. Product pages are back. |
| 20:30 | **Fix** deployed: 250 ms timeout that cancels the request, with a fallback. "Customers also bought" is back for 90 % of products. |
| Sat 06:00 | The data team has computed the missing vectors; fallbacks drop to zero. |

Time to detect: 4 min. Time to mitigate: 1 h 45 min. Time to resolve: 3 h 20 min.

## Root cause

Product pages called Recommendations on their critical path, with a 30 s timeout and no fallback: an optional widget could hold the whole page for longer than any shopper waits. When Recommendations slowed down, so did every product page.

Model v7 made one request in ten take 8 to 20 seconds of a worker. Recommendations has 8 workers, so a few such requests per second kept all of them busy, and the other requests, which take 20 ms, waited behind them for up to 30 s. The only thing that freed a worker from a slow request was the API's timeout: the API's 30 s timeout set the length of the queue.

## Trigger

Recommendations model v7, which computes missing vectors on the fly.

## Evidence

1. Edge: a third of all requests ended in 499 (client gave up), all of them product pages; no 5xx.
2. The API's latency histogram only counted the pages it finished: product pages looked normal there.
3. API runtime: over a thousand open TCP sockets.
4. Calls to Recommendations: up to 30 s, 10 % ending in a timeout.
5. Recommendations: all 8 workers busy, hundreds of requests queued, answered requests taking ~29 s, of which ~20 ms inference.
6. Recommendations' logs: "no precomputed vector for this product, computing it now", then "client went away, stopped computing" 30 s later.

## Action items

| Type | Action | Owner |
|---|---|---|
| Prevent | Timeouts on every outbound call, derived from the caller's latency budget; review all existing ones | Backend chapter |
| Prevent | Classify dependencies as critical or optional; optional ones need a fallback and a test with the dependency slow | Backend chapter |
| Prevent | Load "Customers also bought" from the browser, after the page | Web team |
| Detect | Alert on 499s at the edge (done: `ClientsGivingUp`) and on in-flight calls per dependency | SRE |
| Detect | Recommendations: dashboards and alerts on queue length and busy workers, not only inference time | Data team |
| Mitigate | Feature flag for "Customers also bought" | Backend chapter |
| Follow-up | Recommendations: a separate worker pool, or a deadline, for on-the-fly computations | Data team |

## Lessons learned

- **What went well**: once someone looked at Recommendations from the inside (workers, queue, logs), the cause was clear in minutes. The pre-2.24.0 query made a fallback that shoppers already knew.
- **What went wrong**: "no 5xx" and "the dependency's dashboard is green" both sounded like good news. Neither one could see requests that never finish. A timeout of 30 s was called generous by comparing it with how fast Recommendations usually is, never with how long a shopper waits.
- **Where we got lucky**: the API's 30 s timeout did cancel requests. Without one, `fetch` would have waited up to five minutes (undici's default `headersTimeout`): ten times the queue in Recommendations, and ten times the pending requests and open sockets in the API.
