# Postmortem · Incident 008: Flash sale timeouts

> An example postmortem for this incident, in the lab's blameless format. Times are from the scenario.

## Summary

For the first three hours of Black Friday, checkout took 3 to 10 seconds, and product pages and order history took up to 4 seconds. Since 2.23.0, the checkout transaction kept the rows of the products being bought locked while it waited for the card authorization from PayFlow. With most orders containing one of three doorbusters, orders for the same product went through one at a time, and the line of waiting orders took up the API's database connections. Checkout now authorizes the card before it locks anything, and holds its locks for milliseconds.

## Impact

- **Customers**: from 00:00 to 03:10, checkout p95 between 3 and 10 s; about one checkout in eight was abandoned before it answered. Product pages and "My orders" took up to 4 s.
- **Revenue**: doorbuster sales ~35 % below forecast for the first three hours, and fewer add-on items with them.
- **Support**: ~140 tickets about a payment page that "keeps spinning".

## Timeline

| Time | Event |
|---|---|
| Wed, Nov 18 | v2.23.0: card payments with PayFlow, authorized at checkout; stock levels, reserved at checkout. A normal week follows. |
| Fri 00:00 | Black Friday sale starts; doorbusters 1, 2 and 3 on the homepage. |
| 00:04 | `CheckoutSlow` fires. |
| 00:15 | The dashboard shows PayFlow calls at ~0.7 s p95; a ticket is opened with PayFlow. PayFlow: no incident, latency as usual. |
| 00:40 | Pool size raised from 10 to 30: product pages improve, checkout doesn't; sessions waiting for locks triple. |
| 01:30 | `pg_stat_activity`: lines of sessions waiting for locks, each headed by an `idle in transaction` session. `pg_locks`: products 1, 2 and 3. |
| 01:50 | A slow checkout trace shows the TaxRate and PayFlow calls between the `SELECT … FOR UPDATE` and the `COMMIT`. |
| 02:05 | **Mitigation**: `lock_timeout = 2s` on the API's database role; pool back to 10. Pages recover; ~5 % of doorbuster checkouts fail, and most customers retry. |
| 03:10 | **Fix** deployed: authorize first, then a short transaction with conditional stock updates; void the authorization if the order can't be written. |

Time to detect: 4 min. Time to mitigate: ~2 h. Time to resolve: ~3 h 10 min.

## Root cause

The checkout transaction introduced in 2.23.0 locked the cart's product rows (`SELECT … FOR UPDATE`) and kept them locked while calling TaxRate and PayFlow, about half a second per order. Orders for the same product therefore went through one at a time: at most about two per second per product. On a normal day, orders are spread over 20,000 products and these locks never meet. On Black Friday, ~85 % of orders contained one of three doorbusters, so each doorbuster's row was locked most of the time, and waits grew to seconds. Every waiting order held one of the API's ten database connections, so every other page waited for a connection too.

## Trigger

The Black Friday doorbusters, concentrating most orders on three rows.

## Evidence

1. In-API latency: `POST /api/orders` p95 at several seconds, while PayFlow calls stayed at their usual 250–550 ms.
2. Pool: 10 of 10 connections in use, dozens of requests waiting.
3. `pg_stat_activity` and `pg_blocking_pids()`: chains of sessions waiting on `Lock` (`transactionid`, `tuple`) behind `idle in transaction` sessions whose last query was `SELECT id, stock FROM products … FOR UPDATE`.
4. `pg_locks`: the contended rows were products 1, 2 and 3.
5. `pg_stat_statements`: ~0.7 s on average for that primary-key lookup, on an idle database.
6. Traces: a lock wait at the start of every slow checkout, and the TaxRate and PayFlow calls inside the transaction.

## Action items

| Type | Action | Owner |
|---|---|---|
| Prevent | Review and lint rule: no network calls inside `transaction()` | Backend chapter |
| Prevent | `lock_timeout`, `statement_timeout` and `idle_in_transaction_session_timeout` on the API's database role | DBA |
| Prevent | Flash sale load test: most orders on a handful of products, before every major sale | SRE, Marketing |
| Detect | Alert on sessions waiting for locks for more than 1 s; `log_lock_waits = on` | SRE |
| Detect | Dashboard panel: database sessions by wait event | SRE |
| Mitigate | Runbook for lock contention: `pg_blocking_pids()`, `pg_locks`, `lock_timeout` | On-call |
| Follow-up | Retry failed voids from a background job; alert on authorizations without an order | Payments team |

## Lessons learned

- **What went well**: once someone looked at what the database's sessions were waiting for, rather than at its CPU, `pg_blocking_pids()` and one trace explained the incident in twenty minutes.
- **What went wrong**: PayFlow was blamed first because it was the slowest call we knew about. Its latency was normal; what we held while waiting for it wasn't. Raising the pool size hid the problem on product pages and made it worse in the database.
- **Where we got lucky**: PayFlow stayed fast. Card networks do slow down on Black Friday; at one second per authorization, each doorbuster would have sold one unit per second, and checkout would have stopped altogether.
