# Postmortem · Incident 007: Hanging requests

> An example postmortem for this incident, in the lab's blameless format. Times are from the scenario.

## Summary

From Monday evening to Wednesday 11:40, the ShopFlow API froze about a minute after every restart: requests got no answer until clients gave up, with no errors and no load. The coupon checkout shipped in v2.22.0 leaked a database connection, with an open transaction holding the coupon's row lock, every time a customer used an invalid coupon. An expired `BACK2SCHOOL` code circulating on TikTok made that path frequent. A change in 2.21.2 had removed the pool's connection timeout, so nothing ever failed visibly. Every error path now ends its transaction and releases its connection, and the timeout is back.

## Impact

- **Customers**: the site was unusable for most of ~38 hours, apart from a minute after each of 23 manual restarts.
- **Revenue**: orders on Tuesday were ~70 % below forecast.
- **On-call**: the night shift restarted the API eleven times.

## Timeline

| Time | Event |
|---|---|
| Fri | v2.21.2: the pool waits for connections instead of timing out after 5 s. |
| Mon 17:00 | v2.22.0: coupon codes. |
| Mon 21:30 | `BACK2SCHOOL` goes viral on TikTok; first freeze. Restart helps. |
| Mon 21:45 – Tue 07:00 | Freezes after every restart; eleven restarts. |
| Tue 09:30 | Incident opened. No errors, no CPU; database suspected, then the network. |
| Tue 14:00 | Pool panel: 10/10 connections in use, thousands waiting. Pool size raised to 30: the freeze takes three minutes instead of one. |
| Wed 10:15 | `pg_stat_activity`: one `idle in transaction` session blocking nine others on the coupon row. |
| 10:40 | Leak found in the coupon path. |
| 10:45 | **Mitigation**: `BACK2SCHOOL` deleted; API restarted. |
| 11:40 | **Fix** deployed: `transaction()` helper and 5 s connection timeout. |

Time to detect: ~12 h (no alert covered hanging requests). Time to mitigate: ~37 h. Time to resolve: ~38 h.

## Root cause

The coupon checkout managed its transaction by hand and released the connection only on success. Invalid coupons threw before `COMMIT` and `release()`, leaving a connection checked out with an open transaction holding the coupon's row lock. Orders using the same coupon waited on that lock while holding connections, emptying the pool. Without a connection timeout, all other requests waited indefinitely.

## Trigger

The expired `BACK2SCHOOL` code going viral, making the invalid-coupon path frequent.

## Evidence

1. Edge: completed requests collapse; 499s at the 10 s client timeout; no 5xx.
2. Pool: 10 open, 0 idle, thousands waiting.
3. `pg_stat_activity` and `pg_blocking_pids()`: one `idle in transaction` session (last query: the coupon `SELECT … FOR UPDATE`) blocking a chain of waiters.
4. Traces of invalid-coupon checkouts: `BEGIN`, `SELECT … FOR UPDATE`, then a 400 response, with no `ROLLBACK`.

## Action items

| Type | Action | Owner |
|---|---|---|
| Prevent | Lint rule: no `pool.connect()` outside the `transaction()` helper | Backend chapter |
| Prevent | Restore and document the pool connection timeout; add `statement_timeout` and `idle_in_transaction_session_timeout` to the app's database role | DBA |
| Detect | Alerts on requests waiting for a connection and on transactions idle for more than 10 s | SRE |
| Detect | Alert on a drop of completed requests at the edge, and on 499s | SRE |
| Mitigate | Readiness check that borrows a database connection | Platform |

## Lessons learned

- **What went well**: once someone looked at the database's sessions, `pg_blocking_pids()` named the blocker immediately.
- **What went wrong**: "no errors" was read as "no bug in our code" for a day. Removing the timeout in 2.21.2 turned a visible failure into a silent one.
- **Where we got lucky**: the expired code locked only its own row. A leak in a transaction touching `products` would have blocked checkout for every product.
