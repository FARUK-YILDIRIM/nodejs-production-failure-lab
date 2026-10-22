# Incident 006 · Root cause

> ⚠️ Spoilers. Read this after `./lab verify 006` passes, or once you've decided to stop.

## In one sentence

v2.21.0 builds the order history with one query for the orders, then one query per order for its items, then one query per item for its product (the N+1 pattern). Every query is fast inside PostgreSQL, but each one is a ~6 ms network round trip to a database in another availability zone, paid one after the other: 77 round trips for a customer with 23 orders.

## What happens

```ts
const orders = await listCustomerOrders(customerId, limit);   // 1 query
for (const order of orders) {
  const items = await listOrderItems(order.id);               // + 1 per order
  for (const item of items) {
    const product = await findProduct(item.productId);        // + 1 per item
```

- Each `await` waits for the previous query's answer before sending the next one, so nothing overlaps.
- Inside PostgreSQL these queries take 0.04–0.06 ms each. As seen by the API, ~7 ms: the round trip to the other availability zone, plus pool and driver overhead.
- A typical customer (10 orders, 25 items) needs 36 queries, ~250 ms. The heaviest customers (23 orders, 53 items) need 77, ~750 ms. The cost grows with how many orders a customer has.
- The data needed for the product lookup (`sku`, category) was one join away from the item query.

Before 2.21.0 the endpoint ran two queries per request. The mobile app made it run six times per second, and the response got bigger at the same time.

## The evidence chain

| Observation | Where | What it means |
|---|---|---|
| Only `/api/customers/:id/orders` is slow; p50 ~340 ms, p95 500–700 ms | Dashboard, `OrderHistorySlow` | One endpoint, not the whole service. |
| Database query time as seen by the API ~7 ms per query; database CPU low | *Database query time seen by the API*, database panels | No query is slow. |
| A trace of the endpoint: dozens of sequential `pg.query` spans, ~7 ms each | Jaeger | Many queries, back to back: the N+1 staircase. |
| Span count = 1 + orders + items in the response | Jaeger + the response body | One query per order, one per item. |
| `mean_exec_time` 0.04–0.06 ms for the per-order and per-product queries, with call counts far above the request rate | `pg_stat_statements` | The database is fast; almost all of each query's time is spent on the network. |
| v2.21.0 rewrote the history as nested loops of `await`s | Changelog, `customers/order-history.ts` | The code. |

### Red herrings

- **The `pg` bump in 2.20.2**: a driver regression would slow down every query on every endpoint, not one endpoint.
- **"The database is far away."** It has been for a year. Distance is a constant; what changed is how many times each request pays for it.
- **"Add an index."** Every query already uses its primary key or index and runs in microseconds.

## Trigger vs. root cause

- **Root cause**: per-row queries in a loop. Request latency grows linearly with the data, with a large constant (the round trip) per row.
- **Trigger**: the mobile app's new screen, calling the endpoint far more often and with larger pages.
- **Why it wasn't caught**: in development the database runs on the same machine (round trip ~0.1 ms) and test customers have two orders. 77 × 0.1 ms is invisible; 77 × 7 ms is not.

Next: [FIX.md](FIX.md) and an example [POSTMORTEM.md](POSTMORTEM.md).
