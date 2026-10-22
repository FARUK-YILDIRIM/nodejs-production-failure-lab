# Postmortem · Incident 012: Errors on every deploy

> An example postmortem for this incident, in the lab's blameless format. Times are from the scenario.

## Summary

From Monday, December 14, when the API moved to two instances with rolling deploys, until Wednesday 17:40, every deploy caused about a hundred failed requests. On SIGTERM, each instance stopped accepting connections immediately, while the edge proxy kept sending it requests until its next readiness check, up to 2 s later. Instances now announce their shutdown through `/ready`, keep serving for 5 s, and only then close.

## Impact

- **Customers**: ~30 deploys over three days, each failing ~100 requests across all pages: ~3,000 errors, mostly "Something went wrong" in the app. Checkouts were mostly saved by the app's retries.
- **Engineering**: the error-rate alert never fired (the bursts are too short for its 2-minute window), so the errors were only found through app crash reports and customer messages.

## Timeline

| Time | Event |
|---|---|
| Mon, Dec 14 | The API moves to two instances behind the edge proxy, with rolling deploys and a readiness check every 2 s. |
| Mon–Wed | Every deploy: a 1 to 2 s burst of 502s, per instance. |
| Wed 10:20 | The mobile team reports a spike of "Something went wrong" errors after each deploy. |
| 11:00 | Incident opened. The 502 bursts line up with the deploy annotations. |
| 11:40 | Logs: each burst starts when an instance logs `shutting down`. |
| 12:10 | The shutdown handler closes the server at once; the proxy only learns about it at its next check. |
| 12:30 | **Mitigation**: deploys paused, except for the fix. |
| 17:40 | **Fix** deployed: drain on shutdown. The deploy that shipped it was the last one with errors. |

Time to detect: ~2 days. Time to mitigate: ~1.5 h after the incident was opened. Time to resolve: ~6.5 h.

## Root cause

The API's shutdown handler stopped accepting connections as soon as it received SIGTERM. A load balancer learns that an instance is leaving from its health checks, so for up to one check interval (2 s), the edge proxy kept sending new requests to an instance that refused them. The handler did let requests in flight finish, which is why it looked graceful; it didn't give the load balancer time to stop sending new ones.

## Trigger

Routine deploys, once the API ran as several instances behind a load balancer.

## Evidence

1. Edge: 502 bursts of 1 to 2 s, two per deploy, on every endpoint.
2. Logs: each burst starts with an instance's `shutting down`.
3. Traces: the proxy's failing requests target the instance being stopped.
4. Logs: the stopped instance only reappears 8 to 10 s later: the shutdown never completed, and the safety timer killed it.
5. Code: `/ready` passes until the server is closed.

## Action items

| Type | Action | Owner |
|---|---|---|
| Prevent | Drain on shutdown for every service, in the shared server bootstrap | Platform |
| Prevent | A load test during a deploy in CI: zero errors allowed | Platform |
| Detect | Per-deploy error count at the edge, posted to the deploy channel | SRE |
| Detect | Alert on any 5xx burst at the edge, not only on a 2-minute average | SRE |
| Document | Health check interval, drain time and grace period, side by side, in the runbook | Platform |

## Lessons learned

- **What went well**: the deploy annotations on the edge graph made the correlation obvious once someone looked.
- **What went wrong**: two days of errors went unnoticed because they never lasted long enough to trip an alert. "Graceful shutdown" was assumed, because the code said so, and tested only without a load balancer in front.
- **Where we got lucky**: the app retries checkouts with an idempotency key (since incident 010), so almost no order was lost to a deploy.
