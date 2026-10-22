# Incident 011 · Fix

## 1. Mitigate first (minutes)

The loop only breaks when the load on TaxRate drops below what it can do, long enough for its queue to drain (40 s of work):

- **Shed load for a minute**: put checkout in maintenance (a 503 with `Retry-After` at the edge, or a feature flag) for 60 s, then turn it back on. TaxRate's queue drains, quotes are fast again, and with normal traffic the system stays in its good state, until the next blip.
- **Turn the API's retries off** if there's a switch for them. It's what the fix does, permanently.
- **Restarting the API doesn't help**: TaxRate's queue isn't in the API.

## 2. Fix: retries that can't multiply the load

[`fix.patch`](../fix.patch) (`git apply spoilers/011-outage-that-wont-recover/fix.patch`):

1. **At most one retry per quote**, instead of three.
2. **A retry budget**: every quote earns a tenth of a retry, and a retry spends a whole one. While TaxRate is healthy, the occasional lost request is retried. When every quote fails, the budget runs dry within seconds, and the API stops adding requests on top of the app's own retries: at most ~10 % more than what checkouts need.
3. **Full jitter**: a random pause of up to 250 ms before the retry, so retries from many checkouts don't reach TaxRate in the same instant.
4. **Only retry what a retry can fix**: timeouts, network errors and 5xx. A 4xx means the request itself is wrong; asking again won't change the answer.

During a failover, a checkout now causes at most 4 or 5 requests (the app's attempts, plus a few budgeted retries) instead of 16. That stays well below what TaxRate can compute: its queue drains as soon as the failover is over.

### Measured with `./lab verify 011`

Apple Silicon laptop, Docker Desktop with 2 vCPUs, ~66 req/s including 3 checkouts per second; TaxRate slow from 10 s to 20 s:

| | Before | After |
|---|---|---|
| Checkouts failing once TaxRate is back (last 20 s) | 98 % | 0 % |
| Requests to TaxRate per second (peak, over 15 s) | 43 | 9 |
| TaxRate's queue at the end of the run | ~1,000 (full) | 0 |

### Fixes that look right but aren't

| Attempt | What happens |
|---|---|
| Exponential backoff with jitter, still 4 attempts | Measured: 98 % of checkouts still failing at the end, 44 requests per second at peak. Backoff spreads the same requests over time; it doesn't remove any. Each checkout still ends up sending 16. |
| A shorter timeout | The API gives up sooner and retries sooner: more requests for the same capacity. |
| A longer timeout, same retries | Fewer timeouts at first, but once TaxRate's queue holds more than the timeout's worth of work, each checkout sends the same 16 requests. It only moves the tipping point. |
| Restarting the API, a bigger pool, more CPU | The queue is at TaxRate, and the API isn't short of anything. |

Removing the retries altogether also passes: the app's own retries then cover the occasional lost request. It's a fine fix; the budget keeps the benefit of a retry when TaxRate is healthy.

## 3. Alternatives and refinements

| Approach | Verdict |
|---|---|
| Circuit breaker | After a burst of failures, stop calling TaxRate for a few seconds and fail fast, then let a few requests probe. Protects TaxRate even from the app's retries, and saves checkouts from waiting a full timeout. Complements a budget. |
| Retry at one layer only | The app and the API both retry: their attempts multiply. Agree on which layer retries (usually the outermost), and tell the others with `Retry-After`. |
| Answer `503` with `Retry-After` when tax can't be computed | Tells the app to wait before its next attempt, instead of a generic 500 it retries at once. |
| Deadlines | Pass the time left to TaxRate (a header), so it can drop work whose deadline has passed instead of computing quotes nobody waits for. TaxRate isn't ours, but our own services should do this for each other. |
| Adaptive concurrency limit | Cap the API's in-flight requests to TaxRate, and lower the cap when latency rises (like TCP congestion control). |

## 4. Prevent

- **A retry policy for every dependency**, in one shared client: a timeout, at most one or two retries, jitter, a budget, and a list of retryable errors. No hand-written retry loops.
- **Watch the retry ratio**: requests sent to a dependency divided by requests needed. Alert when it climbs: that's amplification starting.
- **Load-test with a slow dependency, not just a failing one**, and check that the system comes back on its own once the slowness ends. That's the test this incident would have failed.
- **Know your dependencies' limits** (TaxRate's plan: 2 quotes at a time) and keep the worst-case load you can send them below them.
