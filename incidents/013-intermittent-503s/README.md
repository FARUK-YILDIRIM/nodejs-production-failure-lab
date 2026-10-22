# Incident 013 · Intermittent 503s

**Difficulty** ★★☆ · **Time** 45–60 min · **Service** `shopflow-api`

> 🔁 **[FLAPPING] Uptime monitor**: the site answered 503, then recovered 12 s later (4 times in the last hour)

## The situation

It's Friday, December 18. A few times an hour, **every page** of the site answers `503 Service Unavailable` for ten seconds or so: listings, product pages, order history, checkout. Then everything works again, until the next time.

What makes it strange:

- **The API logs no errors** at those moments, and neither instance restarts.
- **The error-rate alert doesn't fire**: the bursts are over before its 2-minute window notices.
- Recent deploys, from [`app/CHANGELOG.md`](app/CHANGELOG.md):

| Version | Deployed | Change |
|---|---|---|
| 2.26.0 | yesterday | feat(ops): `/ready` checks every dependency (database, TaxRate, PayFlow, Recommendations, MailWave) |
| 2.25.2 | 2 days ago | fix(server): on SIGTERM, fail `/ready` and keep serving for 5 s before closing |

- As since Wednesday, the API runs as two instances behind the edge proxy, which checks each one's `GET /ready` every 2 s and only sends requests to the instances that pass.

## Your mission

1. **Diagnose.** Find out who answers the 503s, why both instances are affected at the same moment, and what triggers it. Then capture the first flag: `./lab submit 013`
2. **Fix.** Keep the site up when one of its dependencies has trouble: pages that don't need it must keep working. Deploy with `./lab deploy`, then capture the second flag: `./lab verify 013`
3. **Write the postmortem**: `./lab report 013`

## Your tools

| Tool | Where | Good for |
|---|---|---|
| Grafana | http://localhost:3000 | *ShopFlow · Service overview*: edge traffic by status, in-API latency, calls to other services |
| The edge proxy's logs | `./lab logs traefik` | What the proxy decides about each instance, and why |
| Logs | `./lab logs`, `./lab logs taxrate` | The API's instances; TaxRate's own log |
| Prometheus | http://localhost:9090 | Ad-hoc PromQL |
| Readiness | `curl -s localhost:8080/ready` | What an instance tells the proxy about itself (while the proxy lets you reach one) |
| The code | [`app/src`](app/src) | The last place to look, not the first |

In this lab, TaxRate's database fails over every 5 minutes, as in incident 011.

## Success criteria

`./lab verify 013` runs a normal Friday's traffic for 60 s: ~66 req/s. 10 s in, TaxRate's database fails over, and its quotes take seconds for 10 s.

| SLO | Target |
|---|---|
| Server errors (5xx) on pages that don't need TaxRate: listings, product pages, order history | = 0 |

Checkout needs TaxRate: while TaxRate is slow, some checkouts fail, and that's expected. Every functional check must pass too.

## Rules of the game

- Form a hypothesis from telemetry first; confirm it in the code last.
- Don't open `spoilers/`. If you're stuck, `./lab hint 013` reveals one hint at a time (+10 min each).
- A wrong diagnosis costs +5 min. Your score is your time to resolve; `./lab stop` pauses the clock.
