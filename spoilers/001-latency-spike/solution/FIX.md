# Incident 001 · Fix

## 1. Mitigate first (minutes)

A proper fix needs a code change and a review. Meanwhile, stop the bleeding:

- **Pause or rate-limit the export.** A feature flag, or an edge rule answering 503 for `/api/reports/sales`, plus a message to Finance. Catalog and checkout recover within seconds.
- **Or roll back v2.15.0.** The export loses its new columns but stops blocking.
- **Don't** grow the connection pool, add database replicas or restart instances: the database isn't the bottleneck, and every fresh instance blocks the same way as soon as it serves an export.

## 2. Fix: remove the wasted work

[`fix.patch`](../fix.patch) (`git apply spoilers/001-latency-spike/fix.patch`):

- **Let Postgres do the join.** The export query joins `products` and `categories` through their primary keys, instead of the API scanning the whole catalog once per line.
- **Reuse `Intl.NumberFormat` instances**, one per currency. Constructing one costs about as much as hundreds of `format()` calls.

The CSV stays byte-for-byte identical, which the functional checks verify.

### Measured with `./lab verify 001`

Apple Silicon laptop, Docker Desktop with 2 vCPUs, API container limited to 1 CPU:

| | Before | After |
|---|---|---|
| Catalog p95 | 1.84 s | 12 ms |
| Checkout p95 | 1.83 s | 16 ms |
| Account p95 | 1.70 s | 12 ms |
| Reports p95 | 2.56 s | 294 ms |
| CPU | 0.53 cores | 0.15 cores |
| Event loop utilization | 55 % | 19 % |
| Event loop delay (max) | 2.87 s | 159 ms |
| DB pool waiting (max) | 64 | 0 |

### Where the time went: a one-month export (~51k lines)

| Variant | Export time |
|---|---|
| Original | ~2.2 s |
| `Map` lookup instead of `Array.find`, formatter still built per call | ~1.8 s |
| Cached formatter, `Array.find` kept | ~0.75 s |
| SQL join + cached formatter (the fix) | ~0.27 s |

Both problems are real, and the formatter is the bigger one. A profiler points at it within seconds; reading the code, it's easy to look straight past a one-line helper.

## 3. Alternatives, and why they're weaker here

| Approach | Event loop | CPU | Verdict |
|---|---|---|---|
| Remove the wasted work (the fix) | freed | −70 % | Best. The cheapest work is the work you don't do. |
| `worker_threads` (e.g. Piscina) | freed | unchanged | Right tool for work that is legitimately heavy. Here it would still burn ~2 s of CPU per export; with a 1-CPU limit the worker competes with the main thread and exports get *slower*. Handing 51k rows to a worker also costs a structured clone on the main thread. |
| Cache the CSV per date range | freed for repeated ranges | lower for repeats | Hides the problem: every new range still blocks for seconds. |
| Stream the CSV in chunks, yielding between them | freed in small slices | unchanged | Keeps the API responsive and memory flat. Worth adding on top of the fix for very large exports. |
| Run exports as background jobs (queue, `worker` service, download link) | not on the API at all | moved elsewhere | The robust long-term design for bulk exports, ideally against a read replica. |

## 4. Prevent

- **Detect the cause, not only the symptom.** Alert on the event loop as well as on latency:

  ```yaml
  - alert: EventLoopBlocked
    expr: max_over_time(nodejs_eventloop_lag_max_seconds{job="api"}[1m]) > 0.5
    for: 2m
    labels:
      severity: page
  ```

- **Test with production-sized data.** A benchmark of a one-month export in CI would have shown 2 s per call before the merge.
- **Review checklist.** No expensive objects (`Intl.*`, `RegExp`, clients) constructed per item inside loops; `Map`/`Set` instead of `Array.find`/`includes` inside loops; anything that grows with "all orders" or "all products" belongs in SQL or in a background job.
- **Keep continuous profiling on.** It turns a long investigation into a two-minute one.
