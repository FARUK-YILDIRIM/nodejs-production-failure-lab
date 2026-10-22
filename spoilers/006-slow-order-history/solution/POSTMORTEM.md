# Postmortem · Incident 006: Slow order history

> An example postmortem for this incident, in the lab's blameless format. Times are from the scenario.

## Summary

After the mobile app 3.0 launch on Monday, the new "My orders" screen took 0.3–1 s to load. The order history endpoint, reworked in v2.21.0 to include items with product details, ran one query per order and one per item. Each query is fast but costs a ~6 ms round trip to the database's availability zone, and customers with many orders paid it up to 77 times per request. We now fetch all items in one query.

## Impact

- **Customers**: the "My orders" screen was slow for every mobile user for ~2 days; ~12 % of app sessions that opened it were abandoned on that screen.
- **No errors**, and no impact on browsing or checkout.

## Timeline

| Time | Event |
|---|---|
| Mon 09:00 | v2.21.0 deployed (order history with items). Web traffic to the endpoint is low; nothing noticed. |
| Mon 10:00 | Mobile app 3.0 released. Endpoint traffic triples. |
| Tue 15:00 | App reviews mention the slow screen; `OrderHistorySlow` (ticket severity) open since Monday. |
| Wed 10:00 | Investigation starts: database and API both idle. |
| 10:20 | Trace of a slow request: 77 sequential `pg.query` spans. |
| 10:30 | `pg_stat_statements`: per-product lookups at 0.04 ms each, 150 calls per second. |
| 11:30 | **Fix** deployed: one query for all items. p95 41 ms. |

Time to detect: ~1 day (ticket-level alert). Time to resolve: ~2 days.

## Root cause

The order history issued one query per order and one per item, sequentially. Per-query latency is dominated by the round trip to the database's availability zone, so request latency grew with the number of orders and items.

## Trigger

The mobile app's new screen, which made the endpoint popular and asked for 20 orders per page.

## Evidence

1. Only this endpoint is slow; database and API are idle.
2. Jaeger: 1 + orders + items sequential `pg.query` spans per request, ~7 ms each.
3. `pg_stat_statements`: 0.04–0.06 ms mean execution time for those queries.

## Action items

| Type | Action | Owner |
|---|---|---|
| Prevent | Query count per request as a span attribute and a CI budget per endpoint | Backend chapter |
| Prevent | Integration tests through a latency proxy, with customers that have many orders | QA |
| Detect | Page (not ticket) on p95 of customer-facing endpoints above 500 ms | SRE |
| Process | Mobile releases list the API endpoints whose traffic they change | Mobile team |

## Lessons learned

- **What went well**: one trace showed the whole problem.
- **What went wrong**: a ticket-level alert for a customer-facing screen sat for a day.
- **Where we got lucky**: the loops were sequential. Had someone "optimized" them with `Promise.all`, each request would have held many pool connections at once, and the slowness would have spread to checkout.
