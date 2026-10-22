# Incident 013 · Fix

## 1. Mitigate first (minutes)

- **Roll back 2.26.0.** Its readiness check is the whole problem; the previous one only checked the database.
- If a rollback isn't possible: the proxy's health check is configuration, and pointing it at `/health` (liveness) instead of `/ready` would stop the bursts. It would also give up the drain on shutdown from incident 012, so only as a stopgap.

## 2. Fix: readiness is about the instance, not about the world

[`fix.patch`](../fix.patch) (`git apply spoilers/013-intermittent-503s/fix.patch`):

1. **`/ready` checks what every request needs**: the instance isn't shutting down, and it can reach the database. Without the database the instance can't serve anything, so taking it out of rotation is right. And if the database is down for every instance, the site is down either way.
2. **TaxRate, PayFlow, Recommendations and MailWave aren't part of readiness.** When one of them has trouble, the requests that need it fail or degrade on their own, with the timeouts, fallbacks and retries from earlier incidents. The rest of the site keeps working.
3. **The dependency report moves to `GET /health/dependencies`**: still there for dashboards and humans, never read by the proxy.

### Measured with `./lab verify 013`

Apple Silicon laptop, Docker Desktop with 2 vCPUs, ~66 req/s, TaxRate slow from 10 s to 20 s:

| | Before | After |
|---|---|---|
| Server errors on pages that don't need TaxRate | 599 | 0 |
| The whole site during TaxRate's failover | 503 for ~12 s | up |
| Checkouts the app gives up on, over the run | 12 % | 15 % |

Checkout needs TaxRate either way: while it's slow, about as many checkouts fail with or without the fix (a few more, now that they wait for TaxRate instead of getting an instant 503). Making checkout itself resilient to TaxRate's failovers is a different fix: a cached tax rate per country, or a queue.

### Fixes that look right but aren't

| Attempt | What happens |
|---|---|
| A longer timeout on the dependency checks | TaxRate's health endpoint answers right away, with 503. Time isn't the problem. |
| Ignore the readiness check when *all* instances fail it | That's a "fail open" load balancer: a sensible safety net (some load balancers do it), but the proxy isn't yours here, and the next shared problem would still flap. |
| Check only "critical" dependencies: the database and TaxRate | The bursts stay: TaxRate is shared too. Any shared dependency in readiness fails every instance at once. |

## 3. Alternatives and refinements

| Approach | Verdict |
|---|---|
| Degrade the feature, not the instance | When TaxRate is down, answer checkouts with a clear `503` and `Retry-After`, or queue them; the instance stays ready for everything else. |
| Per-dependency circuit breakers | Fail fast on the requests that need a broken dependency, without probing it for every request. |
| Fail-open at the load balancer | If every instance is unhealthy, keep sending traffic to all of them: a broken health check then can't take everything down. Envoy and AWS's load balancers can do this. |
| Liveness, readiness and startup checks, each with a narrow job | Liveness: "restart me if I'm stuck". Readiness: "send me traffic". Startup: "I'm still booting". None of them should be "is the world OK?". |

## 4. Prevent

- **Review health checks like code that can take the site down**, because it can. For each check, ask what happens if it fails on every instance at once.
- **Monitor dependencies separately**: dashboards and alerts on calls per dependency, and on `/health/dependencies` if useful, not through the load balancer.
- **Watch the edge, not just the service**: requests answered by the proxy itself (no instance available) never appear in the API's metrics. Count requests at the entry point.
