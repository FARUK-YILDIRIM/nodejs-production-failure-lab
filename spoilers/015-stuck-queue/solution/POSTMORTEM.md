# Postmortem · Incident 015: Stuck queue

> An example postmortem for this incident, in the lab's blameless format. Times are from the scenario.

## Summary

On Wednesday, December 23, from 14:02 to 15:25, no order confirmation email went out. An order from a business customer imported with a truncated email address (`orders@balticoffice`) reached the worker; MailWave refused the address, and since 2.28.0 the worker, which handles messages in order, failed that message instead of dropping it, so its Kafka client retried it forever while every message behind it waited. Messages the worker can't process are now parked in a dead-letter topic, with the reason, and the queue moves on.

## Impact

- **Customers**: ~15,000 confirmations delayed by up to 83 minutes; one (the partner's) not sent at all until its address was fixed.
- **Support**: ~120 tickets, and ~60 duplicate orders from customers who thought their first order had failed.

## Timeline

| Time | Event |
|---|---|
| Mon, Dec 14 | A marketplace partner's customer import creates customer 50001 with the email `orders@balticoffice`. |
| Wed 09:30 | v2.28.0: the worker handles messages in order, and fails a message whose confirmation can't be sent instead of dropping it. |
| 14:02 | Customer 50001 places an order. MailWave answers 422. The worker retries it, restarts its consumer, retries again. |
| 14:13 | `ConfirmationsStuck` fires. |
| 14:20 | The worker looks healthy: running, idle, no restarts. MailWave's status page is green. |
| 14:40 | `rpk group describe`: the group's offset hasn't moved since 14:02. The worker's log repeats the same 422 for the same offset. |
| 14:55 | The message at that offset: customer 50001's order; its email address is invalid. |
| 15:05 | **Mitigation**: worker stopped, group moved one offset past the message, worker restarted. The backlog drains in ~4 minutes. |
| 15:25 | **Fix** deployed: failures go to `order-events.dlq` with the reason. The partner's next order is parked instead of blocking the queue. |
| Thu | The partner fixes the address; the parked confirmation is replayed. |

Time to detect: 11 min. Time to mitigate: ~1 h. Time to resolve: ~1 h 25 min.

## Root cause

The worker had no way out for a message that can never succeed. 2.28.0 made every failure retried, without a limit, and kept messages in strict order, so a single permanently failing message blocked all the messages after it. Before 2.28.0, the same failure was caught and logged: the queue kept moving, and the confirmation was silently lost. Neither behavior was right: a failure that can't be retried away needs to be set aside, visibly, without blocking the rest.

## Trigger

An order from customer 50001, whose email address had been truncated by a partner's import.

## Evidence

1. No confirmation sent since 14:02, lag growing at the order rate.
2. The consumer group's offset frozen at one message; the same 422 in the worker's log, again and again, for that offset.
3. The message: customer 50001's order. The customer: `orders@balticoffice`.
4. MailWave's delivery log: only refusals of that one address.

## Action items

| Type | Action | Owner |
|---|---|---|
| Prevent | A dead-letter path for every consumer, with bounded retries | Backend chapter |
| Prevent | A replay tool and runbook for dead-letter topics | Platform |
| Prevent | Validate email addresses on customer creation and on partner imports | Accounts team |
| Detect | Alert on any message in a dead-letter topic | SRE |
| Detect | Alert on a consumer group whose committed offset doesn't move while its lag grows | SRE |
| Prevent | Tests with permanent failures (invalid input, 4xx) for every consumer | Backend chapter |

## Lessons learned

- **What went well**: `ConfirmationsStuck`, added after the previous incident, fired within minutes. The broker's own tools showed the frozen offset immediately.
- **What went wrong**: a change meant to stop losing confirmations stopped all of them. It was tested against transient errors only. The worker looked perfectly healthy while doing no work.
- **Where we got lucky**: the poison message was a confirmation. Had it been a payment capture or a stock update, an hour of blocked messages would have cost far more than delayed emails.
