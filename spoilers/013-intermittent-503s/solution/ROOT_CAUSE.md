# Incident 013 · Root cause

> ⚠️ Spoilers. Read this after `./lab verify 013` passes, or once you've decided to stop.

## In one sentence

Since 2.26.0, an instance's readiness check (`GET /ready`) fails whenever any of its dependencies is unhealthy. When TaxRate's database fails over, its health endpoint reports "degraded" for ten seconds: both instances fail readiness at the same moment, the edge proxy is left with no instance to send requests to, and it answers 503 to every request, including the many that never touch TaxRate.

## What happens

```ts
// platform/health.routes.ts (2.26.0)
const DEPENDENCIES = { database, taxrate, payments, recommendations, mailwave };

healthRouter.get('/ready', async (_req, res) => {
  const dependencies = await checkDependencies();   // GET <dependency>/health for each
  const ready = Object.values(dependencies).every((result) => result === 'ok');
  res.status(ready ? 200 : 503).json({ … });
});
```

1. TaxRate's database fails over, every few minutes in this lab. For ten seconds, quotes are slow and `GET /health` at TaxRate answers 503 (`degraded`).
2. Within 2 s, the proxy's next readiness checks hit both instances. Both ask TaxRate, both get "degraded", both answer 503.
3. The proxy takes both instances out of rotation. With no instance left, it answers `503 Service Unavailable` itself, to every request: listings, product pages, order history, checkout.
4. TaxRate recovers; within 2 s the checks pass again and the site is back. The API logged nothing: it never saw those requests.

The instances were never unable to serve. Product pages, listings and order history only need the database. Readiness turned a partial problem, checkout being slow for ten seconds, into a complete outage, and correlated it across every instance, which is exactly what running two instances was meant to prevent.

## The evidence chain

| Observation | Where | What it means |
|---|---|---|
| Bursts of 503, ~10 s long, on every endpoint, every few minutes | *Requests per second by status* (edge) | Something stops all traffic at once. |
| The API's own request metrics show no 503, and its logs nothing during a burst | In-API metrics, `./lab logs` | The API doesn't produce them; it doesn't even see those requests. |
| `Health check failed … received error status code: 503`, for both instances, every 2 s during the burst | `./lab logs traefik` | The proxy took both instances out of rotation. |
| `/ready` lists every dependency, TaxRate included, and fails if one of them does | `curl localhost:8080/ready` between bursts | Readiness can fail because of TaxRate. |
| `database failover: quotes are slow` at the start of each burst, `complete` at its end | `./lab logs taxrate` | The trigger. |
| 2.26.0: `/ready` checks every dependency | Changelog, the code | The change that made it possible. |

### Red herrings

- **"The instances crash."** They don't restart, and they keep answering whatever reaches them.
- **"The database."** It's fine; only TaxRate's status changes.
- **"The proxy is flaky."** It does exactly what it's told: no ready instance, no traffic.

## Trigger vs. root cause

- **Root cause**: readiness depends on a dependency every instance shares. A shared dependency fails for all instances at once, so readiness fails for all of them at once, and the load balancer is left with nothing.
- **Trigger**: TaxRate's database failovers, which used to slow checkout for ten seconds and now take the whole site down for ten seconds.
- **Why it wasn't caught**: each dependency check made sense on its own ("an instance that can't compute tax shouldn't get checkouts"). Nobody asked what happens when the check fails on every instance at once.

Next: [FIX.md](FIX.md) and an example [POSTMORTEM.md](POSTMORTEM.md).
