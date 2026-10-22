# Incident 012 · Errors on every deploy

**Difficulty** ★★☆ · **Time** 45–75 min · **Service** `shopflow-api`

> 🔁 **[RECURRING]** Every deploy: about a hundred requests fail with 502 at the edge

## The situation

It's Wednesday, December 16. After Monday's outage, the platform team made deploys safer:

- The API now runs as **two instances**, `api-1` and `api-2`, behind the edge proxy.
- A deploy replaces them **one at a time**: `api-2` keeps serving while `api-1` restarts, then the other way round.
- The proxy checks each instance's `GET /ready` **every 2 seconds**, and only sends requests to the instances that pass.

The promise was zero-downtime deploys. Yet every deploy, about ten a day, comes with a burst of 502s on every endpoint. The mobile app shows "Something went wrong"; checkouts mostly survive, thanks to the app's retries.

The API's code hasn't changed in this area: it has shut down "gracefully" since its first version. From [`app/CHANGELOG.md`](app/CHANGELOG.md):

| Version | Deployed | Change |
|---|---|---|
| 2.25.1 | yesterday | fix(checkout): one retry at most for TaxRate quotes, within a retry budget |
| 2.25.0 | 5 days ago | feat(checkout): retry TaxRate quotes |

## Your mission

1. **Diagnose.** Find out exactly when the 502s happen, and what an instance does wrong when it's told to stop. Then capture the first flag: `./lab submit 012`
2. **Fix.** Deploys without a single failed request. The proxy, its 2 s readiness check and Docker's 10 s grace period before it kills a container aren't yours to change: the fix is in [`app/src`](app/src). Deploy with `./lab deploy` (it's a rolling deploy, too), then capture the second flag: `./lab verify 012`
3. **Write the postmortem**: `./lab report 012`

## Your tools

| Tool | Where | Good for |
|---|---|---|
| A deploy | `./lab deploy` | Replaces `api-1`, then `api-2`, with the traffic on: the incident, on demand |
| Grafana | http://localhost:3000 | *ShopFlow · Service overview*: edge traffic by status, with each deploy as an annotation |
| Logs | `./lab logs` | Both instances, interleaved: what each one does, and when |
| Prometheus | http://localhost:9090 | Ad-hoc PromQL; `up{job="api"}` per instance |
| Jaeger | http://localhost:16686 | The proxy's view of the failing requests |
| Node.js inspectors | `chrome://inspect` → `127.0.0.1:9229` (`api-1`), `127.0.0.1:9230` (`api-2`) | Inspect a live process |
| The code | [`app/src`](app/src) | The last place to look, not the first |

## Success criteria

`./lab verify 012` runs a normal Wednesday's traffic for 60 s: ~66 req/s. 15 s in, it restarts `api-1`, waits until it's healthy, then restarts `api-2`, as a deploy does.

| SLO | Target |
|---|---|
| Server errors (5xx) during the rolling restart | = 0 |

Every functional check must pass too: what the API answers doesn't change.

## Rules of the game

- Form a hypothesis from telemetry first; confirm it in the code last.
- Don't open `spoilers/`. If you're stuck, `./lab hint 012` reveals one hint at a time (+10 min each).
- A wrong diagnosis costs +5 min. Your score is your time to resolve; `./lab stop` pauses the clock.
