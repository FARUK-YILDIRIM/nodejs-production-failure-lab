# Incident 008 · Flash sale timeouts

**Difficulty** ★★★ · **Time** 60–90 min · **Service** `shopflow-api`

> 🔥 **[FIRING] CheckoutSlow**: p95 of `POST /api/orders` is above 1 s (currently ~8 s)

## The situation

It's Black Friday, 00:40. The sale started at midnight, with three doorbusters on the homepage: products 1, 2 and 3 (running shoes, a bicycle and headphones) at Black Friday prices. Since then:

- **Checkout takes several seconds**, up to ten, and some customers give up before it answers.
- **Product pages and "My orders" are slower too**, one to four seconds at times, although nothing about them changed.
- More alerts followed: `ApiHighLatencyP95`, `OrderHistorySlow`, then `DatabaseBusy`. Yet the database's CPU is far from busy, and so is the API's.
- Order volume is about twice a normal day, as forecast.
- PayFlow, the card payment provider, reports no incident on its status page.
- Recent deploys, from [`app/CHANGELOG.md`](app/CHANGELOG.md):

| Version | Deployed | Change |
|---|---|---|
| 2.23.0 | 9 days ago | feat(checkout): card payments with PayFlow, authorized when the order is placed |
| | | feat(catalog): stock levels; checkout reserves the stock it sells, so a product can't be oversold |
| 2.22.1 | 5 weeks ago | fix(checkout): every checkout path ends its transaction and returns its connection |

2.23.0 ran without a hitch all week.

## Your mission

1. **Diagnose.** Find out what slow checkouts wait for, what they wait behind, and why only today. Then capture the first flag: `./lab submit 008`
2. **Fix.** Make checkout fast again during the sale, while a product still can't be oversold, sold-out products and declined cards are still refused, and no customer keeps a hold on their card for an order that wasn't placed. Deploy with `./lab deploy`, then capture the second flag: `./lab verify 008`
3. **Write the postmortem**: `./lab report 008`

## Your tools

| Tool | Where | Good for |
|---|---|---|
| Grafana | http://localhost:3000 | *ShopFlow · Service overview*: latency by route, calls to other services (PayFlow, TaxRate), the database connection pool, database sessions and time by query |
| Database | `./lab psql` | `pg_stat_activity` (who is connected, doing what, waiting for what), `pg_blocking_pids()`, `pg_locks` |
| Jaeger | http://localhost:16686 | One slow checkout from start to finish, down to each query and each call to PayFlow |
| Prometheus | http://localhost:9090 | Ad-hoc PromQL |
| PayFlow dashboard | `http://localhost:8090/v1/authorizations?paymentToken=<token>` | The authorizations made with a card token. Place a test order with a token of your own (`tok_` + letters and digits) to follow it |
| Logs | `./lab logs api` | Whatever the API has to say |
| The code | [`app/src`](app/src) | The last place to look, not the first |

PayFlow is a third party: you can't change how long a card authorization takes (a few hundred milliseconds, like every card network).

## Success criteria

`./lab verify 008` runs Black Friday traffic for 60 s: ~72 req/s, including 6 orders per second, most of them with a doorbuster. Clients give up after 10 s.

| SLO | Target |
|---|---|
| Checkout p95 | < 1 s |
| Catalog p95 | < 250 ms |
| Error rate | < 0.5 % |
| Requests waiting for a database connection (max) | < 5 |

Every functional check must pass too: doorbusters can be ordered; sold-out products are refused with 409 and declined cards with 402; an order that is refused leaves no authorization on the card; totals, coupons and confirmation emails are unchanged.

## Rules of the game

- Form a hypothesis from telemetry first; confirm it in the code last.
- Don't open `spoilers/`. If you're stuck, `./lab hint 008` reveals one hint at a time (+10 min each).
- A wrong diagnosis costs +5 min. Your score is your time to resolve; `./lab stop` pauses the clock.
