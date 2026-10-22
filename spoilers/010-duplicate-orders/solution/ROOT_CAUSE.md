# Incident 010 · Root cause

> ⚠️ Spoilers. Read this after `./lab verify 010` passes, or once you've decided to stop.

## In one sentence

Since Wednesday, CrediBank takes 2.5 to 4 seconds to authorize a card, longer than app 5.2 waits before it retries a checkout. The app retries with the same Idempotency-Key, but the API has never read that header: every attempt gets a new idempotency key at PayFlow, so a new hold on the card, and a new order. After its fourth attempt, the app tells the customer that checkout failed.

## What happens

One checkout with a CrediBank card (times from a real run of the lab):

```
 0.0 s  attempt 1 → API → PayFlow, key k1 (CrediBank: 3.9 s)
 2.0 s  the app gives up on attempt 1 (499 at the edge). The API carries on.
 2.5 s  attempt 2 → API → PayFlow, key k2: a second authorization (3.2 s)
 3.9 s  attempt 1's authorization → order #1, confirmation email #1
 4.5 s  the app gives up on attempt 2
 5.5 s  attempt 3 → PayFlow, key k3 (2.6 s)
 5.7 s  order #2, email #2
 7.5 s  the app gives up on attempt 3
 8.1 s  order #3, email #3
 9.5 s  attempt 4 → PayFlow, key k4 (3.8 s)
11.5 s  the app gives up on attempt 4: "Checkout failed, please try again"
13.3 s  order #4, email #4
```

1. App 5.2 retries a checkout whose attempt takes more than 2 s, up to four attempts, with the same body and the same `Idempotency-Key`.
2. When the app gives up on an attempt, the API doesn't notice. Its request handler carries on, gets the authorization, writes the order and sends the email.
3. The API ignores `Idempotency-Key`, and calls PayFlow with `idempotencyKey: randomUUID()`. PayFlow sees four different requests and, correctly, puts four holds on the card.
4. Cards from other banks are authorized in under 0.6 s, well within the app's 2 s: their checkouts are never retried. Hence "only some customers": CrediBank's, about one card in twelve.
5. The customer sees a failed checkout, four pending charges, and four confirmation emails. Many then try again by hand.

## The evidence chain

| Observation | Where | What it means |
|---|---|---|
| PayFlow flags cards with 2 to 4 holds of the same amount, seconds apart; every one of them a `tok_credibank_…` card | PayFlow dashboard (`/v1/risk/duplicates`, `/v1/authorizations`) | One purchase, several authorizations. Only CrediBank cards. |
| The matching orders: same customer, same items and total, 2 to 5 s apart | `./lab psql` (`orders.payment_id`) | One purchase, several orders. |
| 499s for `POST /api/orders` at the edge; the API's own metrics don't show them | *Requests per second by status*, in-API latency | Clients give up on checkouts, the API doesn't know. |
| Calls to PayFlow: most well under a second, a slow group between 2.5 and 4 s | *Calls to other services*, Jaeger | Those are longer than the app waits. |
| Traces of slow checkouts: the proxy answers 499 after 2 s, while the API's work goes on: its PayFlow call ends seconds later, followed by the order's `INSERT`s | Jaeger | The API finishes work nobody waits for anymore. |
| `placeOrder` never reads `Idempotency-Key`, and gives PayFlow `randomUUID()` | The code | Nothing can recognize a retry. |

### Red herrings

- **"PayFlow charges twice."** PayFlow got four requests with four different idempotency keys. Four authorizations is the right answer to that.
- **"The app is buggy."** The app does what the integration guide says: retry with the same key. Honoring the key is the server's job.
- **"CrediBank is the problem."** Slow isn't wrong. The API has to stay correct when a dependency is slow, because one always will be.
- **"Customers double-tap."** Then duplicates would come from every bank's cards, not only CrediBank's.

## Trigger vs. root cause

- **Root cause**: order creation isn't idempotent. The API ignores the key clients send, and gives PayFlow a fresh one for every request, so a retry is indistinguishable from a new purchase.
- **Trigger**: app 5.2's automatic retries, combined with CrediBank's slow authorizations, longer than the app's 2 s timeout.
- **Why it wasn't caught**: a retry only does harm when the first attempt timed out *after* the server did the work. With PayFlow answering in half a second, that never happened in testing.

Next: [FIX.md](FIX.md) and an example [POSTMORTEM.md](POSTMORTEM.md).
