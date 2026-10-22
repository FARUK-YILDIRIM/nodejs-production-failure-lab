# Incident 009 · Product pages down

**Difficulty** ★★☆ · **Time** 45–75 min · **Service** `shopflow-api`

> 🔥 **[FIRING] ClientsGivingUp**: clients give up on more than 1 % of API requests before getting an answer (currently ~34 %)

## The situation

It's Friday, December 4, 18:20, the busiest hour of the week. Since about 17:10, product pages don't load: browsers spin, then give up. Everything else works: listings, checkout, "My orders".

What makes it strange:

- **No 5xx at the edge**, and the API's own latency panel for product pages looks fine.
- **Google Merchant Center** started flagging products: "Landing page unavailable". Shopping ads for them are paused.
- Recent deploys, from [`app/CHANGELOG.md`](app/CHANGELOG.md):

| Version | Deployed | Change |
|---|---|---|
| 2.24.0 | 3 days ago | feat(catalog): "Customers also bought" on product pages, from the data team's Recommendations service |
| 2.23.1 | 1 week ago | fix(checkout): authorize the card before locking anything |

- The data team shipped **model v7** of Recommendations today at 17:00. Their dashboard is green: inference p99 under 40 ms, no errors. They can't roll back (v6's data is gone), and recomputing what v7 is missing will take until tomorrow morning.

## Your mission

1. **Diagnose.** Find out what product pages wait for, why it takes so long, and why it takes the whole page down. Then capture the first flag: `./lab submit 009`
2. **Fix.** Bring product pages back while Recommendations stays as it is, without giving up "Customers also bought" wherever Recommendations can answer. Deploy with `./lab deploy`, then capture the second flag: `./lab verify 009`
3. **Write the postmortem**: `./lab report 009`

## Your tools

| Tool | Where | Good for |
|---|---|---|
| Grafana | http://localhost:3000 | *ShopFlow · Service overview*: edge traffic by status, in-API latency, calls to other services, Node.js runtime |
| Jaeger | http://localhost:16686 | Traces through the proxy, the API and its calls to other services |
| Prometheus | http://localhost:9090 | Ad-hoc PromQL. Recommendations exports its own metrics too: `recs_*` |
| Logs | `./lab logs api`, `./lab logs recommendations` | What each service has to say |
| Node.js inspector | `chrome://inspect` → `127.0.0.1:9229` | Inspect the live process |
| The code | [`app/src`](app/src) | The last place to look, not the first |

Recommendations belongs to the data team: you can look at it, but you can't change it.

## Success criteria

`./lab verify 009` runs a Friday evening's traffic for 60 s: ~66 req/s, including ~35 product pages per second from shoppers and Googlebot. Clients give up after 10 s.

| SLO | Target |
|---|---|
| Product pages p95 | < 500 ms |
| Error rate | < 0.5 % |
| Product pages without "Customers also bought" from Recommendations | < 15 % |

Every functional check must pass too: when Recommendations answers, a product page is exactly what it was.

## Rules of the game

- Form a hypothesis from telemetry first; confirm it in the code last.
- Don't open `spoilers/`. If you're stuck, `./lab hint 009` reveals one hint at a time (+10 min each).
- A wrong diagnosis costs +5 min. Your score is your time to resolve; `./lab stop` pauses the clock.
