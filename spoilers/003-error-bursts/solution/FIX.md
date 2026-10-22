# Incident 003 · Fix

## 1. Mitigate first (minutes)

- **Roll back v2.18.0.** Confirmations stop until the fix ships, but checkout is stable again.
- **Or hotfix a global handler**, `process.on('unhandledRejection', (err) => logger.error(…))`. It stops the crashes immediately, but it changes the behavior of *every* unhandled rejection in the process, including ones that really should be fatal. Treat it as a tourniquet, not the fix.

## 2. Fix: background work owns its errors

[`fix.patch`](../fix.patch) (`git apply spoilers/003-error-bursts/fix.patch`):

- **Handle the promise where it's created.** `confirmOrder(order).catch(…)` logs the failure with the order id and counts it in `order_confirmation_failures_total`. A failed email never touches the request or the process.
- **Retry transient failures.** 429 and 5xx responses and network errors are retried twice, with 250 ms and 500 ms backoff. An `Idempotency-Key` per order lets the provider drop duplicates if a retry follows a request that actually went through.

### Measured with `./lab verify 003`

Apple Silicon laptop, Docker Desktop with 2 vCPUs, API container limited to 1 CPU:

| | Before | After |
|---|---|---|
| Error rate | 2.35 % | 0.00 % |
| Restarts in 60 s | 2 | 0 |
| Checkout p95 | 25 ms | 20 ms |
| MailWave 503s | crashed the process | 3 of 591 calls, all recovered by a retry |
| Emails lost | every failed one | 0 |

## 3. Alternatives

| Approach | Verdict |
|---|---|
| `await` the email inside the request | Simple and safe, but checkout latency now depends on the provider, and a provider outage fails checkouts. |
| Global `unhandledRejection` handler that logs and continues | Hides every future unhandled promise too. Node made unhandled rejections fatal precisely because silently continuing can leave the process in an unknown state. |
| Global handler that logs, then shuts down gracefully | Reasonable as a last line of defense, and it makes crashes visible in logs. It still restarts the process. |
| **Transactional outbox**: insert "send confirmation for order X" in the same transaction as the order, a worker sends it with retries | The robust design: no email lost even if the process dies right after the commit, and the API does no network call to the provider at all. |
| A queue (Kafka, SQS…) consumed by a worker | Same idea, with more moving parts; see incidents 014 and 015. |

## 4. Prevent

- **Lint**: `@typescript-eslint/no-floating-promises`, and treat `void somePromise` as something to justify in review, not a way to silence the rule.
- **Test failure paths**: run checkout tests against a MailWave double that returns 503, times out, and resets connections.
- **Detect**: alert on the first restart (`changes(process_start_time_seconds[5m]) > 0`), not only on error rates.
- **Know the runtime's defaults**: since Node.js 15, `--unhandled-rejections=throw`. An unhandled rejection is a crash, just like an uncaught exception.
