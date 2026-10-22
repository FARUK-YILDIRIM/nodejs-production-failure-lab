# Incident 004 · Root cause

> ⚠️ Spoilers. Read this after `./lab verify 004` passes, or once you've decided to stop.

## In one sentence

The TaxRate client opens a fresh connection for every quote (`agent: false`), so every order does a DNS lookup of `api.taxrate.example`. Node runs those lookups on libuv's thread pool, where DNS may use only 2 of the 4 threads, and the lookups take ~0.5 s each. Two at a time can't keep up with three orders per second, so checkout waits in a DNS queue while the CPU sits idle.

## What happens

```ts
// TaxRate closes idle keep-alive connections after 5 s, which gave us
// ECONNRESET errors on reused sockets in staging (#596), so every quote
// uses a fresh connection.
http.request(url, { method: 'POST', agent: false, … })
```

1. **A new connection per request means a DNS lookup per request.** `agent: false` disables connection reuse. Before connecting, Node resolves the host name with `dns.lookup()`.
2. **`dns.lookup()` isn't asynchronous the way sockets are.** It calls the operating system's `getaddrinfo()`, which blocks, so Node runs it on a libuv thread-pool thread (`UV_THREADPOOL_SIZE`, 4 by default).
3. **libuv caps "slow I/O" at half of the pool.** DNS lookups count as slow I/O, so with 4 threads at most 2 lookups run at once (`(threads + 1) / 2`). The cap protects file system, crypto and zlib work, which is why gzip compression and the product pages are unaffected.
4. **TaxRate's DNS answers slowly** (~550 ms ± 150 ms; `postgres` resolves in ~5 ms through Docker's DNS). Two concurrent lookups give a capacity of about 3.6 per second, against 3 orders per second plus the occasional MailWave or Postgres reconnect. At ~85 % utilization with random arrivals, the queue keeps forming: an order waits behind several lookups before its own even starts.

The request to TaxRate itself takes 30 ms. Checkout's 1.5–2.5 s p95 is almost entirely spent queueing for, then waiting on, name resolution.

## The evidence chain

| Observation | Where | What it means |
|---|---|---|
| Only `POST /api/orders` is slow; catalog p95 stays ~12 ms | Dashboard, Jaeger | Something on the checkout path only. |
| CPU ~0.2 cores, event loop utilization ~23 %, database fast | Runtime panels, `pg_stat_statements` | Nothing is busy: checkout is waiting, not working. |
| The `taxrate` call takes 1–3 s as seen by the API… | *Latency of calls to other services*, Jaeger | The time is inside that outbound call. |
| …while TaxRate answers in ~30 ms | `taxrate_request_duration_seconds` | The time is spent *before* the request reaches TaxRate. |
| Several `GetAddrInfoReqWrap` pending at every scrape | *Active libuv resources, by type* | DNS lookups in flight or queued. |
| `getent hosts api.taxrate.example` takes ~0.5 s; `getent hosts postgres` is instant | `./lab shell` | The partner's DNS is slow. |
| `taxrate_connections_total` grows by ~3 per second | Prometheus | A new TCP connection for every quote. |
| `agent: false` in `checkout/tax.ts`, with a comment about #596 | The code | Connection reuse was deliberately turned off. |

### Red herrings

- **gzip compression (2.18.3)** does use the thread pool, and it's a reasonable suspect for anyone who knows that. But it isn't capped as slow I/O, it isn't waiting on anything, and the compressed catalog stays fast.
- **"TaxRate is slow."** Their dashboard is right: they answer in 30 ms. The slowness is on our side of the connection.
- **"It's the database."** Postgres resolves and answers in milliseconds.

## Trigger vs. root cause

- **Root cause**: a DNS lookup and a TCP handshake on every single request, through a resource with a hard concurrency limit.
- **Trigger**: the new tax call on every order, and the slow DNS of TaxRate's domain.
- **History**: `agent: false` was a fix for keep-alive `ECONNRESET` errors in staging (#596). The real cause there was reusing a socket that TaxRate was closing (Node servers close idle connections after 5 s by default). A fix for one connection-lifecycle bug created this one; incident 013 comes back to that race.

Next: [FIX.md](FIX.md) and an example [POSTMORTEM.md](POSTMORTEM.md).
