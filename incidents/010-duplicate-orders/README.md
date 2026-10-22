# Incident 010 · Duplicate orders

**Difficulty** ★★☆ · **Time** 60–90 min · **Service** `shopflow-api`

> 🔥 **[FIRING] DuplicateCharges**: PayFlow flagged possible duplicate charges in the last 10 minutes

## The situation

It's Thursday, December 10, 11:30. Since yesterday morning, customer support has been flooded: customers were charged two, three, even four times for a single purchase, and got as many confirmation emails. Many of them say the app told them that checkout had **failed**.

What we know:

- Most customers are fine: support counts a few hundred complaints out of thousands of orders.
- **ShopFlow app 5.2** shipped on Monday. From its release notes: *"Checkout works better on slow networks: an attempt that takes longer than 2 seconds is retried automatically, up to 4 attempts, with the same Idempotency-Key, as PayFlow's integration guide recommends."*
- **PayFlow's status page**, since Wednesday 08:00: *"Degraded performance: authorizations of cards issued by CrediBank take several seconds. Their engineers are working on it."*
- The API itself hasn't changed in a while. From [`app/CHANGELOG.md`](app/CHANGELOG.md):

| Version | Deployed | Change |
|---|---|---|
| 2.24.2 | 2 days ago | chore(deps): bump `pg`, `express` and the OpenTelemetry packages |
| 2.24.1 | 5 days ago | fix(catalog): product pages wait at most 250 ms for Recommendations |

## Your mission

1. **Diagnose.** Find out where the extra orders come from, why they turn into new orders and new charges, and why only some customers get them. Then capture the first flag: `./lab submit 010`
2. **Fix.** One order and one card authorization per checkout, however many times the app retries, and every checkout still gets an answer. The app, PayFlow and CrediBank aren't yours to change. Deploy with `./lab deploy`, then capture the second flag: `./lab verify 010`
3. **Write the postmortem**: `./lab report 010`

## Your tools

| Tool | Where | Good for |
|---|---|---|
| Grafana | http://localhost:3000 | *ShopFlow · Service overview*: edge traffic by status, in-API latency, calls to other services |
| Jaeger | http://localhost:16686 | Traces through the proxy, the API and its calls to PayFlow |
| Database | `./lab psql` | The orders themselves: who ordered what, when |
| PayFlow dashboard | `http://localhost:8090/v1/risk/duplicates` | The possible duplicate charges PayFlow flagged. Then `/v1/authorizations?paymentToken=<token>` for every authorization on that card |
| Prometheus | http://localhost:9090 | Ad-hoc PromQL, including PayFlow's own metrics: `payflow_*` |
| Logs | `./lab logs api` | Whatever the API has to say |
| The code | [`app/src`](app/src) | The last place to look, not the first |

Schema changes ship with the code: the API applies the SQL files in [`app/src/migrations`](app/src/migrations) at startup. `./lab verify` and `./lab reset` restore the original database first, so a change you make by hand in `psql` won't count. Only what you deploy does.

## Success criteria

`./lab verify 010` runs a normal Thursday's traffic for 60 s: ~66 req/s, including 3 checkouts per second from the app, about one card in twelve issued by CrediBank.

| SLO | Target |
|---|---|
| Duplicate orders: same customer, same total, within a minute | = 0 |
| Card authorizations PayFlow flags as duplicates | = 0 |
| Checkouts the app gives up on, after all its attempts | < 1 % |

Every functional check must pass too: totals, coupons, stock, declined cards and confirmation emails work as before, and a customer who buys the same thing twice on purpose still gets two orders.

## Rules of the game

- Form a hypothesis from telemetry first; confirm it in the code last.
- Don't open `spoilers/`. If you're stuck, `./lab hint 010` reveals one hint at a time (+10 min each).
- A wrong diagnosis costs +5 min. Your score is your time to resolve; `./lab stop` pauses the clock.
