# Incident 005 · Database overload

**Difficulty** ★☆☆ · **Time** 30–60 min · **Service** `shopflow-api`

> 🔥 **[FIRING] DatabaseBusy**: PostgreSQL has spent more than 2 s per second executing queries for 2 minutes

## The situation

It's mid-September. Since Tuesday afternoon the database has been running at full CPU, and every endpoint has gotten slower: product pages, checkout, order history. The on-call DBA pings you:

> "Postgres is pegged at 100 % CPU on the shop database. Nothing changed on our side. Can you check what the API is sending us?"

What you know so far:

- Customer traffic is normal (~38 requests/s).
- On Tuesday the SEO team launched ShopFlow's product feed on **Google Shopping**. Googlebot has been crawling product pages ever since, and the SEO team is thrilled: please don't block it.
- The database runs on a 1-vCPU instance, which has always been plenty.
- Recent deploys, from [`app/CHANGELOG.md`](app/CHANGELOG.md):

| Version | Deployed | Change |
|---|---|---|
| 2.20.0 | Monday | feat(catalog): product pages show how many units were bought |
| 2.19.2 | last week | chore(db): schema changes ship as SQL migrations, applied at startup |
| 2.19.1 | last week | fix(checkout): tax quotes use pooled connections |

## Your mission

1. **Diagnose.** Find what keeps the database busy and why, then capture the first flag: `./lab submit 005`
2. **Fix.** Bring the database back to a healthy load without removing the purchase counter or slowing Googlebot down. Deploy with `./lab deploy`, then capture the second flag: `./lab verify 005`
3. **Write the postmortem**: `./lab report 005`

Schema changes ship with the code: the API applies the SQL files in [`app/src/migrations`](app/src/migrations) at startup. `./lab verify` and `./lab reset` restore the original database first, so a change you make by hand in `psql` won't count. Only what you deploy does.

## Your tools

| Tool | Where | Good for |
|---|---|---|
| Grafana | http://localhost:3000 | *ShopFlow · Service overview*: the **Database** row (time per query, sessions, sequential scans) and everything around it |
| Database | `./lab psql` | `pg_stat_statements`, `pg_stat_activity`, `EXPLAIN (ANALYZE, BUFFERS)` |
| Prometheus | http://localhost:9090 | Ad-hoc PromQL; database metrics are `pg_*` |
| Jaeger | http://localhost:16686 | Traces through the proxy, the API and its queries |
| Logs | `./lab logs api`, `./lab logs postgres` | Slow requests; PostgreSQL logs statements slower than 500 ms |
| The code | [`app/src`](app/src) | The last place to look, not the first |

## Success criteria

`./lab verify 005` runs today's traffic (customers ~38 req/s plus Googlebot) for 60 s:

| SLO | Target |
|---|---|
| Catalog p95 | < 250 ms |
| Checkout p95 | < 400 ms |
| Error rate | < 0.5 % |
| Database time per second (pg_stat_statements) | < 1 s/s |

Every functional check must pass too: product pages still show their purchase counter.

## Rules of the game

- Form a hypothesis from telemetry first; confirm it in the code last.
- Don't open `spoilers/`. If you're stuck, `./lab hint 005` reveals one hint at a time (+10 min each).
- A wrong diagnosis costs +5 min. Your score is your time to resolve; `./lab stop` pauses the clock.
