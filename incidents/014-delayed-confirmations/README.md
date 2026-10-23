# Incident 014 · Delayed confirmations

**Difficulty** ★★★ · **Time** 60–90 min · **Services** `shopflow-api`, `shopflow-worker`

> 📨 **[TICKETS]** "I paid, but got no confirmation": 37 tickets since this morning

## The situation

It's Tuesday, December 22, 10:00, the last shopping days before Christmas. Since yesterday, order confirmation emails arrive late: a few minutes yesterday afternoon, the better part of an hour this morning, and later every hour. Some customers, unsure their order went through, ordered again.

The orders themselves are fine: placed, paid, visible in "My orders".

What changed:

- **2.27.0**, deployed yesterday morning: confirmation emails are now sent by a new **worker**, from an `order-events` topic on the message broker (Redpanda, Kafka-compatible). The API publishes one event per order; the worker reads them and sends each email through MailWave. The goal: when MailWave is down, emails wait in the topic instead of being lost.
- **MailWave** moved its API to a new region last Thursday: *"slightly higher latency for some customers"*.
- From [`app/CHANGELOG.md`](app/CHANGELOG.md):

| Version | Deployed | Change |
|---|---|---|
| 2.27.0 | yesterday | feat(notifications): confirmation emails are sent by a new worker, from the `order-events` topic |
| 2.26.1 | 4 days ago | fix(ops): `/ready` only checks the database |

## Your mission

1. **Diagnose.** Find out where the emails wait, why the worker can't keep up, and whether running more workers would help. Then capture the first flag: `./lab submit 014`
2. **Fix.** Confirmations within seconds of the order, whatever the backlog. MailWave's latency and the broker aren't yours to change: the worker's code is ([`app/src/worker.ts`](app/src/worker.ts), same codebase as the API). Deploy with `./lab deploy`, then capture the second flag: `./lab verify 014`
3. **Write the postmortem**: `./lab report 014`

## Your tools

| Tool | Where | Good for |
|---|---|---|
| Grafana | http://localhost:3000 | *ShopFlow · Service overview*, row *Queues*: consumer lag, messages written and consumed, partitions |
| Prometheus | http://localhost:9090 | `kafka_consumergroup_lag`, and the worker's own metrics: `order_confirmations_sent_total`, `order_confirmation_delay_seconds` |
| Jaeger | http://localhost:16686 | Service `shopflow-worker`: what the worker does for each message, and how long it takes |
| The broker | `./lab shell redpanda`, then `rpk group describe order-confirmations`, `rpk topic describe order-events` | Consumer groups, offsets and partitions, from the broker's side |
| Logs | `./lab logs worker` | What the worker has to say |
| Node.js inspector | `chrome://inspect` → `127.0.0.1:9231` (the worker) | Inspect the live worker |
| The code | [`app/src`](app/src) | The last place to look, not the first |

## Success criteria

`./lab verify 014` empties the topic, then runs a normal Tuesday's traffic for 60 s: ~66 req/s, including about 3 orders per second.

| SLO | Target |
|---|---|
| Confirmation email delay, p95: from an order being placed to its email being accepted by MailWave | < 5 s |

Every functional check must pass too, including: placing an order sends a confirmation email.

## Rules of the game

- Form a hypothesis from telemetry first; confirm it in the code last.
- Don't open `spoilers/`. If you're stuck, `./lab hint 014` reveals one hint at a time (+10 min each).
- A wrong diagnosis costs +5 min. Your score is your time to resolve; `./lab stop` pauses the clock.
