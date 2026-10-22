# Postmortem · Incident 011: Outage that won't recover

> An example postmortem for this incident, in the lab's blameless format. Times are from the scenario.

## Summary

On Monday, December 14, checkout failed for everyone from 14:02 to 14:51, although its trigger, a database failover at TaxRate, lasted ten seconds. The tax quote retries added in 2.25.0 (up to 4 per attempt, without a pause), stacked on the app's own 4 attempts, turned each failing checkout into up to 16 requests to TaxRate: twice what its plan can compute. Its queue filled with requests the API had given up on, which kept new quotes failing and being retried. The loop broke when checkout was paused for a minute. Retries are now limited to one per quote, with jitter, within a budget.

## Impact

- **Customers**: 49 minutes without checkout on a Monday afternoon: ~8,800 checkout attempts failed. The app showed "Checkout failed, please try again".
- **Revenue**: an estimated 60 % of the orders of that period were lost; the rest were placed later.
- **TaxRate**: ~150,000 requests in 49 minutes, against a normal ~9,000. Their support contacted ours.

## Timeline

| Time | Event |
|---|---|
| Fri, Dec 11 | v2.25.0: TaxRate quotes are retried up to 4 times, 1 s timeout each. |
| Mon 14:02:00 | TaxRate's database fails over; quotes take 2 to 3 s. |
| 14:02:10 | TaxRate is fast again. ShopFlow's checkout doesn't recover. |
| 14:04 | `ApiHighErrorRate`, `ClientsGivingUp` and `CheckoutSlow` fire. |
| 14:10 | TaxRate: "fully operational; you're sending us a lot of traffic". |
| 14:12 | API restarted. No change. |
| 14:20 | API restarted again. No change. |
| 14:35 | Calls to TaxRate: ~50 per second, all failing, for 3 checkouts per second. TaxRate's queue is full, its quotes are all abandoned. |
| 14:41 | The retry loop in `quoteTax` is found: 4 attempts per checkout attempt, 4 checkout attempts per checkout. |
| 14:50 | **Mitigation**: checkout paused for 60 s (maintenance page). TaxRate's queue drains. |
| 14:51 | Checkout back on. It stays up. |
| 17:30 | **Fix** deployed: one retry at most, with jitter, within a retry budget. |

Time to detect: 2 min. Time to mitigate: 49 min. Time to resolve: 3 h 28 min.

## Root cause

The API retried failed tax quotes up to 3 times, immediately, on top of the app's own retries. When TaxRate slowed down, retries multiplied the load on it by up to 16, exactly when it could least absorb it. TaxRate, like most servers, computes a request even after its client gave up, so its capacity went into work nobody wanted. Once its queue was longer than the API's timeout, every request timed out and was retried: the overload sustained itself after the failover was over.

## Trigger

TaxRate's ten-second database failover.

## Evidence

1. Checkout failing since 14:02 (500 and 499), browsing fine.
2. Calls to TaxRate: ~50 per second for 3 checkouts per second, all timing out or rejected with 503.
3. TaxRate's metrics: 2 of 2 workers busy, a full queue (1,000), ~25 quotes per second computed and all abandoned.
4. Traces: each checkout attempt calls TaxRate 4 times in a row.
5. TaxRate's logs: the failover lasted ten seconds.

## Action items

| Type | Action | Owner |
|---|---|---|
| Prevent | One shared HTTP client policy: timeout, at most 1 or 2 retries, jitter, retry budget, retryable errors only | Backend chapter |
| Prevent | Retry at one layer: the app retries, the API tells it when with `Retry-After` | Backend, Mobile |
| Prevent | Circuit breaker on calls to TaxRate | Backend chapter |
| Detect | Alert on the retry ratio per dependency (requests sent / requests needed) | SRE |
| Mitigate | Runbook: metastable overload; how to shed load (checkout maintenance switch) | On-call |
| Prevent | Load test with a dependency that slows down for 10 s: the system must come back by itself | SRE |

## Lessons learned

- **What went well**: TaxRate's own metrics, and a single trace, showed the amplification once we looked at them.
- **What went wrong**: we looked for something still broken, and nothing was: TaxRate was fast, the API was fine. What was wrong was the loop between them. Two restarts cost 15 minutes and changed nothing. The retries were added to make checkout more resilient, and only ever tested against errors, never against slowness.
- **Where we got lucky**: TaxRate's queue was bounded and rejected the overflow. Without a bound, its backlog, and the time needed to drain it, would have kept growing as long as the loop lasted.
