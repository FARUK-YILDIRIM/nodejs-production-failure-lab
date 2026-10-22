# Incident 006 · Slow order history

**Difficulty** ★☆☆ · **Time** 30–45 min · **Service** `shopflow-api`

> 🔥 **[FIRING] OrderHistorySlow**: p95 of `GET /api/customers/:id/orders` is above 300 ms

## The situation

It's early October. On Monday the mobile team shipped version 3.0 of the ShopFlow app, with a new **My orders** screen: every past order with its items, product photos and categories. App reviews are great, except for this:

> "My orders takes forever to load. Like, a second. The website is fine."

What you know so far:

- Product pages, listings and checkout are as fast as usual.
- The mobile app loads the screen with `GET /api/customers/:id/orders?limit=20`, about 6 times per second across all users.
- The database is a managed instance in another availability zone, ~6 ms away, as it has been for a year.
- Recent deploys, from [`app/CHANGELOG.md`](app/CHANGELOG.md):

| Version | Deployed | Change |
|---|---|---|
| 2.21.0 | Monday | feat(account): order history includes each order's items, with product image and category |
| 2.20.2 | last week | chore(deps): bump `pg` and `express` |
| 2.20.1 | 2 weeks ago | fix(catalog): index order items by product; postmortem of the September 15 database overload |

## Your mission

1. **Diagnose.** Find out why the order history is slow, then capture the first flag: `./lab submit 006`
2. **Fix.** Make it fast again, with exactly the same response. Deploy with `./lab deploy`, then capture the second flag: `./lab verify 006`
3. **Write the postmortem**: `./lab report 006`

## Your tools

| Tool | Where | Good for |
|---|---|---|
| Jaeger | http://localhost:16686 | Traces through the proxy, the API and every query it sends |
| Grafana | http://localhost:3000 | *ShopFlow · Service overview*: per-route latency, database query time as seen by the API |
| Database | `./lab psql` | `pg_stat_statements` (calls and time per query), `EXPLAIN ANALYZE` |
| Prometheus | http://localhost:9090 | Ad-hoc PromQL |
| Logs | `./lab logs api` | Slow requests |
| The code | [`app/src`](app/src) | The last place to look, not the first |

## Success criteria

`./lab verify 006` runs today's traffic (web, mobile app and Googlebot, ~66 req/s) for 60 s:

| SLO | Target |
|---|---|
| Account (order history) p95 | < 300 ms |
| Catalog p95 | < 250 ms |
| Error rate | < 0.5 % |

Every functional check must pass too: the order history returns exactly what it returns today.

## Rules of the game

- Form a hypothesis from telemetry first; confirm it in the code last.
- Don't open `spoilers/`. If you're stuck, `./lab hint 006` reveals one hint at a time (+10 min each).
- A wrong diagnosis costs +5 min. Your score is your time to resolve; `./lab stop` pauses the clock.
