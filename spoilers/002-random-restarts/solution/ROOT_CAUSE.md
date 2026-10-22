# Incident 002 · Root cause

> ⚠️ Spoilers. Read this after `./lab verify 002` passes, or once you've decided to stop.

## In one sentence

The catalog cache added in v2.17.0 keys entries by the full URL and only drops an expired entry when the *same URL* is requested again; every campaign click carries a unique `fbclid`, so almost every request adds an entry nobody will ever read, the heap grows by ~0.8 MB/s, and V8 aborts the process when it reaches its ~259 MB heap limit, about every four minutes.

## What happens

```ts
const entries = new Map<string, Entry>();          // module-level, lives forever
const key = req.originalUrl;                       // path + the whole query string
if (hit && hit.expiresAt > Date.now()) …           // expiry is only checked on a read
entries.set(key, { body, expiresAt: … });          // …and nothing ever deletes
```

- **The key is too specific.** `/api/products?category=laptops&page=2&utm_source=facebook&…&fbclid=IwAR8x…` differs from the next visitor's URL only by the click id, yet the response is identical.
- **Expiry is lazy and nothing evicts.** An entry is only replaced when its exact URL comes back. Keys with a unique click id never come back, so the entries stay in the `Map`, and so do the response bodies they reference: 48 product cards with descriptions and image URLs, ~30 KB per listing.
- **There's no bound.** The cache grows with the number of distinct URLs clients can produce, which is unlimited.

About 20 new entries per second, ~0.8 MB/s of live heap. The container has 512 MB of memory, so V8 sizes its heap limit at ~259 MB. As the heap fills up, garbage collection runs more and more often and frees less and less (latency gets spiky), until an allocation fails: `FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory`. The process aborts, the container runtime restarts it, the cache starts empty, and the cycle repeats.

## The evidence chain

| Observation | Where | What it means |
|---|---|---|
| Restarts every ~4 minutes; 502 bursts at the edge at the same moments | *API restarts (1h)*, *Requests per second by status* | The process exits; the proxy has nowhere to send requests for a few seconds. |
| `FATAL ERROR: Reached heap limit … JavaScript heap out of memory` right before each restart | `./lab logs api` | It isn't killed from outside: V8 aborts it. |
| Heap used climbs to the heap limit and drops to ~70 MB after each restart | *Memory* panel | A sawtooth with a period equal to the restarts. |
| **Live heap after full GC** climbs at the same rate | *Memory* panel | The growth survives garbage collection: something keeps references. A busy-but-healthy service would show a flat floor. |
| GC time and p95 rise in the minute before each crash | *Garbage collection*, *Latency at the edge* | The collector works harder and harder near the limit. |
| Cache hit ratio ~17 % | `http_response_cache_lookups_total` | The cache almost never serves the same key twice. |
| Thousands of new `Map` entries between two heap snapshots, keyed by URLs with `fbclid=` | Chrome DevTools → Memory → Comparison | The retainer and its keys. |
| v2.17.0 introduced the cache two days ago; the campaign started this morning | `app/CHANGELOG.md`, the brief | Latent bug, then the trigger. |

### Red herrings

- **"Traffic is up 50 %, scale up."** More instances would each leak at their share of the rate and crash a bit later. More memory delays the crash too. Neither removes the leak.
- **The `express`/`pino` bump** shipped the week before and changed nothing here.
- **"Bad Gateway" points at the proxy.** Traefik reports 502 because the API is gone, not because Traefik is broken.
- **The error-rate panel under-reports the first crash.** The 502 counter series only appears when the first 502 happens, and `rate()`/`increase()` can't count a series' very first value. Later crashes show up normally.

## Trigger vs. root cause

- **Root cause**: an unbounded cache keyed on attacker- (or marketer-) controlled input, with lazy expiry and no eviction.
- **Trigger**: the campaign. Before it, keys were bounded by the catalog (product ids, categories, pages), so memory grew slowly and plateaued. Unique click ids made the key space infinite.
- **Why it wasn't caught**: load tests replayed a fixed list of URLs, and nobody watched memory over more than a few minutes.

Next: [FIX.md](FIX.md) and an example [POSTMORTEM.md](POSTMORTEM.md).
