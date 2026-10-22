# Incident 010 · Fix

## 1. Mitigate first (minutes)

- **Ask the mobile team to turn the retries off**, or to raise the app's timeout above PayFlow's slowest authorizations, through remote config if the app has it. That stops new duplicates; it doesn't make the API safe.
- **Clean up**: find the duplicates (same customer, same total, within a minute), keep the first order of each group, cancel the others and void their authorizations. Tell the affected customers before their bank statement does.

## 2. Fix: one checkout, one order, one authorization

[`fix.patch`](../fix.patch) (`git apply spoilers/010-duplicate-orders/fix.patch`):

1. **Read the key.** `POST /api/orders` reads `Idempotency-Key` (8 to 128 letters, digits, `-` or `_`). Without one, nothing changes.
2. **An attempt whose order exists gets that order back.** The order remembers its key (`orders.idempotency_key`, migration `0006`). Before doing anything, `placeOrder` looks for the customer's order with that key, and returns it: same body, no new email.
3. **PayFlow recognizes retries too.** The API gives PayFlow a key derived from the app's (`order-<customer>-<key>`) instead of a random one. A retry gets the first authorization back, not a second hold.
4. **An attempt arriving while the first one is still at PayFlow** gets a `409` from PayFlow (*key in use*). The API answers `409` with `Retry-After: 1`, and the app tries again a moment later, by when the first attempt's order exists.
5. **Two attempts can still race** between PayFlow and the database. A unique index on `(customer_id, idempotency_key)` (migration `0007`, built `CONCURRENTLY`) lets only one of them write its order. The other finds the winner's order and returns it, without voiding the authorization they share.

### Measured with `./lab verify 010`

Apple Silicon laptop, Docker Desktop with 2 vCPUs, ~66 req/s including 3 checkouts per second from the app, one card in twelve from CrediBank:

| | Before | After |
|---|---|---|
| Duplicate orders | 75 | 0 |
| Card authorizations flagged as duplicates by PayFlow | ~80 | 0 |
| Checkouts the app gives up on | 10.2 % | 0 % |
| Confirmation emails per checkout | up to 4 | 1 |

A CrediBank checkout still takes its 2.5 to 4 seconds at the bank. The app now sees: a timeout, a `409` with `Retry-After`, then its order, 3.5 to 5.5 s after the customer tapped "Pay".

### Fixes that look right but aren't

| Attempt | What happens |
|---|---|
| Look up the key, then insert, without a unique index | Two attempts both find nothing and both write an order. Retries race more often than you'd think: that's exactly when the first attempt is slow. |
| Deduplicate on the order's content (same customer, same total, within a minute) | A customer who really buys the same thing twice gets one order. The functional check catches this. |
| Deduplicate orders, but keep a random key at PayFlow | Every retry still puts a new hold on the card. Voiding it afterwards leaves the customer with a pending charge for a while, and PayFlow flags it. |
| Answer `409` without `Retry-After` | The app treats it as a final refusal and tells the customer checkout failed, although the order is being placed. |
| Make the API faster | CrediBank's 2.5 to 4 seconds aren't the API's to shorten, and the next slow dependency would bring the duplicates back. |

## 3. Alternatives and refinements

| Approach | Verdict |
|---|---|
| A generic `idempotency_keys` table: key, request hash, status (`processing`, `done`), stored response, expiry | The way payment APIs do it (Stripe's design). Works for every `POST`, detects a key reused with a different body (answer `422`), and replays the exact first response. More code than tonight needs. |
| Make the second attempt wait for the first, instead of `409` + `Retry-After` | Nicer for the client, but it holds a request (and maybe a connection) open, and needs a way to wait: a lock on the key, or polling. |
| Detect a key reused with a different body | A real API should refuse it (`422`), instead of returning an order for another cart. |
| Check the replayed authorization's status | If a first attempt was refused after its authorization (sold out), PayFlow replays an authorization that was voided since. Production code should verify it before using it. |
| Expire keys | Keys only need to live as long as clients retry: a day is plenty. |

## 4. Prevent

- **Every non-idempotent endpoint that clients may retry accepts an idempotency key**, and every call to a payment provider sends one derived from it. Make it part of the API's contract, with a contract test.
- **Agree on retry policies across teams**: the client's timeout must exceed the server's worst normal latency, retries need a budget, and the server must say when a retry is welcome (`Retry-After`).
- **Detect**: route PayFlow's duplicate flags to on-call, not to a mailbox. Watch orders per checkout and 499s on `POST` at the edge.
- **Test with a slow dependency**: the bug only exists when the first attempt times out *after* the work was done.
