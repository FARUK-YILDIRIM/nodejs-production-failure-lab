# Incident 007 · Hanging requests

**Difficulty** ★★☆ · **Time** 45–75 min · **Service** `shopflow-api`

> 🔥 **[FIRING] ApiHighLatencyP95**: `shopflow-api` p95 latency at the edge is above 500 ms (currently ~10 s)

## The situation

It's mid-October. Since yesterday the API keeps freezing: requests stop getting answers, browsers spin, then give up. Restarting the API fixes everything for about a minute, then it freezes again. The night shift restarted it eleven times.

What makes it strange:

- **No errors**: no 5xx from the API, no stack traces, no error logs.
- **No load**: the API's CPU is near zero while it's frozen, and so is the database's.
- The health check (`/health`) keeps answering, so nothing restarts the API on its own.
- Recent deploys, from [`app/CHANGELOG.md`](app/CHANGELOG.md):

| Version | Deployed | Change |
|---|---|---|
| 2.22.0 | yesterday | feat(checkout): coupon codes |
| 2.21.2 | 4 days ago | fix(db): don't fail checkouts after 5 s when the pool is busy; wait for a connection instead |
| 2.21.0 | 2 weeks ago | feat(account): order history with items, for the mobile app |

Marketing mentions that an old `BACK2SCHOOL` code (25 % off, expired on September 30) is going around on TikTok again.

## Your mission

1. **Diagnose.** Find out what the frozen requests are waiting for and why it never comes, then capture the first flag: `./lab submit 007`
2. **Fix.** Keep the API answering, while valid coupons still apply and invalid ones are still refused. Deploy with `./lab deploy`, then capture the second flag: `./lab verify 007`
3. **Write the postmortem**: `./lab report 007`

## Your tools

| Tool | Where | Good for |
|---|---|---|
| Grafana | http://localhost:3000 | *ShopFlow · Service overview*: edge traffic by status, the database connection pool, database sessions |
| Database | `./lab psql` | `pg_stat_activity` (who is connected, doing what, since when), `pg_blocking_pids()`, `pg_locks` |
| Jaeger | http://localhost:16686 | Traces through the proxy and the API, down to each query |
| Prometheus | http://localhost:9090 | Ad-hoc PromQL |
| Logs | `./lab logs api` | Whatever the API has to say |
| Node.js inspector | `chrome://inspect` → `127.0.0.1:9229` | Inspect the live process |
| The code | [`app/src`](app/src) | The last place to look, not the first |

`./lab deploy` restarts the API, which also "fixes" it for a minute. Use that window, or watch the freeze build up right after a restart.

## Success criteria

`./lab verify 007` runs today's traffic (~66 req/s, about 1 order in 10 tries `BACK2SCHOOL`) for 60 s. Clients give up after 10 s.

| SLO | Target |
|---|---|
| Checkout p95 | < 400 ms |
| Catalog p95 | < 250 ms |
| Error rate | < 0.5 % |
| Requests waiting for a database connection (max) | < 5 |

Every functional check must pass too: valid coupons give their discount; expired, used-up and unknown coupons are refused with 400.

## Rules of the game

- Form a hypothesis from telemetry first; confirm it in the code last.
- Don't open `spoilers/`. If you're stuck, `./lab hint 007` reveals one hint at a time (+10 min each).
- A wrong diagnosis costs +5 min. Your score is your time to resolve; `./lab stop` pauses the clock.
