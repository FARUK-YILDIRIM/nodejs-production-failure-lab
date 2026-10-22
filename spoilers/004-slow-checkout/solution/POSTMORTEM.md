# Postmortem · Incident 004: Slow checkout

> An example postmortem for this incident, in the lab's blameless format. Times are from the scenario.

## Summary

From the release of tax quotes (v2.19.0) on Monday evening until Tuesday 15:20, checkout took 1–3 seconds instead of ~50 ms. Every order opened a new connection to TaxRate and therefore resolved its host name; Node.js runs those lookups on a small thread pool, TaxRate's DNS answers in ~0.5 s, and the lookups queued. We switched the TaxRate client to pooled, reused connections.

## Impact

- **Customers**: every checkout was 1–3 s slower for ~21 hours. Conversion on the order page dropped ~4 % compared to the same day last week.
- **No errors**, which is why it took a customer complaint to notice.

## Timeline

| Time | Event |
|---|---|
| Mon 17:30 | v2.19.0 deployed: tax quotes from TaxRate on every order. |
| Tue 09:40 | `CheckoutSlow` fires; on-call paged. |
| 09:55 | Database ruled out (fast queries, idle pool). |
| 10:20 | TaxRate contacted; their dashboard shows 30 ms answers. |
| 11:05 | Client-side vs. server-side latency of TaxRate compared: ~2 s vs. 30 ms. |
| 11:30 | Pending `GetAddrInfoReqWrap` found; `getent hosts api.taxrate.example` takes ~0.5 s. |
| 11:45 | `agent: false` in the TaxRate client identified. |
| 12:00 | **Mitigation**: `UV_THREADPOOL_SIZE=16`. Queue gone, checkout ~0.7–1 s. |
| 15:20 | **Fix** deployed: quotes through the shared, pooled HTTP client. Checkout p95 60 ms. |

Time to detect: ~16 h (the alert threshold was tuned for errors, not for this latency). Time to mitigate: 2 h 20 min. Time to resolve: ~21 h 50 min.

## Root cause

The TaxRate client disabled connection reuse, so every quote performed a DNS lookup. `dns.lookup` runs on libuv's thread pool, which by default allows only 2 concurrent DNS lookups. TaxRate's DNS answers in ~0.5 s, so lookups queued behind each other at checkout volume.

## Trigger

Adding a TaxRate call to every order, against a partner whose DNS is slow.

## Evidence

1. Only `POST /api/orders` is slow; CPU, event loop and database are idle.
2. TaxRate: ~2 s as seen by the API, 30 ms as measured by TaxRate.
3. `nodejs_active_resources{type="GetAddrInfoReqWrap"}` > 0 at every scrape.
4. `getent hosts api.taxrate.example`: ~0.5 s.
5. `taxrate_connections_total` increasing by ~3/s: one connection per quote.

## Action items

| Type | Action | Owner |
|---|---|---|
| Prevent | Lint/review rule against `agent: false` and per-request clients in hot paths | Backend chapter |
| Detect | Dashboard: client- vs. server-side latency per dependency | SRE |
| Detect | Alert on pending DNS lookups | SRE |
| Mitigate | Node-local caching DNS resolver | Platform |
| Prevent | Revisit #596: document keep-alive timeouts per partner | Checkout team |

## Lessons learned

- **What went well**: the partner's own latency numbers ruled them out quickly and pointed at the gap.
- **What went wrong**: "idle CPU" was read as "healthy". A service can be slow without being busy.
- **Where we got lucky**: Postgres and MailWave connections are reused, so they only rarely queued behind TaxRate's lookups. With a database pool that reconnects often, every endpoint would have slowed down.
