# Incident 004 · Slow checkout

**Difficulty** ★★☆ · **Time** 45–90 min · **Service** `shopflow-api`

> 🔥 **[FIRING] CheckoutSlow**: p95 of `POST /api/orders` is above 1 s

## The situation

It's early September. Yesterday ShopFlow started charging sales tax and VAT at checkout, computed by **TaxRate**, a third-party tax API. Since then, placing an order takes one to three seconds. Product pages are as fast as ever.

Support forwards:

> "The *Place order* button spins for a long time. The order does go through eventually."

What you know so far:

- Traffic is normal (~38 requests/s, ~3 orders/s).
- The API's CPU usage is low, and nothing else on the dashboard looks overloaded.
- TaxRate's status page is green, and their dashboard shows quotes answered in ~30 ms.
- Recent deploys, from [`app/CHANGELOG.md`](app/CHANGELOG.md):

| Version | Deployed | Change |
|---|---|---|
| 2.19.0 | yesterday, 17:30 | feat(checkout): sales tax / VAT on every order, from TaxRate |
| 2.18.3 | 4 days ago | perf: gzip-compress JSON responses |
| 2.18.2 | 2 weeks ago | fix(orders): background confirmations handle their own failures |

## Your mission

1. **Diagnose.** Find what checkout is waiting for and why, then capture the first flag: `./lab submit 004`
2. **Fix.** Bring checkout back to normal while every order still gets its tax from TaxRate. Deploy with `./lab deploy`, then capture the second flag: `./lab verify 004`
3. **Write the postmortem**: `./lab report 004`

## Your tools

| Tool | Where | Good for |
|---|---|---|
| Grafana | http://localhost:3000 | *ShopFlow · Service overview*: edge and in-service latency, calls to other services, Node.js runtime |
| Jaeger | http://localhost:16686 | Traces through the proxy, the API, and its calls to TaxRate and MailWave |
| Prometheus | http://localhost:9090 | Ad-hoc PromQL; TaxRate's own metrics are `taxrate_*` |
| Shell | `./lab shell` | A shell inside the API's container: `getent hosts <name>`, `cat /etc/resolv.conf`… |
| Node.js inspector | `chrome://inspect` → `127.0.0.1:9229` | CPU profiles; the Console can evaluate `process.getActiveResourcesInfo()` |
| Logs | `./lab logs api` | Slow requests |
| Database | `./lab psql` | `pg_stat_statements`, `pg_stat_activity` |
| The code | [`app/src`](app/src) | The last place to look, not the first |

## Success criteria

`./lab verify 004` runs the standard traffic mix (open model, ~38 req/s) for 60 s:

| SLO | Target |
|---|---|
| Checkout p95 | < 400 ms |
| Catalog p95 | < 250 ms |
| Error rate | < 0.5 % |

Every functional check must pass too: orders still include tax from TaxRate and still send their confirmation email.

## Rules of the game

- Form a hypothesis from telemetry first; confirm it in the code last.
- Don't open `spoilers/`. If you're stuck, `./lab hint 004` reveals one hint at a time (+10 min each).
- A wrong diagnosis costs +5 min. Your score is your time to resolve; `./lab stop` pauses the clock.
