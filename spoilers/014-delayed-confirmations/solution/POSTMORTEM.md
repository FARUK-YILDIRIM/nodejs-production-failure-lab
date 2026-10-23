# Postmortem · Incident 014: Delayed confirmations

> An example postmortem for this incident, in the lab's blameless format. Times are from the scenario.

## Summary

From Monday, December 21 to Tuesday 11:40, order confirmation emails arrived later and later, up to 70 minutes after the order. The worker introduced in 2.27.0 sent them one at a time, and MailWave, since its move to a new region, took ~650 ms per email: the worker managed ~1.5 emails per second for ~3 orders per second, and the backlog in the `order-events` topic grew all day. The worker now sends up to 32 emails at once, and commits its progress only when they're all sent.

## Impact

- **Customers**: ~15,000 confirmations delayed, by up to 70 minutes. Orders themselves were never affected.
- **Duplicate orders**: ~180 customers, unsure their order went through, ordered again. Refunded on Tuesday.
- **Support**: ~400 tickets in two days.

## Timeline

| Time | Event |
|---|---|
| Thu, Dec 17 | MailWave moves its API to a new region: ~90 ms per email becomes ~650 ms. |
| Mon, Dec 21, 09:00 | v2.27.0: confirmation emails are sent by a new worker, from the `order-events` topic. |
| Mon 12:00 | Delays of a few minutes. Nobody is alerted: there is no alert on consumer lag. |
| Mon 19:00 | Evening peak: delays of ~30 minutes. |
| Mon night | Fewer orders than the worker's ~1.5 per second: the backlog shrinks, but isn't gone by morning. |
| Tue 08:30 | Support: 37 tickets since the morning. |
| 10:00 | Incident opened. |
| 10:20 | *Queues* panel: ~12,000 messages of lag; written ~3/s, consumed ~1.5/s. |
| 10:35 | The worker is scaled to 4 instances. No change: the topic has one partition, and three of them get nothing. Scaled back. |
| 10:50 | A worker trace: one MailWave call of ~650 ms per message, one message at a time. MailWave's region move found on its status page. |
| 11:30 | **Fix** deployed: up to 32 emails in flight, offsets resolved per batch. |
| 11:36 | Backlog drained. Delays back to ~2 s. |

Time to detect: ~25 h. Time to mitigate and resolve: ~1 h 40 min after the incident was opened.

## Root cause

The worker processed messages strictly one after the other, each one waiting ~650 ms for MailWave, on a topic with a single partition. Its throughput, about 1.5 messages per second, was below the arrival rate, and nothing in its design allowed it to go faster: neither more concurrency within the worker, nor more workers, since a single partition can only be consumed by one member of a group.

## Trigger

MailWave's move to a new region, which made each email about seven times slower, days before the worker shipped. In testing, with MailWave answering in ~90 ms, the same worker had ten times the capacity it needed.

## Evidence

1. Consumer lag of `order-confirmations` on `order-events`, growing all day, and `order_confirmation_delay_seconds` in the tens of minutes.
2. Messages written ≈ 3/s, consumed ≈ 1.5/s.
3. Worker traces: one ~650 ms MailWave call per message, back to back; the worker's CPU nearly idle.
4. `rpk topic describe order-events`: one partition. Scaling to 4 workers: 3 idle members.

## Action items

| Type | Action | Owner |
|---|---|---|
| Prevent | Throughput estimate (concurrency ÷ latency vs. arrival rate) in the design review of every consumer | Backend chapter |
| Prevent | Create topics explicitly, with partitions chosen for the expected load | Platform |
| Prevent | Outbox pattern for order events, so a broker outage can't lose them | Backend chapter |
| Detect | Alert on consumer lag in messages, and on the age of the oldest unprocessed message | SRE |
| Detect | Alert on the confirmation delay (`order_confirmation_delay_seconds` p95 > 1 min) | SRE |
| Mitigate | Status banner template for "confirmations delayed" | Support |

## Lessons learned

- **What went well**: the topic did its job: no email was lost, they were only late. Once the queue panels were open, the cause was clear.
- **What went wrong**: we had no alert on lag, so customers detected the problem for us, a day late. Scaling out was tried before anyone checked the partition count. A dependency got seven times slower and nobody re-checked the consumer's capacity.
- **Where we got lucky**: the backlog was a day's worth of emails. With a retention of a few hours on the topic, some confirmations would have been dropped before being sent.
