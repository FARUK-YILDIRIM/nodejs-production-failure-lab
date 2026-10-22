# Postmortem · Incident 005: Database overload

> An example postmortem for this incident, in the lab's blameless format. Times are from the scenario.

## Summary

From Tuesday 14:30 to Wednesday 10:15, ShopFlow's database ran at full CPU and every endpoint slowed down (p95 ~0.4–1.5 s instead of ~20 ms). The product-page purchase counter released on Monday queried `order_items` by `product_id`, a column with no index, so each product page scanned 1.2 million rows. Googlebot started crawling product pages from the new Shopping feed on Tuesday, and the scans exceeded the database's capacity. An index on `order_items (product_id)` brought the query from 21 ms to 0.2 ms.

## Impact

- **Customers**: all pages slow for ~20 hours; checkout p95 above 3 s at peak. Order volume ~9 % below forecast on Tuesday afternoon.
- **SEO**: Googlebot saw slow responses during its first crawl of the feed; crawl rate was reduced for two days.

## Timeline

| Time | Event |
|---|---|
| Mon 11:00 | v2.20.0 deployed: purchase counter on product pages. Query ~20 ms; nobody notices. |
| Tue 14:00 | Product feed live on Google Shopping. |
| 14:30 | Googlebot reaches ~24 product pages/s; database CPU at 100 %. |
| 14:35 | `DatabaseBusy` fires; DBA engaged. |
| 15:10 | Connection pool suspected; pool size raised from 10 to 20: worse (more concurrent scans). Reverted. |
| 16:00 | "Block Googlebot" proposed; rejected by SEO. |
| Wed 09:20 | `pg_stat_statements` reviewed: one query is 98 % of database time. |
| 09:35 | `EXPLAIN ANALYZE`: parallel sequential scan of `order_items`. |
| 09:45 | **Mitigation**: `CREATE INDEX CONCURRENTLY` by hand. CPU drops to ~15 % within a minute. |
| 10:15 | **Fix**: migration with the same index merged and deployed. |

Time to detect: 5 min. Time to mitigate: ~19 h. Time to resolve: ~19 h 45 min.

## Root cause

The new purchase counter filtered `order_items` by `product_id`, and no index covered that column, so each product page read the entire table.

## Trigger

Googlebot crawling product pages from the newly published Shopping feed, tripling the rate of that query.

## Evidence

1. Database time ~5–9 s/s, 98 % of it in the purchase counter query.
2. ~40 M rows/s read by sequential scans of `order_items`.
3. `EXPLAIN ANALYZE`: parallel seq scan, ~400k rows removed by filter per worker.
4. `\d order_items`: no index on `product_id`.

## Action items

| Type | Action | Owner |
|---|---|---|
| Prevent | `EXPLAIN ANALYZE` on production-sized data required for new queries in review | Backend chapter |
| Detect | Alert on database time per second and on sequential scans of large tables | DBA |
| Detect | Enable `auto_explain` for statements over 200 ms | DBA |
| Prevent | Load tests include crawler-shaped traffic across the whole catalog | QA |
| Process | Launches that change traffic shape (feeds, campaigns) notify engineering | SEO / Marketing |

## Lessons learned

- **What went well**: `pg_stat_statements` and the sequential-scan panel pointed at the exact query in minutes, once someone looked.
- **What went wrong**: we tuned the symptom (the pool) for hours before looking at what the database was doing; growing the pool made it worse.
- **Where we got lucky**: `CREATE INDEX CONCURRENTLY` on a 1.2 M-row table took under a second. On a table a hundred times bigger it takes much longer, and a plain `CREATE INDEX` would have blocked checkout.
