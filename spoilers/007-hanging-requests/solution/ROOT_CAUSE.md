# Incident 007 · Root cause

> ⚠️ Spoilers. Read this after `./lab verify 007` passes, or once you've decided to stop.

## In one sentence

The coupon checkout of v2.22.0 opens a transaction by hand and only commits and releases its connection on the happy path. Each order with an invalid coupon throws in between, leaving a connection checked out of the pool forever, inside an open transaction that keeps the coupon row locked. Every later order with the same coupon waits on that lock while holding another connection. The ten-connection pool empties in under a minute, and since 2.21.2 removed the pool's 5 s timeout, every request that needs the database waits forever.

## What happens

```ts
const client = await pool.connect();
await client.query('BEGIN');
if (input.couponCode) {
  const coupon = await lockCoupon(input.couponCode, client);       // SELECT … FOR UPDATE
  if (!coupon || !isRedeemable(coupon)) throw badRequest(…);       // ← leaves with the connection
  …
}
…
await client.query('COMMIT');
client.release();                                                   // happy path only
```

1. An order with `BACK2SCHOOL` (expired) locks the coupon row, then throws `400`. The customer gets a clean error, but the connection is never released, and PostgreSQL keeps its transaction open: `idle in transaction`, holding the row lock.
2. The next order with `BACK2SCHOOL` checks out another connection and runs the same `SELECT … FOR UPDATE`, which waits for the lock. It waits forever too: the first transaction never ends.
3. Each further `BACK2SCHOOL` attempt adds one more waiting connection, about one every 3 seconds at today's traffic.
4. With all 10 connections taken, `pool.connect()` and `pool.query()` queue up. There's no `connectionTimeoutMillis` anymore, so they wait indefinitely. No error is ever thrown, so nothing is logged.
5. Clients give up after 10 s (499 at the edge). The health check doesn't use the database, so the API looks healthy to the orchestrator.

A restart closes the connections, PostgreSQL rolls the transactions back, the lock goes away, and the cycle starts again.

## The evidence chain

| Observation | Where | What it means |
|---|---|---|
| Edge traffic collapses; 499 (client gave up) instead of 5xx; p95 = the 10 s client timeout | *Requests per second by status*, latency | Requests never get an answer, so there are no errors either. |
| API CPU and event loop idle; no error logs | Runtime panels, `./lab logs api` | Waiting, not working, and not failing. |
| Pool: 10 open, 0 idle, hundreds to thousands waiting | *Database connection pool* | The API is waiting for database connections. |
| PostgreSQL: one session `idle in transaction` for minutes; nine `active` sessions waiting on `Lock`/`tuple` | `pg_stat_activity` | The connections aren't busy: they're stuck. |
| `pg_blocking_pids()`: a chain of waiters ending at the idle-in-transaction session | `pg_blocking_pids(pid)` | One abandoned transaction blocks the others. |
| The stuck sessions' last query: `SELECT … FROM coupons WHERE code = $1 FOR UPDATE` | `pg_stat_activity.query` | The coupon checkout. |
| A coupon trace in Jaeger ends with `BEGIN`, the coupon `SELECT`, then the 400 response, with no `ROLLBACK` | Jaeger | The transaction is abandoned on that path. |
| Freezes start ~30–60 s after every restart | Restart history | Proportional to how often someone tries the expired coupon. |
| 2.21.2 removed the pool's connection timeout; 2.22.0 added coupons | Changelog | No more errors to see, and the leak itself. |

### Red herrings

- **"The pool is too small."** A bigger pool only takes longer to drain; leaked connections never come back.
- **"Database locks are slow."** The lock waits are a consequence: the lock holder is a connection the API forgot about.
- **"It's TikTok traffic."** It's a handful of requests per minute. The volume isn't the problem, what each one leaves behind is.

## Trigger vs. root cause

- **Root cause**: a transaction and its connection managed by hand, without `try/finally`, plus a pool configured to wait forever.
- **Trigger**: an expired coupon code going viral, making the error path frequent.
- **Why it wasn't caught**: tests covered valid coupons. Error paths that leak resources look perfect in a single test; they fail only after they've run ten times.

Next: [FIX.md](FIX.md) and an example [POSTMORTEM.md](POSTMORTEM.md).
