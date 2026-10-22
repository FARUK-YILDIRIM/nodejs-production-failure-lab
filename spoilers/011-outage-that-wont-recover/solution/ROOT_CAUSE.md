# Incident 011 · Root cause

> ⚠️ Spoilers. Read this after `./lab verify 011` passes, or once you've decided to stop.

## In one sentence

Since 2.25.0, the API asks TaxRate for a quote up to 4 times per checkout attempt, without a pause, and the app makes up to 4 attempts per checkout. When TaxRate's failover made quotes fail for ten seconds, each checkout turned into up to 16 requests: about 48 per second, twice what TaxRate can compute. Its queue filled with requests the API had already given up on, so quotes kept failing, and being retried, long after the failover was over: a failure that sustains itself.

## What happens

```ts
// checkout/tax.ts (2.25.0)
for (let attempt = 1; attempt <= 4; attempt++) {
  try {
    const response = await callService('taxrate', url, { …, signal: AbortSignal.timeout(1_000) });
    if (response.ok) return …;
  } catch (err) { … }           // timed out, or 503: ask again, right away
}
```

1. **Normal**: 3 checkouts per second, 3 quotes per second. TaxRate computes 2 quotes at a time in 60 to 100 ms each, about 25 per second: it's 12 % busy.
2. **The trigger (14:02)**: for ten seconds, quotes take 2 to 3 s. The API gives up on each after 1 s and asks again, 4 times; the app sees a failed attempt and tries again, 4 times. Each checkout becomes up to 16 requests, about 48 per second, while TaxRate completes less than one per second. Its queue grows by hundreds.
3. **TaxRate is fast again, and it doesn't matter.** Every new request waits behind hundreds of queued ones, more than a second, so the API gives up on it and retries. TaxRate still computes each abandoned quote, then throws it away. 48 requests per second keep arriving for 25 per second of capacity: the queue stays full (1,000), the overflow is rejected with 503, which the API also retries.
4. **Nothing breaks the loop.** Restarting the API drops its in-flight retries, but TaxRate's queue still holds 40 s of work nobody wants, and the new API's first quotes wait behind it. The loop only stops if the load drops below 25 per second long enough for the queue to drain.

This is a **metastable failure**: the system has two stable states for the same load, and a short trigger moved it from the good one to the bad one. What keeps it there (retries, abandoned work) isn't what put it there (the failover).

## The evidence chain

| Observation | Where | What it means |
|---|---|---|
| Checkout fails since 14:02 (500, and 499 when the app gives up after 2 s); browsing is fine | *Requests per second by status* | Only the path through TaxRate is affected. |
| Calls to TaxRate: ~50 per second, all failing (timeouts and 503), for 3 checkouts per second | *Calls to other services* | Each checkout causes ~16 requests. |
| `taxrate_workers_busy` = 2 of 2, `taxrate_queue_length` ≈ 1,000 | Prometheus | TaxRate runs at full capacity. |
| `taxrate_requests_total{reason="abandoned"}` ≈ 25/s, `reason="ok"` ≈ 0 | Prometheus | All of that capacity goes into quotes nobody waits for. |
| `reason="queue_full"`: the rest is rejected with 503 | Prometheus | Its queue is full. |
| A checkout trace: four `POST` to TaxRate back to back, each failing after 1 s or right away | Jaeger | The API's retries: no pause, no limit beyond 4. |
| Logs: `database failover: quotes are slow` at 14:02, `database failover complete` 10 s later | `./lab logs taxrate` | The trigger was over in seconds. |

### Red herrings

- **"TaxRate is still broken."** It computes 25 quotes per second, as its plan allows. They're all for requests nobody waits for anymore.
- **"Restart the API."** TaxRate's queue doesn't care: the new process's requests wait behind the old one's.
- **"Shorter timeouts."** Giving up sooner means retrying sooner: more requests, same capacity.
- **"Ask TaxRate for a bigger plan."** It would recover from this trigger, and the next bigger one would bring it back: 16 requests per checkout is the problem, not 25 per second.

## Trigger vs. root cause

- **Root cause**: retries that multiply load exactly when the dependency can least afford it: up to 4 per attempt, with no pause and no budget, stacked on the app's own 4 attempts. Plus timeouts that abandon work the server still does.
- **Trigger**: TaxRate's ten-second database failover.
- **Why it wasn't caught**: retries were tested against errors (a 503 here and there), where they help. Never against slowness, where they turn into load.

Next: [FIX.md](FIX.md) and an example [POSTMORTEM.md](POSTMORTEM.md).
