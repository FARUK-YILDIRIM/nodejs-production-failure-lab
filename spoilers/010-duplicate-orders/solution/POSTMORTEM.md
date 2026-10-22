# Postmortem · Incident 010: Duplicate orders

> An example postmortem for this incident, in the lab's blameless format. Times are from the scenario.

## Summary

From Wednesday, December 9, 08:00 to Thursday 15:30, checkouts paid with CrediBank cards were often placed two to four times: several orders, several holds on the card, several confirmation emails, and a "checkout failed" in the app. App 5.2 retries a checkout attempt after 2 s; CrediBank took 2.5 to 4 s to authorize cards. The app sent the same Idempotency-Key with every attempt, but the API ignored it and gave PayFlow a new key each time. Order creation now honors the key, end to end.

## Impact

- **Customers**: ~2,100 customers with duplicate orders: ~1,900 orders placed twice, ~600 three or four times. Holds of up to four times the amount on their cards for several days; a few overdraft fees, which ShopFlow refunded.
- **Support**: ~900 tickets in a day and a half.
- **Warehouse**: ~300 duplicate parcels shipped before the cleanup, collected at ShopFlow's expense.

## Timeline

| Time | Event |
|---|---|
| Mon, Dec 7 | App 5.2: checkout attempts are retried after 2 s, up to 4 times, with the same Idempotency-Key. |
| Wed 08:00 | CrediBank's authorizations slow down to 2.5–4 s (PayFlow status page). |
| Wed 08:05 | First duplicates. PayFlow's `DuplicateCharges` flags go to the finance mailbox. |
| Wed 10:30 | First tickets about double charges, answered as "pending authorizations disappear within a few days". |
| Thu 10:00 | Support escalates: hundreds of tickets, some customers charged four times. |
| 11:30 | Incident opened. |
| 12:15 | All flagged cards are CrediBank cards; their duplicates are seconds apart. |
| 12:40 | The mobile team confirms 5.2's retry policy and the Idempotency-Key. |
| 12:50 | The API never reads the key, and sends PayFlow a random one. |
| 13:05 | **Mitigation**: app remote config: 30 s timeout, retries off. New duplicates stop. |
| 15:30 | **Fix** deployed: idempotent order creation. |
| 17:00 | Retries back on in the app. |
| Fri | Cleanup: duplicate orders cancelled, their authorizations voided, customers emailed. |

Time to detect: ~26 h. Time to mitigate: ~29 h. Time to resolve: ~31 h 30 min.

## Root cause

Creating an order wasn't idempotent. The API ignored the `Idempotency-Key` header clients send, and called PayFlow with a new random idempotency key for every request, so neither the API nor PayFlow could tell a retry from a new purchase. Any attempt that timed out at the client *after* the API had done the work became an extra order and an extra hold on the card.

## Trigger

App 5.2's automatic retries after 2 s, combined with CrediBank's authorizations taking 2.5 to 4 s.

## Evidence

1. PayFlow's dashboard: cards with 2 to 4 holds of the same amount seconds apart, all from CrediBank.
2. The database: matching orders for the same customer and total, 2 to 5 s apart.
3. Edge: 499s on `POST /api/orders`, invisible in the API's own metrics.
4. Traces: the proxy answers 499 after 2 s; the API's PayFlow call ends seconds later, then the order is written anyway.
5. The code: `Idempotency-Key` is never read; PayFlow gets `randomUUID()`.

## Action items

| Type | Action | Owner |
|---|---|---|
| Prevent | Idempotency keys on every retryable `POST`, with a contract test | Backend chapter |
| Prevent | Retry policies agreed between client and API teams: timeouts above the server's worst normal latency, retry budgets, `Retry-After` | Mobile, Backend |
| Detect | Route `DuplicateCharges` to on-call | SRE |
| Detect | Alert on orders per checkout above 1, and on 499s for `POST` at the edge | SRE |
| Mitigate | Remote config for the app's retry policy, documented in the runbook | Mobile |
| Follow-up | Refunds of overdraft fees; apology email | Support |

## Lessons learned

- **What went well**: PayFlow's dashboard and the database told the story within an hour of the incident being opened. The app's remote config stopped the bleeding in minutes.
- **What went wrong**: the signal existed from the first minute, in a mailbox nobody on call reads. The app did the right thing, retrying with a key, and it only made things worse because the server never read it.
- **Where we got lucky**: only CrediBank was slow. Had PayFlow itself slowed down, every retried checkout of every customer would have been placed up to four times.
