# Incident 002 · Random restarts

**Difficulty** ★☆☆ · **Time** 30–60 min · **Service** `shopflow-api`

> 🔥 **[FIRING] ApiRestarting**: `shopflow-api` restarted 3 times in the last 15 minutes

## The situation

It's three weeks after the quarter-end latency incident, and ShopFlow is in the middle of its **Summer Sale**. Marketing's Facebook campaign went live this morning; traffic is up about 50 %, most of it from the ads.

Since late morning the API restarts every few minutes. Each restart is short, but customers who hit one see an error page, and Support has started forwarding messages like this:

> "The site showed 'Bad Gateway' twice while I was browsing the sale. Refreshing fixed it."

What you know so far:

- Traffic is ~55 requests/s, most of it campaign visitors landing on product listings.
- Between restarts, latency looks normal.
- Nobody restarts anything by hand: the container runtime restarts the container whenever its process exits.
- Recent deploys, from [`app/CHANGELOG.md`](app/CHANGELOG.md):

| Version | Deployed | Change |
|---|---|---|
| 2.17.1 | yesterday | fix(orders): 404 instead of 500 for unknown customers on order history |
| 2.17.0 | 2 days ago | perf(catalog): cache catalog responses in memory for 60 s |
| 2.16.1 | last week | chore(deps): bump `express` and `pino` |
| 2.16.0 | 2 weeks ago | feat(catalog): product cards show the image gallery and the description |

## Your mission

1. **Diagnose.** Find out why the process keeps dying and prove it, then capture the first flag: `./lab submit 002`
2. **Fix.** Stop the restarts without removing the catalog cache or changing any response. Deploy with `./lab deploy`, then capture the second flag: `./lab verify 002`
3. **Write the postmortem**: `./lab report 002`

## Your tools

| Tool | Where | Good for |
|---|---|---|
| Grafana | http://localhost:3000 | *ShopFlow · Service overview*: restarts, edge latency and errors, Node.js runtime (memory, GC) |
| Profiles | Grafana → Drilldown → Profiles | CPU, wall-clock and heap (`memory`) profiles over time |
| Jaeger | http://localhost:16686 | Traces through the edge proxy and the API |
| Prometheus | http://localhost:9090 | Ad-hoc PromQL, alert state |
| Logs | `./lab logs api` | Includes what the process printed right before each restart |
| Node.js inspector | `chrome://inspect` → `127.0.0.1:9229` | Heap snapshots (Memory tab), CPU profiles. Reconnect after each restart. |
| Database | `./lab psql` | `pg_stat_statements`, `EXPLAIN ANALYZE` |
| The code | [`app/src`](app/src) | The last place to look, not the first |

## Success criteria

`./lab verify 002` warms the service up for 60 s, then runs the campaign traffic mix (open model, ~55 req/s) for 120 s:

| SLO | Target |
|---|---|
| Catalog p95 | < 250 ms |
| Error rate | < 0.5 % |
| Restarts during the run | 0 |
| Live heap growth (heap in use after full GCs) | < 300 KB/s |

Every functional check must pass too: each endpoint returns exactly what it returned before, tracking parameters never change a response, and repeated catalog requests are still served from the cache.

## Rules of the game

- Form a hypothesis from telemetry first; confirm it in the code last.
- Don't open `spoilers/`. If you're stuck, `./lab hint 002` reveals one hint at a time (+10 min each).
- A wrong diagnosis costs +5 min. Your score is your time to resolve; `./lab stop` pauses the clock.
