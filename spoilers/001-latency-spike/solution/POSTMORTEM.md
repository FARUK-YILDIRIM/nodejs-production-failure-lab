# Postmortem · Incident 001: Latency spike

> An example of the postmortem a team would write after this incident. Blameless: it explains how the system allowed the failure, not who to blame. Times are from the scenario.

## Summary

For about an hour on the last business day of the quarter, a large share of ShopFlow API requests were delayed by up to three seconds; p95 latency at the edge rose from ~20 ms to ~2 s. The sales export, enriched the day before, ran seconds of synchronous CPU work per call and stalled the Node.js event loop for every other request. We paused exports, then shipped a fix that moved the enrichment into SQL and reused number formatters. The export became ~8× faster and p95 returned to ~15 ms.

## Impact

- **Customers**: product pages, checkout and order history intermittently hung for 1–3 s. No errors, no data loss.
- **Finance**: exports took 2–4 s each, then were paused for 20 minutes during the close.
- **Duration**: 14:05 → 15:10 (65 minutes), customer impact until the mitigation at 14:45.

## Timeline

| Time | Event |
|---|---|
| Mon 18:10 | v2.14.3 (`pg` bump) and v2.15.0 (export enrichment) deployed together. |
| Tue 14:05 | Finance starts quarter-end exports. |
| 14:12 | Edge p95 crosses 500 ms. |
| 14:14 | `ApiHighLatencyP95` fires; on-call paged. |
| 14:20 | Investigation starts. Error rate and traffic normal. |
| 14:31 | `pg` upgrade suspected (slow `pg-pool.connect` spans, many waiting clients), then ruled out: `pg_stat_statements` shows millisecond queries. |
| 14:38 | Event loop delay max of 2–3 s found; `GET /api/reports/sales` is slow by itself. |
| 14:42 | CPU profile points at `formatMoney` and `catalog.find` in the sales export. |
| 14:45 | **Mitigation**: exports paused at the edge; latency back to normal within a minute. |
| 15:05 | **Fix** deployed (SQL join + cached formatters); exports re-enabled. |
| 15:10 | Verified under load: p95 ~15 ms, event loop delay max ~160 ms. |

Time to detect: 2 min. Time to mitigate: 33 min. Time to resolve: 58 min.

## Detection

The edge latency alert fired two minutes after impact began: good. It said *that* customers were affected, not *why*. An event-loop alert (`max_over_time(nodejs_eventloop_lag_max_seconds[1m]) > 0.5`) would have pointed at the API process straight away and saved the detour through the database.

## Root cause

`GET /api/reports/sales` enriched each CSV line by scanning the full 20,000-product catalog with `Array.find` and by constructing a new `Intl.NumberFormat` for every price. A one-month export (51,000 lines) spent ~2 s of synchronous CPU on the API's single JavaScript thread. While it ran, no other callback in the process could run, so unrelated requests queued behind it.

## Trigger

The quarter-end close: Finance exported every few seconds. The code had been deployed the evening before, but the expensive path was barely used overnight.

## Evidence

1. Edge p95 ~2 s while the API's own p95 for product routes was ~50 ms: time was lost before the handlers ran.
2. Jaeger: product requests with ~2.2 s between the proxy span and the API span; `pg-pool.connect` spans of ~1.2 s next to 3–5 ms queries.
3. `pg_stat_statements`: mean query times of a few milliseconds; no slow-query logs.
4. Event loop delay max 2–3 s (p99 only ~25 ms), utilization ~55 %, CPU ~0.5 cores at 38 req/s.
5. Pyroscope: ~51 % of CPU in `formatMoney`, ~16 % in the `catalog.find` callback of `sales-report.ts`.

## Mitigation and fix

- **Mitigation**: exports paused at the edge for 20 minutes.
- **Fix**: the export query joins products and categories in Postgres; number formatters are created once per currency. Output unchanged byte for byte.

| | Before | After |
|---|---|---|
| Catalog p95 | 1.84 s | 12 ms |
| Reports p95 | 2.56 s | 294 ms |
| CPU | 0.53 cores | 0.15 cores |
| Event loop delay (max) | 2.87 s | 159 ms |

## Action items

| Type | Action | Owner |
|---|---|---|
| Detect | Page on event loop delay max > 500 ms for 2 min | SRE |
| Prevent | CI benchmark of the sales export on production-sized data | Reports team |
| Prevent | Code review checklist: per-item `Intl`/`RegExp` construction, `Array.find` in loops | Backend chapter |
| Mitigate | Feature flag for exports, so they can be paused without a deploy | Reports team |
| Prevent | Move bulk exports to a background job against a read replica | Reports team |

## Lessons learned

- **What went well**: continuous profiling pinpointed the code within minutes once we looked at the API process.
- **What went wrong**: we lost ~10 minutes on the `pg` upgrade because the slowest spans and the busiest panel both said "database". Symptoms of a blocked event loop show up wherever callbacks wait.
- **Where we got lucky**: exports are bursty. A daily scheduled export at peak traffic would have caused the same outage every day, starting the morning after the deploy.
