# Incident 008 · Fix

## 1. Mitigate first (minutes)

- **Make lock waits fail fast**: `ALTER ROLE shop SET lock_timeout = '2s'`, then restart the API so its connections pick it up. Orders that would wait longer fail instead of holding a connection: product pages and order history recover, and some doorbuster checkouts fail with an error. A trade-off, not a fix.
- **Don't raise the pool size.** It moves the line from the pool into PostgreSQL and makes it longer: more orders waiting on the same three rows, which still sell about two units per second each.
- **Taking the doorbusters off the homepage** would work. It's also the one thing nobody will accept on Black Friday.

## 2. Fix: nothing slow while holding locks

[`fix.patch`](../fix.patch) (`git apply spoilers/008-flash-sale-timeouts/fix.patch`):

1. **Price and authorize first, outside any transaction.** Read the coupon without locking it, get the tax quote, and ask PayFlow to authorize the card. That still takes half a second, but holds nothing other checkouts need.
2. **Then a short transaction**, a few milliseconds of database work:
   - take the stock with one conditional statement per product, in product id order so two carts can't deadlock: `UPDATE products SET stock = stock - $2 WHERE id = $1 AND stock >= $2 RETURNING id`. No row back means not enough stock left: `409`.
   - lock and redeem the coupon, checking it again: it may have been used up in the meantime.
   - write the order.
3. **Compensate when the order can't be written.** If the transaction fails (sold out, coupon used up, database error), void the authorization, so the customer's card isn't held for an order that doesn't exist.

The conditional `UPDATE` is what keeps doorbusters from being oversold, without a long lock. When two orders want the last unit, both `UPDATE`s target the same row; the second waits for the first to commit (milliseconds now), then re-evaluates `stock >= $2` on the new version of the row, matches nothing, and the order gets a `409`.

### Measured with `./lab verify 008`

Apple Silicon laptop, Docker Desktop with 2 vCPUs, API limited to 1 CPU, ~72 req/s including 6 orders per second, ~85 % of them with a doorbuster. Two runs of each; lock queues vary a lot from one run to the next:

| | Before | After |
|---|---|---|
| Checkout p95 | 2.2–4.0 s | 650–670 ms |
| Catalog p95 | 210–920 ms | 27–28 ms |
| Order history p95 | 0.4–1.9 s | 45–56 ms |
| Error rate | 0 % | 0 % |
| Requests waiting for a connection (max) | 49–66 | 0 |
| Sessions waiting for a lock | 5 to 7 at any time | 0 |
| Locking the stock (`SELECT … FOR UPDATE`, then `UPDATE … WHERE stock >= $2`), mean | ~700 ms | < 1 ms |

The remaining checkout time is mostly PayFlow (250–550 ms) and TaxRate (~50 ms): work the customer has to wait for anyway, but no longer while blocking anyone else. The 60 s run starts right after a deploy, before the lines have fully formed. With the background traffic running for a few minutes, the original code is worse: `POST /api/orders` p95 between 5 and 10 s, product pages and order history between 1 and 4 s.

## 3. Alternatives

| Approach | Verdict |
|---|---|
| A bigger pool | More orders waiting on the same rows. Pages recover partly; checkout doesn't. |
| Reserve the stock, commit, then authorize the card | Also keeps locks short. A declined card (2 % of orders) then has to give the stock back in a second transaction. Equivalent: choose the order whose compensation is cheaper and safer for you. |
| `FOR UPDATE NOWAIT` / `SKIP LOCKED` | Fails or skips instead of waiting: most doorbuster orders would fail. Stock is one row per product; there's nothing to skip to. |
| `lock_timeout`, `statement_timeout` | Necessary guard rails, not a fix: they turn waiting into errors. |
| Read the stock, then `SET stock = stock - $2` without a condition | A race: two orders read "1 left" and both take it. The `CHECK (stock >= 0)` constraint turns the oversell into a 500. The conditional `UPDATE` is atomic. |
| A reservations table with expiry (reserve, pay, confirm or release) | The robust pattern when paying can take minutes (3-D Secure, wallets): no lock at all while the customer pays. More moving parts, worth it at scale. |
| Split a hot product's stock over several rows | For hundreds of orders per second on one product. Not needed once locks last milliseconds. |

### Refinements

- **Check the stock before authorizing**, with a plain read, so a sold-out product is refused before the card is touched. Keep the conditional `UPDATE` as the source of truth for races.
- **Make the void reliable**: if the void call itself fails, retry it from a background job, and alert on authorizations without an order. Authorizations expire on their own after a few days, but a hold on a customer's card in the meantime is a support ticket.

## 4. Prevent

- **No network calls inside a transaction.** Make it a review rule, or a lint rule: no `fetch` or `callService` inside a `transaction()` callback. A transaction should contain database statements and nothing else.
- **Guard rails on the database role**: `lock_timeout`, `statement_timeout` and `idle_in_transaction_session_timeout`. A session `idle in transaction` for more than a fraction of a second is a smell.
- **Detect**: alert on sessions waiting for locks for more than a second, and turn on `log_lock_waits` so PostgreSQL logs every wait longer than `deadlock_timeout` (1 s) with the blocking process.
- **Load-test the hot path**: a flash sale is many customers buying the same few products. Test that, not an average day times two.
