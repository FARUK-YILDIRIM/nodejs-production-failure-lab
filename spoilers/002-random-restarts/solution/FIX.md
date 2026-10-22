# Incident 002 · Fix

## 1. Mitigate first (minutes)

- **Roll back v2.17.0.** Without the cache the API serves every request from Postgres again: slower, but the database handled that load the week before.
- **Or restart on a schedule / raise the memory limit.** These only buy time, and every restart still drops in-flight requests.
- **Don't** scale out as the fix: each new instance leaks too.

## 2. Fix: a cache must be bounded

[`fix.patch`](../fix.patch) (`git apply spoilers/002-random-restarts/fix.patch`):

- **Key on what changes the response.** Each route declares the query parameters it uses (`category`, `page`, `limit`); everything else, including `utm_*` and `fbclid`, is ignored. The key space shrinks from "every URL ever seen" to the catalog itself.
- **Bound it.** The cache is a small LRU: a `Map` iterates in insertion order, so re-inserting on every hit keeps the least recently used entry first, and inserting beyond `maxEntries` evicts it. Expired entries are dropped when touched. Memory is now capped no matter what clients send.
- **One cache per route**, so a flood on one route can't evict another's entries.

### Measured with `./lab verify 002`

Apple Silicon laptop, Docker Desktop with 2 vCPUs, API container limited to 1 CPU and 512 MB, campaign traffic mix (~55 req/s):

| | Before | After |
|---|---|---|
| Live heap growth | 811 KB/s | −125 KB/s (flat) |
| Heap used (max) | 227 MB of 259 MB | 92 MB |
| Restarts | every ~4 min | none |
| Cache hit ratio | ~17 % | ~57 % |
| Catalog p95 | 13 ms | 8 ms |

The fixed cache is also a *better* cache: normalizing the key more than tripled the hit ratio.

## 3. Alternatives

| Approach | Verdict |
|---|---|
| `lru-cache` with `max`, `ttl` and `maxSize` (bytes) | Production-grade and battle-tested; a size limit in bytes is safer than an entry count when entries vary in size. |
| Strip tracking parameters at the edge (a Traefik middleware) | Good defense in depth, but the application must still never trust URLs to be bounded. |
| CDN or reverse-proxy caching with a normalized cache key | Moves the work off the API entirely; most CDNs can ignore `utm_*`/`fbclid` in the key. |
| Redis with `maxmemory` and an eviction policy | Shared across instances and bounded by configuration; costs a network hop. |
| `WeakMap` | Doesn't apply: it's keyed by objects, and nothing else holds the keys, so entries would vanish immediately. |

## 4. Prevent

- **Detect**: alert on restarts and on the live heap trend, not only on errors:

  ```yaml
  - alert: ApiMemoryLeak
    expr: deriv(nodejs_heap_used_after_gc_bytes{job="api"}[15m]) > 100e3
    for: 15m
  ```

- **Capture evidence automatically**: `--heapsnapshot-near-heap-limit=1` writes a snapshot when the heap is about to overflow, so the next crash leaves its own evidence behind.
- **Review checklist**: every cache answers three questions: what is the key, what bounds its size, and what evicts entries?
- **Load tests with realistic URLs**: replaying a fixed list of URLs can't find a key-space explosion; generate the variety real traffic has.
