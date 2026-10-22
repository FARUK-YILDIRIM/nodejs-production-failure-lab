# Postmortem · Incident 002: Random restarts

> An example postmortem for this incident, in the lab's blameless format. Times are from the scenario.

## Summary

From 09:20 to 13:05 on the first day of the Summer Sale campaign, the ShopFlow API crashed with "JavaScript heap out of memory" about every four minutes. Each crash dropped in-flight requests and returned 502s for a few seconds. The cause was the in-memory catalog cache shipped in v2.17.0: it keyed entries by the full URL, never evicted them, and campaign links made every URL unique. We rolled the cache back, then shipped a bounded cache keyed only on meaningful parameters.

## Impact

- **Customers**: ~2 % of requests during the sale's first morning failed with 502; a few checkouts had to be retried.
- **Duration**: ~3 h 45 min of intermittent errors, 60 crashes.
- **Marketing**: campaign landing pages were the most affected, on the most expensive traffic of the quarter.

## Timeline

| Time | Event |
|---|---|
| Mon 15:10 | v2.17.0 deployed: in-memory catalog cache. Memory grows slowly and plateaus. |
| Wed 09:00 | Summer Sale campaign starts on Facebook. |
| 09:20 | First out-of-memory crash. |
| 10:05 | `ApiRestarting` fires; on-call paged. |
| 10:20 | Restarts correlated with the memory sawtooth; `FATAL ERROR … heap out of memory` in the logs. |
| 10:40 | Live heap (after GC) found to grow ~0.8 MB/s; cache hit ratio 17 %. |
| 11:10 | Heap snapshot comparison: tens of thousands of cache entries keyed by URLs with `fbclid`. |
| 11:15 | **Mitigation**: v2.17.0 rolled back. Restarts stop. |
| 13:00 | **Fix** deployed: bounded LRU, keys from declared parameters. |
| 13:05 | Verified under campaign traffic: flat live heap, no restarts. |

Time to detect: 45 min (the alert needed 2 restarts in 15 min; the first ones went unnoticed). Time to mitigate: ~2 h. Time to resolve: ~3 h 45 min.

## Root cause

The cache stored every successful catalog response in a module-level `Map` keyed by `req.originalUrl`. Expired entries were only replaced when the same URL was requested again. Campaign links carry a unique `fbclid` per click, so nearly every request added an entry that was never read again, keeping ~30 KB of product cards alive each time.

## Trigger

The Facebook campaign: it turned a key space bounded by the catalog into an unbounded one.

## Evidence

1. Restart times match the peaks of the memory sawtooth.
2. `FATAL ERROR: Reached heap limit` in the logs before each restart.
3. Live heap after full GC rising ~0.8 MB/s: the memory is retained, not just allocated.
4. Cache hit ratio ~17 %.
5. Heap snapshot comparison: the `Map` behind `cacheResponses` gaining thousands of entries per minute, keys containing `fbclid=`.

## Action items

| Type | Action | Owner |
|---|---|---|
| Detect | Alert on live heap growth and on the first restart, not the second | SRE |
| Detect | Start the API with `--heapsnapshot-near-heap-limit=1` | SRE |
| Prevent | Cache review checklist: key, bound, eviction | Backend chapter |
| Prevent | Strip tracking parameters at the edge | Platform |
| Prevent | Load tests generate realistic, unique URLs | QA |

## Lessons learned

- **What went well**: the heap-after-GC line made "leak" vs. "busy" obvious within minutes.
- **What went wrong**: the first restarts went unnoticed for 45 minutes, and the error panel under-reported the first crash.
- **Where we got lucky**: the cache only stored catalog responses. Had it cached personalized responses keyed by URL, it would have leaked customer data between sessions as well.
