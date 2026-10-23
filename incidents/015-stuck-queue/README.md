# Incident 015 · Stuck queue

**Difficulty** ★★★ · **Time** 45–75 min · **Services** `shopflow-api`, `shopflow-worker`

> 🔥 **[FIRING] ConfirmationsStuck**: no order confirmation sent for 10 minutes, while orders keep coming in

## The situation

It's Wednesday, December 23, 14:40. Since about 14:02, not a single order confirmation email has gone out, for anyone. Orders are placed and paid as usual.

What makes it strange:

- **The worker is running**: no crash, no restart, its CPU idle.
- **MailWave is up**: its status page is green, and it answers the worker's requests in under 100 ms.
- Recent deploys, from [`app/CHANGELOG.md`](app/CHANGELOG.md):

| Version | Deployed | Change |
|---|---|---|
| 2.28.0 | this morning | feat(notifications): the worker handles order events in order again, one at a time: order status emails (shipped, delivered) are coming, and must never overtake the confirmation |
| | | fix(notifications): a confirmation that can't be sent is no longer dropped with an error in the log: the message fails, and is retried from the topic |
| 2.27.1 | yesterday | fix(notifications): the worker sends up to 32 confirmation emails at once |

- ShopFlow's convention for message consumers: a message a consumer gives up on is published, unchanged, to `<topic>.dlq`, with the reason in a header. Nothing is lost, and someone can replay it once the cause is fixed.

## Your mission

1. **Diagnose.** Find out why confirmations stopped, what is special about the message the worker is stuck on, and what a consumer should do with such a message. Then capture the first flag: `./lab submit 015`
2. **Fix.** Confirmations flow again, and a confirmation that can't be sent isn't lost. MailWave, the broker and the customer data aren't yours to change: the worker's code is ([`app/src/worker.ts`](app/src/worker.ts)). Deploy with `./lab deploy`, then capture the second flag: `./lab verify 015`
3. **Write the postmortem**: `./lab report 015`

## Your tools

| Tool | Where | Good for |
|---|---|---|
| Grafana | http://localhost:3000 | *ShopFlow · Service overview*, row *Queues*: consumer lag, messages written and consumed |
| Logs | `./lab logs worker` | What the worker, and its Kafka client, have to say |
| The broker | `./lab shell redpanda`, then `rpk group describe order-confirmations`, or `rpk topic consume order-events --offset <n> --num 1` | Offsets, and the content of any message |
| MailWave's delivery log | `http://localhost:8025/v1/messages?orderId=<id>` | Every attempt to send an order's confirmation, with MailWave's answer |
| Database | `./lab psql` | Orders and customers |
| Prometheus | http://localhost:9090 | `kafka_consumergroup_lag`, `order_confirmations_sent_total`, `mailwave_requests_total` |
| The code | [`app/src`](app/src) | The last place to look, not the first |

## Success criteria

`./lab verify 015` empties the topic, then runs a normal Wednesday's traffic for 60 s: ~66 req/s, including about 3 orders per second, and one order from the customer at the heart of this incident.

| SLO | Target |
|---|---|
| Confirmation email delay, p95: from an order being placed to its email being accepted by MailWave | < 5 s |
| Undeliverable confirmations parked in `order-events.dlq` | ≥ 1 |

Every functional check must pass too, including: placing an order sends a confirmation email.

## Rules of the game

- Form a hypothesis from telemetry first; confirm it in the code last.
- Don't open `spoilers/`. If you're stuck, `./lab hint 015` reveals one hint at a time (+10 min each).
- A wrong diagnosis costs +5 min. Your score is your time to resolve; `./lab stop` pauses the clock.
