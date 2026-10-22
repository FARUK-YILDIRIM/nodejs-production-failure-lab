# Incident 005 · Root cause

> ⚠️ Spoilers. Read this after `./lab verify 005` passes, or once you've decided to stop.

## In one sentence

v2.20.0's purchase counter (`SELECT sum(quantity) FROM order_items WHERE product_id = $1`) has no index to use, so every product page makes PostgreSQL read all 1.2 million order items. That was tolerable for customers alone, but the Google Shopping feed brought Googlebot to product pages at ~24 pages per second, and the scans now need several times the CPU the database has. Every other query waits in line behind them.

## What happens

- **The query**: one row per product page, filtered on `order_items.product_id`.
- **The missing index**: `order_items` is indexed on `order_id` (to load an order's items) but not on `product_id`. Nobody looked items up by product before 2.20.0.
- **The plan**: a parallel sequential scan that reads all 1.2 M rows (~60 MB) to keep ~50. About 20 ms of wall time, and ~3 times that in CPU across the parallel workers.
- **The volume**: customers open ~10 product pages per second; Googlebot adds ~24. The catalog cache doesn't help: it keys product pages by id, and both customers and the crawler spread over 20,000 products.
- **The saturation**: ~34 scans per second need far more than the instance's single vCPU. Queries queue on the CPU, the API's connections stay busy longer, the pool fills up (up to 83 requests waiting for a connection), and every endpoint that touches the database slows down: product pages, listings, checkout, order history.

## The evidence chain

| Observation | Where | What it means |
|---|---|---|
| All endpoints slow; API CPU low (~0.1 core) | Dashboard | The API is waiting, not working. |
| Database time ~5–9 s per second | *Database time per second, by query* | ~5–9 queries running at any moment on a 1-vCPU instance: saturated. |
| One query is ~98 % of it: `SELECT coalesce(sum(quantity), $2)::int AS purchases FROM order_items WHERE product_id = $1` | Same panel, `pg_stat_statements` | The culprit query. |
| ~40 M rows/s read by sequential scans of `order_items` | *Rows read by sequential scans, by table* | Whole-table reads, tens of times per second. |
| `Parallel Seq Scan on order_items … Rows Removed by Filter: ~400,000` per worker | `EXPLAIN (ANALYZE, BUFFERS)` | No index to find a product's items. |
| Indexes on `order_items`: primary key and `order_id` only | `\d order_items` | Confirms it. |
| Requests waiting for a database connection; `pg-pool.connect` spans of hundreds of ms | Pool panel, Jaeger | Secondary effect of slow queries, not a pool problem. |
| 2.20.0 added the counter on Monday; the feed and Googlebot arrived on Tuesday | Changelog, brief | Latent cost, then the trigger. |

### Red herrings

- **Googlebot itself.** It sends legitimate traffic the business wants. Blocking it would hide the problem until the next traffic spike, and cost SEO.
- **The connection pool.** Requests wait for connections because every connection is busy with slow queries. A bigger pool would only put more concurrent scans on the same CPU.
- **"Postgres needs more CPU."** A bigger instance would absorb today's crawl rate at a much higher bill, for a query that should cost a fraction of a millisecond.

## Trigger vs. root cause

- **Root cause**: a new access path (`order_items` by `product_id`) shipped without the index it needs.
- **Trigger**: crawler traffic on product pages, roughly tripling how often that path runs.
- **Why it wasn't caught**: in development `order_items` has a few hundred rows, where a sequential scan is the *best* plan, and the query took 20 ms in production on Monday. Nobody looked at its plan or at how it would scale with traffic.

Next: [FIX.md](FIX.md) and an example [POSTMORTEM.md](POSTMORTEM.md).
