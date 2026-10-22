# Incident 001 · Root cause

> ⚠️ Spoilers. Read this after `./lab verify 001` passes, or once you've decided to stop.

## In one sentence

Since v2.15.0, every sales export runs one to three seconds of synchronous JavaScript on the API's only JavaScript thread (a linear scan of the whole catalog for every CSV line, plus a brand-new `Intl.NumberFormat` for every price), and while it runs, every other request in the process waits.

## What happens

Node.js runs all of a process's JavaScript on one thread, driven by the **event loop**: it picks the next ready callback (a request arrived, a query returned, a timer fired), runs it to completion, then moves on. Nothing else runs while a callback runs.

For a one-month export (~51,000 order lines), `GET /api/reports/sales`:

1. awaits the sales query: ~40 ms inside Postgres, and the event loop is free meanwhile;
2. awaits the whole product catalog (20,000 rows): ~10 ms, still free;
3. then, **synchronously**, for each of the 51,000 lines:
   - `catalog.find((entry) => entry.id === sale.productId)` scans 10,000 entries on average, so ~500 million comparisons per export;
   - calls `formatMoney()` twice, and `formatMoney` constructs a **new `Intl.NumberFormat`** each time (locale data, option resolution), so 100,000 formatter constructions.

Step 3 takes ~2 s on the container's single CPU, and nothing else in the process can run meanwhile. During the quarter-end close, Finance exports roughly every 4 seconds, so the event loop is blocked about half of the time.

## Why the *other* endpoints are slow

A request for `/api/products/42` needs ~5 ms of CPU and two fast queries. If it arrives while an export is being built, it waits in the socket until the loop is free, then waits again for each of its database callbacks. Product pages and checkout are **victims**; the export is the **culprit**. That's why customers complain about product pages, not about reports, and why p50 stays low (many requests arrive between two blocks) while p95/p99 sit at 1–3 s.

## The evidence chain

| Observation | Where | What it means |
|---|---|---|
| Edge p95 ≈ 1.8 s, but the API's own p95 for `/api/products/:id` is ~50 ms | Dashboard: *Latency at the edge* vs. *Latency measured by the API* | The time is lost *before* the API starts measuring: requests wait to be picked up. |
| In a slow product trace, the `traefik` span starts at 0 and the API's span only ~1.5 s later | Jaeger | The same thing for a single request: 1.5 s queued in front of the event loop. |
| `pg-pool.connect` spans of ~1.2 s; up to 64 requests waiting for a connection | Jaeger, *Database connection pool* panel | A red herring. The pool hands out connections in microseconds, but the callback receiving one couldn't run. Requests pile up during a block and rush the pool when it ends. |
| Mean query times of a few ms in `pg_stat_statements`; no slow-query logs | Dashboard table, `./lab psql`, `docker compose logs postgres` | The database is healthy. The export query's `max_exec_time` can reach seconds, because Postgres waits when its client stops reading results: a side effect, not the cause. |
| Event loop delay **max** of 2–3 s while **p99** stays around 25 ms | *Event loop delay* panel | The loop blocks a few times per minute, for seconds. Percentiles over thousands of 10 ms samples hide rare long stalls; `max` shows them. |
| Event loop utilization ~55 %, CPU ~0.5 cores at only ~38 req/s | Runtime panels | Far more CPU than these endpoints should need. |
| `GET /api/reports/sales` is slow by itself (2–3 s), with a long stretch and no child spans after its two queries | Jaeger, longest traces first | The time goes into uninstrumented synchronous code. |
| ~45 % of CPU self-time in `formatMoney` (`shared/money.ts`) and ~16 % in the `catalog.find` callback (`reports/sales-report.ts`) | Drilldown → Profiles, `wall/cpu` | The exact lines. |
| v2.15.0 added catalog enrichment and price formatting to the export, the evening before | `app/CHANGELOG.md` | The change that introduced it. |

## Trigger vs. root cause

- **Root cause**: CPU-heavy synchronous work on the request path, written as if the data were small: an O(n·m) lookup and an expensive object built per item.
- **Trigger**: the quarter-end close. The deploy went out the evening before and the night was quiet; the incident only started when Finance began exporting in bulk on Tuesday afternoon. A deploy that looked fine for 20 hours can still be the culprit: the dangerous code path simply wasn't exercised yet.
- **Why it wasn't caught**: the feature was tested with a handful of orders. 50 lines × 20 products is instant; 51,000 lines × 20,000 products is not.

Next: [FIX.md](FIX.md) (mitigation, fix, measured alternatives, prevention) and an example [POSTMORTEM.md](POSTMORTEM.md).
