# Incident 014 · Root cause

> ⚠️ Spoilers. Read this after `./lab verify 014` passes, or once you've decided to stop.

## In one sentence

The worker introduced in 2.27.0 sends confirmation emails one message at a time, and since MailWave moved regions each email takes ~650 ms: the worker gets through about 1.5 messages per second while orders arrive at about 3 per second, so the `order-events` topic grows by thousands of messages an hour, and every new confirmation waits behind all of them.

## What happens

```ts
// worker.ts (2.27.0)
await consumer.run({
  eachMessage: async ({ message }) => {    // kafkajs calls this for one message at a time, per partition
    await confirm(event);                  // findCustomer (~10 ms) + MailWave (~650 ms) + UPDATE (~10 ms)
  },
});
```

1. The API publishes one `order placed` event per order to `order-events`: about 3 per second on a normal day.
2. `eachMessage` handles the next message of a partition only when the previous one is done. Throughput is 1 / (time per message): ~1 / 0.67 s ≈ 1.5 per second.
3. The topic has a single partition (the broker created it on first use, with its default of one). A partition is read by one consumer of a group at a time, so this is the throughput of the whole consumer group, however many workers run.
4. Arrivals exceed throughput by ~1.5 messages per second: the lag grows by ~5,000 messages an hour, and the delay of each new confirmation with it (lag ÷ throughput): about an hour, after an hour.
5. Before MailWave's move, an email took ~90 ms: the same worker managed almost 10 per second, and nobody noticed it was sequential.

The worker isn't busy, it's waiting: its CPU is idle, and so are the database and the broker.

## The evidence chain

| Observation | Where | What it means |
|---|---|---|
| Consumer lag of `order-confirmations` growing steadily | *Queues* → *Consumer lag*, `rpk group describe` | Emails wait in the topic. |
| Messages written ≈ 3/s, consumed ≈ 1.5/s | *Queues* → *Messages per second* | The worker is slower than the orders. |
| `order_confirmation_delay_seconds` in the minutes, growing | Prometheus | What customers experience. |
| A worker trace: one call to MailWave of ~650 ms, then the next message | Jaeger, `shopflow-worker` | One message at a time; the time is spent waiting for MailWave. |
| The worker's CPU near zero | Prometheus: `rate(process_cpu_seconds_total{job="worker"}[1m])` | Not a capacity problem: a concurrency problem. |
| One partition | *Queues* → *Partitions*, `rpk topic describe order-events` | One consumer at a time: more workers wouldn't help. |

### Red herrings

- **"MailWave is slow, it's their problem."** It's slower than it was, and it isn't ours. But it answers every email, at any rate we send: our worker just never asks for more than one at a time.
- **"Run more workers."** With one partition, the extra workers sit idle in the group, assigned nothing.
- **"The broker is slow."** It writes and serves messages in milliseconds; the lag is on the consumer's side.

## Trigger vs. root cause

- **Root cause**: a consumer that handles one message at a time, behind a ~650 ms network call, on a topic with a single partition. Its throughput is capped at ~1.5 messages per second, with no way to scale it out.
- **Trigger**: MailWave's move to a new region, which made each email ~7 times slower, three days before the worker shipped.
- **Why it wasn't caught**: in testing, MailWave answered in under 100 ms, and the worker kept up with ten times the load it got. Nobody computed its throughput: concurrency ÷ latency.

Next: [FIX.md](FIX.md) and an example [POSTMORTEM.md](POSTMORTEM.md).
