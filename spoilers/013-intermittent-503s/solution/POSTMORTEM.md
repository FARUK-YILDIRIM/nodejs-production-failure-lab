# Postmortem · Incident 013: Intermittent 503s

> An example postmortem for this incident, in the lab's blameless format. Times are from the scenario.

## Summary

From Thursday, December 17, 16:00 to Friday 15:10, the whole site answered 503 for about ten seconds, several times an hour. Release 2.26.0 made each API instance's readiness check fail whenever any dependency was unhealthy. TaxRate's database failovers made its health endpoint report "degraded" for ten seconds at a time, so both instances failed readiness together, and the edge proxy, with no instance left, answered 503 to everything. Readiness now only checks what the instance itself needs.

## Impact

- **Customers**: ~40 outages of 10 to 15 s over 23 hours: every page failed during each of them, about 8 minutes of complete unavailability in total.
- **Revenue**: small, but visible: every outage interrupted the checkouts in progress, and some customers didn't come back.
- **Trust**: an uptime of 99.4 % for the day, against a 99.9 % objective.

## Timeline

| Time | Event |
|---|---|
| Thu, Dec 17, 16:00 | v2.26.0: `/ready` checks every dependency. |
| Thu 16:04 | First outage: 503 everywhere for 12 s. The error-rate alert stays silent: the burst is shorter than its 2-minute window. |
| Thu evening | The uptime monitor flaps about every 30 minutes. Nobody is paged: it only pages after 3 failures in a row. |
| Fri 09:30 | Customer support relays "the site keeps going down for a few seconds". |
| 10:00 | Incident opened. The API's metrics and logs show nothing during the bursts. |
| 10:40 | The edge's entry point metrics show the 503s; the proxy's log shows both instances failing their health check at the same time. |
| 11:05 | `/ready` reports TaxRate as degraded during a burst; TaxRate's status page shows database failovers at the same times. |
| 11:20 | **Mitigation**: rollback to 2.25.2. The bursts stop. |
| 15:10 | **Fix** deployed: readiness only checks the database; the dependency report moves to `/health/dependencies`. |

Time to detect: ~17.5 h. Time to mitigate: ~19 h 20 min. Time to resolve: ~23 h.

## Root cause

The readiness check, which decides whether the load balancer sends an instance traffic, included dependencies shared by every instance. When one of them, TaxRate, reported degraded performance, every instance failed readiness at the same time, and the load balancer had nothing left to send traffic to. A partial degradation (checkout slow for ten seconds) became a complete outage, and running several instances couldn't help, since their failures were correlated by design.

## Trigger

TaxRate's database failovers, during which its health endpoint reports "degraded".

## Evidence

1. Edge: 503 bursts of ~10 s on every endpoint, counted at the proxy's entry point, absent from the API's own metrics.
2. Proxy log: `Health check failed … 503` for both instances during each burst.
3. `/ready`: TaxRate reported as degraded during the bursts.
4. TaxRate: database failovers at the start of each burst.

## Action items

| Type | Action | Owner |
|---|---|---|
| Prevent | Health check guidelines: readiness checks only what the instance needs; shared dependencies never | Platform |
| Prevent | Review every service's readiness check against them | Backend chapter |
| Prevent | Evaluate fail-open behavior for the edge proxy when no instance is healthy | Platform |
| Detect | Alert on 5xx counted at the edge's entry point, including requests the proxy answers itself | SRE |
| Detect | Page on the uptime monitor after the first failure during business hours | SRE |

## Lessons learned

- **What went well**: the rollback was quick and complete once the cause was known.
- **What went wrong**: our dashboards counted requests per backend service, so requests the proxy answered on its own were invisible for hours. A change meant to make the site more robust (refuse traffic when a dependency is down) made it less available, because nobody asked what happens when the check fails everywhere at once.
- **Where we got lucky**: TaxRate's failovers last ten seconds. A longer degradation of any dependency would have taken the site down for as long.
