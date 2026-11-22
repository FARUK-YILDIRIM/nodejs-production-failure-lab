# Incident 001 · Latency spike

**Difficulty** ★☆☆ · **Time** 30–60 min · **Service** `shopflow-api`

> 🔥 **[FIRING] ApiHighLatencyP95**: `shopflow-api` p95 latency at the edge is above 500 ms (currently ~2 s)

## The situation

You are on call for **ShopFlow**, the API behind an online store: catalog browsing, checkout, customer order history and Finance's sales exports.

It is Tuesday afternoon, the last business day of the quarter. The latency alert just fired, and Support forwards this:

> "A few customers say product pages sometimes hang for a second or two, then load fine. Checkout feels sluggish too. Nothing is actually down."

What you know so far:

- Traffic is normal for a Tuesday afternoon (~38 requests/s).
- The error rate is normal.
- ShopFlow's p95 latency is normally around **20 ms**.
- Nobody touched the infrastructure today. Recent deploys, from [`app/CHANGELOG.md`](app/CHANGELOG.md):

| Version | Deployed | Change |
|---|---|---|
| 2.15.1 | today, 11:40 | fix(orders): reject orders with more than 10 line items |
| 2.15.0 | yesterday, 18:10 | feat(reports): sales export includes SKU, product name, category and formatted prices |
| 2.14.3 | yesterday, 18:10 | chore(deps): bump `pg` to 8.23 |
| 2.14.2 | June 26 | perf(catalog): composite index for category listings |

## Your mission

1. **Diagnose.** Find what makes the API slow and prove it with evidence, then capture the first flag: `./lab submit 001`
2. **Fix.** Make latency healthy again without removing or changing any functionality. Deploy with `./lab deploy`, then capture the second flag: `./lab verify 001`
3. **Write the postmortem**: `./lab report 001`

## Your tools

| Tool | Where | Good for |
|---|---|---|
| Grafana | http://localhost:3000 | The *ShopFlow · Service overview* dashboard: edge vs. in-service latency, runtime, database |
| Profiles | Grafana → Drilldown → Profiles | CPU and wall-clock flame graphs over time, and diffs between two time ranges |
| Jaeger | http://localhost:16686 | Traces through the edge proxy and the API |
| Prometheus | http://localhost:9090 | Ad-hoc PromQL, alert state |
| Logs | `./lab logs api` | Slow and failed requests, with trace ids |
| Database | `./lab psql` | `pg_stat_statements`, `EXPLAIN ANALYZE` |
| Node.js inspector | `chrome://inspect` → `127.0.0.1:9229` | CPU profiles, heap snapshots |
| The code | [`app/src`](app/src) | The last place to look, not the first |

`./lab traffic off` pauses the simulated customers (handy to profile a single request); `./lab traffic on` brings them back.

## Success criteria

`./lab verify 001` runs the standard traffic mix (open model, ~38 req/s) for 60 s and measures it from the client side:

| SLO | Target |
|---|---|
| Catalog p95 | < 250 ms |
| Checkout p95 | < 400 ms |
| Account p95 | < 300 ms |
| Reports p95 | < 3 s |
| Error rate | < 1 % |

Every functional check must pass too: each endpoint has to return **exactly** what it returned before, byte for byte. Removing or degrading a feature is not a fix.

## Rules of the game

- Form a hypothesis from telemetry first; confirm it in the code last.
- Don't open `spoilers/`. If you're stuck, `./lab hint 001` reveals one hint at a time (+10 min each).
- A wrong diagnosis costs +5 min. Your score is your time to resolve; `./lab stop` pauses the clock.
