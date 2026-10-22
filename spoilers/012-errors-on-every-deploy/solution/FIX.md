# Incident 012 · Fix

## 1. Mitigate first (minutes)

- **Deploy less often, at quiet hours**, until the fix ships. It doesn't remove the errors; it moves them to when fewer people see them.
- **Retries at the proxy for idempotent requests** (`GET`) hide most of the burst from browsing customers, though not from checkouts.

## 2. Fix: announce, drain, then close

[`fix.patch`](../fix.patch) (`git apply spoilers/012-errors-on-every-deploy/fix.patch`):

1. **Announce**: on SIGTERM, `/ready` answers 503 right away (`platform/lifecycle.ts`). The proxy takes the instance out of rotation at its next check, within 2 s.
2. **Drain**: keep serving normally for 5 s, longer than the proxy's check interval, so that every request it still sends here gets an answer. Responses carry `Connection: close` meanwhile, so the proxy doesn't keep reusing connections to an instance that's about to close them.
3. **Close**: then stop accepting connections, close idle ones (`server.closeIdleConnections()`), let requests in flight finish, close the database pool and exit. All of it fits in Docker's 10 s grace period; the safety timer moves to 9 s.

### Measured with `./lab verify 012`

Apple Silicon laptop, Docker Desktop with 2 vCPUs, ~66 req/s, `api-1` then `api-2` restarted 15 s into the run. Several runs of each.

| | Before | After |
|---|---|---|
| Server errors (5xx) during the rolling restart | 100 to 190 | 0 |
| Shutdown of an instance | refused connections at once, killed by the safety timer at 8 s | 5 s of drain, then a clean exit |

### Fixes that look right but aren't

| Attempt | What happens |
|---|---|
| Make `/ready` fail, then close immediately | The proxy only reads `/ready` every 2 s: until then, same refused connections. |
| A drain shorter than the check interval | Errors on some deploys, not others, depending on where the check falls. |
| Ignore SIGTERM | The instance keeps answering `/ready` until Docker kills it after 10 s: connections reset mid-request, then refused until the next check. |
| `process.exit()` on SIGTERM | Requests in flight are cut too. |

## 3. Alternatives and refinements

| Approach | Verdict |
|---|---|
| Deregister from the load balancer explicitly (an API call to it) before draining | Faster than waiting for a health check, where the load balancer allows it. |
| Kubernetes: a `preStop` hook that sleeps, or a readiness probe that fails on SIGTERM | The same pattern: Kubernetes removes the pod from the Service's endpoints asynchronously. `terminationGracePeriodSeconds` must cover the drain plus the slowest request. |
| Retries at the proxy | A safety net for idempotent requests, not a substitute for a clean shutdown. |
| Longer-lived requests (streaming, WebSockets) | Need a longer drain, or a way to ask clients to reconnect elsewhere. |

## 4. Prevent

- **Test deploys under load**: a deploy during a load test must produce zero errors. This lab's `verify` is that test.
- **Watch errors around deploys**: annotate deploys on the dashboards, and alert on 5xx at the edge per deploy, not only on a 2-minute average that a 2-second burst never trips.
- **Know the timings**: the drain has to outlast the load balancer's health check interval, and the grace period has to outlast the drain plus the slowest request. Write them down next to each other.
