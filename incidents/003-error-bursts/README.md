# Incident 003 · Error bursts

**Difficulty** ★☆☆ · **Time** 30–45 min · **Service** `shopflow-api`

> 🔥 **[FIRING] ApiHighErrorRate**: more than 1 % of `shopflow-api` requests are failing

## The situation

It's the last week of August and back-to-school orders are rolling in. Since yesterday afternoon the error-rate alert keeps firing and resolving on its own. Every minute or so a burst of requests fails, then everything looks fine again.

Support forwards two messages:

> "I got 'Bad Gateway' when I clicked *Place order*, so I clicked again. Now I have two identical orders."

> "Your site keeps glitching for a couple of seconds. It's fine if I wait."

What you know so far:

- Traffic is normal (~38 requests/s, ~3 orders/s).
- Between bursts, latency is normal.
- MailWave, the transactional email provider, reports no incident on its status page.
- Recent deploys, from [`app/CHANGELOG.md`](app/CHANGELOG.md):

| Version | Deployed | Change |
|---|---|---|
| 2.18.1 | today, 10:15 | chore(deps): bump OpenTelemetry packages; trace outbound `fetch` calls |
| 2.18.0 | yesterday, 16:40 | feat(orders): order confirmation emails through MailWave, sent in the background |
| 2.17.3 | 2 weeks ago | fix(catalog): `limit` above 100 returns 400 instead of 500 |

## Your mission

1. **Diagnose.** Find what causes the bursts and prove it, then capture the first flag: `./lab submit 003`
2. **Fix.** Stop the bursts while still sending every confirmation email. Deploy with `./lab deploy`, then capture the second flag: `./lab verify 003`
3. **Write the postmortem**: `./lab report 003`

## Your tools

| Tool | Where | Good for |
|---|---|---|
| Grafana | http://localhost:3000 | *ShopFlow · Service overview*: errors, restarts, calls to other services, runtime |
| Jaeger | http://localhost:16686 | Traces through the proxy, the API and its calls to MailWave |
| Prometheus | http://localhost:9090 | Ad-hoc PromQL, alert state |
| Logs | `./lab logs api` | Everything the process wrote, including right before it stopped |
| MailWave delivery log | http://localhost:8025/v1/messages?orderId=123 | The provider's view of every message the API sent for an order |
| Profiles | Grafana → Drilldown → Profiles | CPU and memory profiles |
| Database | `./lab psql` | Orders, customers, `pg_stat_statements` |
| The code | [`app/src`](app/src) | The last place to look, not the first |

## Success criteria

`./lab verify 003` runs the standard traffic mix (open model, ~38 req/s) for 60 s:

| SLO | Target |
|---|---|
| Error rate | < 0.5 % |
| Checkout p95 | < 400 ms |
| Restarts during the run | 0 |

Every functional check must pass too, including: placing an order still sends its confirmation email through MailWave.

## Rules of the game

- Form a hypothesis from telemetry first; confirm it in the code last.
- Don't open `spoilers/`. If you're stuck, `./lab hint 003` reveals one hint at a time (+10 min each).
- A wrong diagnosis costs +5 min. Your score is your time to resolve; `./lab stop` pauses the clock.
