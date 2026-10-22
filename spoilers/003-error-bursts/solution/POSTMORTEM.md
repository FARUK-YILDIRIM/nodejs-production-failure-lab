# Postmortem · Incident 003: Error bursts

> An example postmortem for this incident, in the lab's blameless format. Times are from the scenario.

## Summary

From Monday 16:40 to Tuesday 12:30, the ShopFlow API crashed and restarted roughly once a minute during business hours. Each crash returned 502s for a second or two and cut off every request in flight. The cause was the background order-confirmation email added in v2.18.0: when the email provider returned an error, the background promise rejected unhandled, which terminates a Node.js process. We now handle and retry those failures inside the background task.

## Impact

- **Customers**: ~2 % of requests failed during business hours. 41 customers placed duplicate orders after retrying a failed checkout.
- **Finance/Support**: duplicate orders refunded by hand.
- **Duration**: ~20 hours, overnight included (fewer orders, fewer crashes).

## Timeline

| Time | Event |
|---|---|
| Mon 16:40 | v2.18.0 deployed: background confirmation emails. |
| Mon 16:52 | First crash. `ApiHighErrorRate` fires and resolves several times; dismissed as flapping. |
| Tue 10:15 | v2.18.1 (OpenTelemetry bump) deployed. |
| 10:40 | Support escalates duplicate orders; incident opened. |
| 11:00 | OpenTelemetry bump suspected and rolled back: no change. |
| 11:20 | Restarts noticed on the dashboard; stack trace `MailWave responded 503 … confirmOrder` found in container logs. |
| 11:30 | Root cause: `void confirmOrder(order)`, an unhandled rejection. |
| 11:35 | **Mitigation**: v2.18.0 rolled back. Bursts stop. |
| 12:30 | **Fix** deployed: `.catch()` with logging and metric, retries with backoff and an idempotency key. |

Time to detect: ~18 hours (the alert flapped and was ignored). Time to mitigate: 55 min from escalation. Time to resolve: ~20 hours.

## Root cause

Order confirmation emails were sent in the background without error handling. When the email provider answered with an error, the rejected promise was unhandled, and Node.js terminates the process on an unhandled rejection.

## Trigger

The provider's normal ~0.6 % error rate, multiplied by ~3 orders per second.

## Evidence

1. 502 bursts at the edge coincide one-to-one with API restarts; memory is flat.
2. Container logs show `Error: MailWave responded 503 … at async confirmOrder` immediately before each restart.
3. MailWave's delivery log shows a 503 at each crash time.
4. `placeOrder` starts `confirmOrder` with `void`, without `await` or `.catch()`.

## Action items

| Type | Action | Owner |
|---|---|---|
| Prevent | Enable `no-floating-promises`; review every `void` on a promise | Backend chapter |
| Prevent | Move notifications to a transactional outbox processed by a worker | Orders team |
| Detect | Page on the first restart, not on a flapping error rate | SRE |
| Prevent | Failure-path tests against a provider double that errors and times out | QA |
| Mitigate | Idempotency keys on order creation, so retried checkouts don't create duplicates | Orders team |

## Lessons learned

- **What went well**: stderr output survived the crashes; the stack trace pointed straight at the cause.
- **What went wrong**: a flapping alert was treated as noise for 18 hours, and the first suspect was the most recent deploy rather than the evidence.
- **Where we got lucky**: the provider had a good day. During a real MailWave outage, every single order would have crashed the API.
