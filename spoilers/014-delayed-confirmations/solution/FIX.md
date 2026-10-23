# Incident 014 · Fix

## 1. Mitigate first (minutes)

- **Tell customers**: a banner, "Confirmation emails are delayed; your order is placed, and visible in My orders." It stops the duplicate orders.
- **Drain the backlog faster**, once the fix is out: the fixed worker clears thousands of messages in a few minutes. Without the fix, nothing short of more concurrency helps: restarting the worker resumes from the same offset, at the same pace.

## 2. Fix: many emails in flight, offsets committed when they're done

[`fix.patch`](../fix.patch) (`git apply spoilers/014-delayed-confirmations/fix.patch`):

1. **`eachBatch` instead of `eachMessage`**: the worker receives a batch of messages, every message the broker has for it, up to a size limit.
2. **Up to 32 messages handled at once** within the batch. Emails don't depend on each other, so their order doesn't matter. Throughput becomes concurrency ÷ latency: 32 ÷ 0.67 s ≈ 48 emails per second, far above the 3 orders per second, and a backlog drains quickly.
3. **The batch's offset is resolved only when every message of the batch is handled** (`eachBatchAutoResolve: false`, then `resolveOffset(batch.lastOffset())`). If the worker dies halfway, the whole batch is read again: at-least-once delivery. A message read twice means MailWave is called twice for the same order, and the idempotency key added in incident 003 (`order-confirmation-<id>`) keeps the customer from getting two emails.
4. **Heartbeats** during long batches, so the broker doesn't think the worker died and reassign its partition.

### Measured with `./lab verify 014`

Apple Silicon laptop, Docker Desktop with 2 vCPUs, ~66 req/s including ~3 orders per second, starting from an empty topic. After: two runs.

| | Before | After |
|---|---|---|
| Confirmation email delay, p95 | 39 s, and growing | 1.7 to 1.8 s |
| Messages consumed per second | ~1.5 | as many as are written |

The remaining 1.7 s are MailWave's ~650 ms, plus the time a message waits for the batch it belongs to.

### Fixes that look right but aren't

| Attempt | What happens |
|---|---|
| Run more worker instances | The topic has one partition; the extra workers are assigned nothing. |
| `partitionsConsumedConcurrently` alone | Concurrency across partitions. With one partition, nothing changes. |
| `eachMessage` with a fire-and-forget `confirm(event)` (no `await`) | Fast, and wrong: the offset is committed before the email is sent. If the worker stops, those emails are lost, which is what the topic was meant to prevent. And nothing limits how many calls run at once. |
| Commit each message as soon as it's done, out of order | A committed offset means "everything before it is done". Committing message 10 while message 7 is still in flight loses message 7 on a crash. |

## 3. Alternatives and refinements

| Approach | Verdict |
|---|---|
| More partitions, consumed concurrently (`partitionsConsumedConcurrently`) or by more worker instances | The Kafka-native way to scale a consumer group. The application has to create the topic with enough partitions (the broker's default is one), and ordering is only kept within a partition: key messages by what must stay in order. |
| MailWave's batch API, if it has one | Fewer, larger calls. |
| Alert on lag in time, not just in messages | "The oldest unprocessed order is 4 minutes old" is what matters to customers; a message count means nothing without the rate. |
| The outbox pattern on the API side | Write the event in the same transaction as the order, and publish it afterwards. Today, if the broker is down when an order is placed, its event, and its email, are lost. |

## 4. Prevent

- **Compute a consumer's throughput before shipping it**: concurrency ÷ time per message, against the expected arrival rate, with headroom. Check it again whenever a dependency gets slower.
- **Alert on consumer lag**, in messages and in age of the oldest message, per consumer group.
- **Create topics on purpose**: partitions, retention and keys chosen by the team, not left to the broker's defaults on first use.
- **Load-test consumers with realistic dependency latency**, not the 50 ms of a local mock.
