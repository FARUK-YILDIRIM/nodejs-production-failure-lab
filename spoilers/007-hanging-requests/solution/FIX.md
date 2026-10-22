# Incident 007 · Fix

## 1. Mitigate first (minutes)

- **Disable `BACK2SCHOOL`** (delete the row, or answer 400 at the edge for it). The leak keeps happening for other invalid codes, but far less often.
- **Restart the API** after removing the trigger, to release the leaked connections and their locks.
- **`idle_in_transaction_session_timeout`** (e.g. 30 s) makes PostgreSQL kill abandoned transactions and release their locks. It's worth having anyway. But the pool still counts the dead connection as checked out until the code releases it, so on its own it doesn't stop the pool from draining.

## 2. Fix: every path ends the transaction and returns the connection

[`fix.patch`](../fix.patch) (`git apply spoilers/007-hanging-requests/fix.patch`):

- **Use the existing `transaction()` helper.** It runs `BEGIN`, then `COMMIT` on success, `ROLLBACK` on any error, and `release()` in a `finally`. Throwing `400` for an invalid coupon now rolls back (unlocking the row) and returns the connection.
- **Restore `connectionTimeoutMillis: 5_000`.** If the pool ever runs dry again, requests fail after 5 s with an error you can see, alert on and debug, instead of hanging silently.

### Measured with `./lab verify 007`

Apple Silicon laptop, Docker Desktop with 2 vCPUs, API limited to 1 CPU, ~66 req/s with ~0.3 expired-coupon attempts per second:

| | Before | After |
|---|---|---|
| Checkout p95 | 10 s (client timeout) | 130 ms |
| Catalog p95 | 10 s (client timeout) | 28 ms |
| Error rate | 68 % | 0 % |
| Requests waiting for a connection (max) | 2,268 | 0 |
| `idle in transaction` sessions | 1 (plus 9 waiting on its lock) | 0 |

### Why only one of the two changes isn't enough

- **Only the timeout**: the leaked transaction still holds the coupon lock, and the orders waiting on it still hold connections. The pool still drains; requests now fail after 5 s instead of hanging. Visible, but still an outage.
- **Only the `finally`**: correct today. But the next bug that holds connections (a slow query, a lock, a stuck downstream call inside a transaction) would freeze the API silently again.

## 3. Alternatives

| Approach | Verdict |
|---|---|
| `try { … COMMIT } catch { ROLLBACK; throw } finally { release() }` by hand | Equivalent to the helper; easy to get subtly wrong the next time. Prefer one well-tested helper. |
| Validate the coupon *before* opening the transaction, then lock and re-check inside it | Fewer locks taken for invalid codes, but the transaction still needs a `finally`. |
| `UPDATE coupons SET redemptions = redemptions + 1 WHERE code = $1 AND <still valid> RETURNING …` | Redeems atomically without `SELECT … FOR UPDATE`; shorter locks, simpler code. |
| A bigger pool | Postpones the freeze. Never a fix for a leak. |

## 4. Prevent

- **Never manage `pool.connect()` by hand** outside a helper that releases in `finally`. Make it a lint rule or a review rule.
- **Keep timeouts everywhere**: `connectionTimeoutMillis` on the pool, `statement_timeout` and `idle_in_transaction_session_timeout` on the database role, timeouts on clients. Waiting forever is never the right default.
- **Detect**: alert on requests waiting for a connection (`db_pool_connections{state="waiting"}`), on `idle in transaction` sessions older than a few seconds, and on a drop in completed requests at the edge.
- **Make health checks honest**: a readiness check that borrows a connection (`/ready`) would have taken the instance out of rotation.
- **Test error paths repeatedly**: run each error path more times than the pool size in a test, then check the pool is back to idle.
