# Incident 015 · Root cause

> ⚠️ Spoilers. Read this after `./lab verify 015` passes, or once you've decided to stop.

## In one sentence

Customer 50001, imported from a marketplace partner with a truncated email address (`orders@balticoffice`), placed an order at 14:02; MailWave refuses that address with a 422, every time, and since 2.28.0 the worker handles messages strictly in order and fails a message it can't send instead of dropping it. Its Kafka client retries that one message forever, and every confirmation behind it waits: a poison message.

## What happens

```ts
// worker.ts (2.28.0)
await consumer.run({
  eachMessage: async ({ message }) => {
    const event = JSON.parse(…);
    await confirm(event);     // throws on MailWave's 422: no catch anymore
  },
});
```

1. The partner's order is published to `order-events` like any other.
2. The worker asks MailWave to send its confirmation. `sendOrderConfirmation` gets a 422 (`invalid_recipient`): not retryable, so it throws right away.
3. Since 2.28.0, nothing catches it: `eachMessage` throws, and the message's offset isn't committed.
4. kafkajs retries the message a few times, with backoff, then gives up on the consumer: `Restarting the consumer in …ms`. The consumer rejoins its group and resumes from the last committed offset: the same message. Back to step 2, forever.
5. Messages are handled in order, one at a time: none of the messages behind the poison one is ever reached. The lag grows by ~3 per second; not a single confirmation goes out.

Each of the two changes in 2.28.0 is reasonable on its own. Together, they mean that one message that can never succeed stops everything. Before, the same error was caught and logged: the confirmation was lost silently, which is what 2.28.0 meant to fix, but the queue kept moving.

## The evidence chain

| Observation | Where | What it means |
|---|---|---|
| `order_confirmations_sent_total` flat since 14:02; lag growing at the rate orders come in | *Queues*, Prometheus | The worker makes no progress at all. |
| The consumer group's current offset stays the same, minute after minute | `rpk group describe order-confirmations` | Stuck on one message. |
| The same error repeats in the worker's logs, for the same offset: `MailWave responded 422 … invalid_recipient`, then `Restarting the consumer` | `./lab logs worker` | That message fails every time it's retried. |
| The message: an order of customer 50001 | `rpk topic consume order-events --offset <n> --num 1` | The poison message. |
| Customer 50001's email: `orders@balticoffice`, no domain extension | `./lab psql` | Undeliverable: MailWave is right to refuse it. |
| MailWave's delivery log: dozens of 422s for that one order, nothing else | `/v1/messages?orderId=<id>` | MailWave is fine; it answers the same thing every time. |

### Red herrings

- **"MailWave is down."** It answers in milliseconds, with the same 422 for the same address.
- **"The worker is overloaded."** Its CPU is idle; it spends its time in backoff before retrying.
- **"Restart the worker."** It resumes from the last committed offset: the same message.

## Trigger vs. root cause

- **Root cause**: no way out for a message that can never succeed. Failures are retried with no limit, and processing in order means one stuck message blocks all the others.
- **Trigger**: an order from a customer whose email address the partner import had truncated.
- **Why it wasn't caught**: the change was tested with MailWave's transient errors (503s), where retrying is exactly right. Nobody tested a permanent failure.

Next: [FIX.md](FIX.md) and an example [POSTMORTEM.md](POSTMORTEM.md).
