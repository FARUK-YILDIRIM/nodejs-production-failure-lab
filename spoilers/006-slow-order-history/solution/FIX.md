# Incident 006 · Fix

## 1. Mitigate first (minutes)

- **Lower the page size** the app asks for (or cap `limit` server-side). Fewer orders per page means fewer round trips: it cuts the latency, not the cause.
- **Don't** scale the database or the API: neither is busy.

## 2. Fix: a fixed number of queries per request

[`fix.patch`](../fix.patch) (`git apply spoilers/006-slow-order-history/fix.patch`):

- **One query for all the items of all the orders**: `WHERE i.order_id = ANY($1::int[])`, with `products` and `categories` joined in for the SKU, name and category.
- **Group in memory** with `Map.groupBy` and build the exact same response.

A request now costs 3 round trips (customer check, orders, items) whatever the number of orders and items. The single batched query takes ~0.3 ms inside PostgreSQL, much more than one per-row query but far less than 77 round trips.

### Measured with `./lab verify 006`

Apple Silicon laptop, Docker Desktop with 2 vCPUs, API limited to 1 CPU, database ~6 ms away, ~66 req/s:

| | Before | After |
|---|---|---|
| Account (order history) p95 | 533 ms | 41 ms |
| Customer with 23 orders, 53 items | 77 queries, ~750 ms | 3 queries, ~55 ms |
| Catalog p95 | 26 ms | 27 ms |
| API CPU | 0.26 cores | 0.25 cores |

## 3. Alternatives

| Approach | Verdict |
|---|---|
| `Promise.all` over the per-order queries | Overlaps the round trips (~3 waves instead of 77) but still sends 77 queries and occupies several pool connections per request. Better, not good. |
| A single query with `json_agg` building the whole history in PostgreSQL | One round trip; harder to read and to keep in sync with the response shape. Good for very hot endpoints. |
| A DataLoader (batch + cache per request) | The standard fix in GraphQL servers, where resolvers naturally produce N+1 patterns. |
| An ORM's eager loading (`include`, `with`…) | What ORMs offer for exactly this; check the generated SQL anyway. |

## 4. Prevent

- **Count queries per request.** Emit a per-request query counter (as a span attribute or a histogram) and alert or fail tests when an endpoint's count grows with the data.
- **Test against realistic latency.** Run integration tests against a database with production-like round-trip time (a latency proxy like the one in this lab, or Toxiproxy), with customers who have many orders.
- **Review rule**: an `await` on a query inside a loop is a question to answer in review.
- **Trace waterfalls**: keep tracing on query level in production; the N+1 staircase is unmistakable in a trace.
