# Incident 011 · Outage that won't recover

**Difficulty** ★★★ · **Time** 60–90 min · **Service** `shopflow-api`

> 🔥 **[FIRING] ApiHighErrorRate**: more than 1 % of API requests are failing (currently ~7 %)

## The situation

It's Monday, December 14, 14:20. At 14:02, TaxRate, the sales tax provider, had a database failover: for about ten seconds, every quote took seconds. Their status page says *"14:02 · Elevated latency during a database failover. Resolved."*

Checkout has been failing ever since, for everyone. Browsing works.

What makes it strange:

- **TaxRate says it's fine**: fully operational, processing ShopFlow's requests as fast as its plan allows. Their support adds that ShopFlow sends them *"a lot of traffic"*.
- **The on-call restarted the API twice.** It changed nothing.
- Nothing changed today. From [`app/CHANGELOG.md`](app/CHANGELOG.md):

| Version | Deployed | Change |
|---|---|---|
| 2.25.0 | 3 days ago | feat(checkout): retry TaxRate quotes, so that a blip at TaxRate doesn't fail a checkout |
| 2.24.3 | 4 days ago | fix(checkout): placing an order is idempotent |

- The app hasn't changed either: since 5.2, it retries a checkout attempt that takes more than 2 s or fails with a 5xx, up to 4 attempts.

## Your mission

1. **Diagnose.** Find out what keeps checkout down now that TaxRate is back, what TaxRate is busy with, and how much work a single checkout creates. Then capture the first flag: `./lab submit 011`
2. **Fix.** Make checkout recover by itself after a blip at TaxRate, without flooding it. The app and TaxRate aren't yours. Deploy with `./lab deploy`, then capture the second flag: `./lab verify 011`
3. **Write the postmortem**: `./lab report 011`

## Your tools

| Tool | Where | Good for |
|---|---|---|
| Grafana | http://localhost:3000 | *ShopFlow · Service overview*: edge traffic by status, in-API latency, calls to other services |
| Prometheus | http://localhost:9090 | Ad-hoc PromQL. TaxRate exports its own metrics too: `taxrate_*` |
| Jaeger | http://localhost:16686 | Traces of checkouts, down to each call to TaxRate |
| Logs | `./lab logs api`, `./lab logs taxrate` | What each service has to say |
| The code | [`app/src`](app/src) | The last place to look, not the first |

In this lab, TaxRate's database fails over every 5 minutes, so you can watch it happen, and watch your fix ride it out.

## Success criteria

`./lab verify 011` runs a normal Monday's traffic for 60 s: ~66 req/s, including 3 checkouts per second. 10 s in, TaxRate's database fails over, and its quotes take seconds for 10 s, as at 14:02.

| SLO | Target |
|---|---|
| Checkouts failing once TaxRate is back (the last 20 s) | < 1 % |
| Requests to TaxRate per second (peak, over 15 s) | < 20 |

Every functional check must pass too: totals, coupons, stock, payments and confirmation emails work as before.

## Rules of the game

- Form a hypothesis from telemetry first; confirm it in the code last.
- Don't open `spoilers/`. If you're stuck, `./lab hint 011` reveals one hint at a time (+10 min each).
- A wrong diagnosis costs +5 min. Your score is your time to resolve; `./lab stop` pauses the clock.
