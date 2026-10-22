# Incident 005 · Fix

## 1. Mitigate first (minutes)

- **Create the index by hand**, in `psql`: `CREATE INDEX CONCURRENTLY order_items_product_id_idx ON order_items (product_id);`. It takes seconds and the database recovers immediately. In production that's a legitimate first move, provided the same index lands in a migration right after, so that every environment and every future restore has it. (In the lab, `verify` starts from the original database, so only the migration counts.)
- **Or hide the counter** behind a feature flag until the fix ships.
- **Don't** block or throttle Googlebot, and don't raise `max_connections` or the pool size.

## 2. Fix: index the new access path

[`fix.patch`](../fix.patch) (`git apply spoilers/005-database-overload/fix.patch`) adds a migration:

```sql
-- no-transaction
CREATE INDEX CONCURRENTLY IF NOT EXISTS order_items_product_id_idx
  ON order_items (product_id) INCLUDE (quantity);
```

- **`(product_id)`** turns "read 1.2 M rows" into "jump to the ~50 rows of this product": 21 ms → 0.2 ms.
- **`INCLUDE (quantity)`** stores the quantity in the index, so once the table has been vacuumed PostgreSQL can answer `sum(quantity)` with an index-only scan, without touching the table at all.
- **`CONCURRENTLY`** builds the index without blocking the `INSERT`s of orders being placed meanwhile. A plain `CREATE INDEX` locks the table against writes for the whole build. It can't run inside a transaction, hence the `-- no-transaction` header the migration runner understands.
- **`IF NOT EXISTS`** makes the migration safe where someone already created the index by hand during the incident.

The index costs 26 MB next to the 60 MB table, plus a little work on every order item written.

### Measured with `./lab verify 005`

Apple Silicon laptop, Docker Desktop with 2 vCPUs, API and PostgreSQL limited to 1 CPU each, customers plus Googlebot (~62 req/s):

| | Before | After |
|---|---|---|
| Catalog p95 | 1.54 s | 15 ms |
| Checkout p95 | 3.27 s | 62 ms |
| Database time per second | 9.39 s/s | 0.05 s/s |
| Requests waiting for a DB connection (max) | 83 | 0 |
| PostgreSQL CPU | ~98 % | ~17 % |
| Purchase counter query | ~21 ms (parallel seq scan) | ~0.2 ms (index) |

(The "before" run starts from a freshly restored database with cold caches, so it's even worse than the steady state of ~430 ms p95.)

## 3. Alternatives

| Approach | Verdict |
|---|---|
| A `purchase_count` column on `products`, incremented with each order | Constant-time reads, at the cost of a write on a hot row for every order and of keeping it correct (refunds, imports). |
| Cache the counter (in memory or Redis) for a few minutes | Removes repeated work, but a cold cache or a wide crawl still hits the database with full scans. Complement, not substitute. |
| A materialized view refreshed periodically | Fine for analytics; awkward for a per-product number shown everywhere. |
| More CPU for the database | Pays monthly for a query that should be 100 times cheaper. |

## 4. Prevent

- **Review every new query's plan** against production-sized data (`EXPLAIN ANALYZE` in the pull request), especially queries on paths crawlers and campaigns can amplify.
- **Watch the database's time per query** (`pg_stat_statements`) and alert on total database time, not only on latency.
- **Log slow plans automatically** with `auto_explain` (`auto_explain.log_min_duration`), so the plan of the next slow query is already in the logs.
- **Load-test with realistic traffic shapes**: crawlers spread across the whole catalog, which defeats caches tuned for popular products.
