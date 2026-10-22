# Incident 004 · Fix

## 1. Mitigate first (minutes)

- **Raise `UV_THREADPOOL_SIZE`** (e.g. 16, so up to 8 concurrent lookups). It has to be set before the pool starts, so as an environment variable, not later in code. We measured it on the original code: the DNS queue disappears, but every order still pays a ~0.5 s lookup. Checkout p50 is ~0.7 s and p95 ~1 s, still over the SLO. It buys time; it doesn't fix anything.
- **Pin the address** with an `/etc/hosts` entry (`extra_hosts`) for `api.taxrate.example`. Lookups become instant, but you've hard-coded a partner's IP and will miss their next migration.

## 2. Fix: reuse connections

[`fix.patch`](../fix.patch) (`git apply spoilers/004-slow-checkout/fix.patch`) sends quotes through the shared HTTP client (`fetch`, i.e. undici), like the MailWave client already did:

- Connections to TaxRate stay open and are reused, so a DNS lookup and a TCP handshake only happen when a new connection is needed, not on every quote.
- undici reads the server's `Keep-Alive: timeout=5` header and closes an idle connection before TaxRate does. That removes the race behind the `ECONNRESET` errors of #596, the reason `agent: false` was added in the first place.
- Quotes now show up in the same per-peer metrics and traces as every other outbound call.

### Measured with `./lab verify 004`

Apple Silicon laptop, Docker Desktop with 2 vCPUs, API container limited to 1 CPU:

| | Before | `UV_THREADPOOL_SIZE=16` | After |
|---|---|---|---|
| Checkout p95 | 1.52 s | ~1 s | 60 ms |
| Catalog p95 | 12 ms | — | 13 ms |
| DNS lookups pending | 1–8 at any time | ~0 | 0 |
| New TaxRate connections | ~3 per second | ~3 per second | none after warm-up |
| CPU | 0.21 cores | — | 0.20 cores |

CPU didn't move: the problem was never work, only waiting.

## 3. Alternatives

| Approach | Verdict |
|---|---|
| `new http.Agent({ keepAlive: true, timeout: 4_000 })` shared by all quotes | Same idea with Node's own agent. The idle timeout must stay below the server's keep-alive timeout. |
| Cache DNS answers in-process (e.g. `cacheable-lookup`) | Removes most lookups, but you now own TTL handling and failover. Better as a complement than as the fix. |
| `dns.resolve4()` (c-ares, no thread pool) through a custom `lookup` | Avoids the thread pool, but bypasses `/etc/hosts` and the system resolver configuration; a footgun in containers. |
| A local caching resolver (sidecar, node-local DNS) | The standard answer at scale (Kubernetes' NodeLocal DNSCache). Infrastructure, not application code. |

## 4. Prevent

- **Detect**: chart client-side vs. server-side latency of each dependency next to each other; when they disagree, the time is spent in between. Alert on pending lookups, e.g. `max_over_time(nodejs_active_resources{type="GetAddrInfoReqWrap"}[5m]) > 2`.
- **Review checklist**: `agent: false`, `keepAlive: false`, `Connection: close`, or a client created per request are red flags in hot paths. Ask what each outbound call costs *before* it sends a byte.
- **Know the thread pool**: `fs`, `dns.lookup`, `crypto.pbkdf2/scrypt/randomBytes` and `zlib` share 4 threads by default, and DNS may only use half of them. Size it deliberately (`UV_THREADPOOL_SIZE`) for services that lean on it.
- **Fix the right bug**: #596's `ECONNRESET` was a keep-alive timeout race. The durable fix was an idle timeout below the server's, not disabling reuse.
