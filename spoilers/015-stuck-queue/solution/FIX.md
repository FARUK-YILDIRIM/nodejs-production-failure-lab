# Incident 015 · Fix

## 1. Mitigate first (minutes)

- **Move the consumer group past the poison message**, by hand: stop the worker (a group can only be moved while it has no members), write `order-events 0 <offset + 1>` to a file, run `rpk group seek order-confirmations --to-file <that file>`, and start the worker again. Write the skipped message down first (`rpk topic consume order-events --offset <offset> --num 1`): its confirmation still has to be sent once the address is fixed.
- **Fix the customer's email address** with the partner, so that a replay can succeed.

Both get the queue moving today. Neither stops the next poison message.

## 2. Fix: park what can't be processed, and move on

[`fix.patch`](../fix.patch) (`git apply spoilers/015-stuck-queue/fix.patch`):

1. **Every failure is caught in `eachMessage`**, parsing included: a malformed message is as poisonous as an undeliverable one.
2. **The message is published, unchanged, to `order-events.dlq`**, ShopFlow's dead-letter topic for these events, with the reason, the source partition and offset, and the time of failure in headers. Then `eachMessage` returns normally: the offset is committed, and the next message goes through.
3. **A counter** (`order_events_dead_lettered_total`) and a log line make every parked message visible.
4. **Transient failures are still retried first**: `sendOrderConfirmation` retries MailWave's 5xx and network errors. Only what is still failing after that is parked.
5. If publishing to the dead-letter topic fails too (the broker is down), the error propagates, and the message is retried as before: nothing is lost.

### Measured with `./lab verify 015`

Apple Silicon laptop, Docker Desktop with 2 vCPUs, ~66 req/s including ~3 orders per second, and one order from customer 50001 10 s in. After: two runs.

| | Before | After |
|---|---|---|
| Confirmation email delay, p95 | 48 s, and growing | 0.3 to 0.4 s |
| Messages parked in `order-events.dlq` | none (no such topic) | 1: the partner's order |
| Confirmations sent after the poison message | none | all of them |

### Fixes that look right but aren't

| Attempt | What happens |
|---|---|
| Catch the error and log it (as before 2.28.0) | The queue moves, and the confirmation is lost silently, which is what 2.28.0 set out to fix. Nobody will send it. The second SLO catches this. |
| Retry with a longer backoff | A permanent failure stays permanent; every message behind it waits longer. |
| Validate the email in the worker and skip the order | Better than nothing, but it only covers this one kind of poison, and the confirmation still vanishes. |
| Process messages concurrently again (as in 2.27.1) | The other confirmations go out, but the batch's offset never advances: every retry sends them all again, and the lag keeps growing. |

## 3. Alternatives and refinements

| Approach | Verdict |
|---|---|
| Classify errors: permanent (4xx) to the dead-letter topic at once, transient (5xx, timeouts) retried with backoff for a bounded time | Keeps confirmations in order through a short MailWave outage, instead of parking every message during it. |
| A retry topic (`order-events.retry`) consumed with a delay | Retries transient failures later without blocking the main topic. The usual pattern at scale: main topic, then retry topics, then the dead-letter topic. |
| Pause the consumer while MailWave is down (a circuit breaker) | Nothing is parked during a real outage; consumption resumes when MailWave is back. |
| A replay tool for the dead-letter topic | On-call fixes the cause, then replays parked messages into `order-events`. Without it, a dead-letter topic is just a place where messages go to be forgotten. |
| Validate email addresses when customers are created or imported | Prevents this poison at the source. |

## 4. Prevent

- **Every consumer has a dead-letter path**, and every dead-letter topic has an owner, an alert, and a replay procedure.
- **Bound retries**: by count or by time. An unbounded retry on one message is an outage of the whole partition.
- **Alert on progress, not only on errors**: no committed offset for N minutes while the lag grows means a consumer is stuck, even if it looks healthy.
- **Test consumers with permanent failures**, not only with transient ones.
