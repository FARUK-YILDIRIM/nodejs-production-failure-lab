# Incident 008 · Root cause

> ⚠️ Spoilers. Read this after `./lab verify 008` passes, or once you've decided to stop.

## In one sentence

Since 2.23.0, the checkout transaction locks the rows of the products in the cart, then calls TaxRate and PayFlow, about half a second, before it writes the order and commits. On Black Friday almost every order contains one of three doorbusters, so orders for the same doorbuster go through one at a time and the line behind them grows to seconds. Every order waiting in that line holds one of the API's ten database connections, which leaves the rest of the site queuing for the others.

## What happens

```ts
const orderId = await transaction(async (client) => {
  const stock = await lockStock(productIds, client);   // SELECT … FOR UPDATE: the products' rows are now locked
  …                                                    // stock check, coupon
  const { taxCents } = await quoteTax(…);              // TaxRate, ~50 ms
  const authorization = await authorizePayment(…);     // PayFlow, 250–550 ms
  await decrementStock(items, client);
  return insertOrder(…, client);
});                                                    // COMMIT: the locks are released only here
```

1. An order containing doorbuster 1 locks product 1's row, then calls TaxRate and PayFlow. For half a second, PostgreSQL sees its session as `idle in transaction`: waiting for the API's next query, and holding the lock meanwhile.
2. The next order containing product 1 runs the same `SELECT … FOR UPDATE` and waits for that lock (`wait_event = transactionid`); the orders after it wait behind it (`tuple`). However big the pool or the database, product 1 now sells at most about two units per second.
3. At 6 orders per second, ~85 % of them with a doorbuster, each doorbuster gets ~1.7 orders per second, and each of them holds the row for ~0.5 s: the row is locked ~85 % of the time. Near full utilization, queues explode: about a second of waiting on average, several seconds at the tail.
4. Every order waiting for a lock holds a pool connection. Three lock holders plus a few waiters per doorbuster take all ten: product pages, order history and order lookups queue for a connection behind them, although their own queries take milliseconds.
5. Nothing fails. Waiting for a lock isn't an error, and the pool's 5 s timeout is rarely reached. Everything is just slow.

All week, the same code ran at half the volume with orders spread over 20,000 products. Two orders rarely wanted the same row within the same half second, so the locks never met.

## The evidence chain

| Observation | Where | What it means |
|---|---|---|
| `POST /api/orders` p95 at seconds, while calls to PayFlow take their usual few hundred milliseconds | *In-API latency*, *Calls to other services* | Most of checkout's time isn't spent at PayFlow. |
| Product pages, order history and order lookups slow too, though their queries take milliseconds | *In-API latency*, Jaeger | They're waiting, not working. |
| Pool: 10 connections in use, 0 idle, dozens of requests waiting | *Database connection pool* | The API is waiting for database connections. |
| Database time dominated by `SELECT id, stock FROM products … FOR UPDATE`, a primary-key lookup, while the database's CPU is idle | *Database time by query* | `pg_stat_statements` counts time spent waiting for locks as execution time. |
| Sessions `active` but waiting on `Lock` (`transactionid`, `tuple`); others `idle in transaction` | `pg_stat_activity` | The connections are held by transactions waiting for each other. |
| `pg_blocking_pids()`: lines of waiters, each headed by an `idle in transaction` session whose last query is the same `SELECT … FOR UPDATE` | `./lab psql` | The lock holder isn't doing anything in the database. It's waiting for the API. |
| The contended rows are products 1, 2 and 3 | `pg_locks` (page and tuple, i.e. the row's `ctid`) | The doorbusters: everyone queues for the same three rows. |
| The `FOR UPDATE` query: ~0.7 s on average for a primary-key lookup | `pg_stat_statements` (`mean_exec_time`) | Almost all of it is waiting for locks. |
| A slow checkout: the `SELECT … FOR UPDATE` span takes seconds; after it, calls to TaxRate and PayFlow, then the `UPDATE`s and `COMMIT` | Jaeger | The lock is held during calls to other services. |

### Red herrings

- **"PayFlow is slow."** PayFlow answers in its usual 250–550 ms, as it did all week. The problem is what the API holds while it waits.
- **"The pool is too small."** A bigger pool lets more orders queue on the same three rows. Product pages get their connections back, but each doorbuster still sells at most about two units per second, and the database pays for every extra connection.
- **"The database is overloaded."** Its CPU is idle. Its sessions wait for locks, not for CPU or disk.
- **"Twice the usual traffic."** Twice the orders spread over 20,000 products would be fine. Twice the orders on the same three rows isn't.

## Trigger vs. root cause

- **Root cause**: calls to other services (TaxRate, PayFlow) made inside a database transaction, while it holds row locks. The locks last as long as the network calls.
- **Trigger**: the doorbusters, concentrating most orders on three rows.
- **Why it wasn't caught**: a week of normal traffic, and load tests (when there are any) that spread orders over random products. Lock contention only shows when many requests want the same rows: test the hot path, not the average day.

Next: [FIX.md](FIX.md) and an example [POSTMORTEM.md](POSTMORTEM.md).
