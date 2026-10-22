# Incident 003 · Root cause

> ⚠️ Spoilers. Read this after `./lab verify 003` passes, or once you've decided to stop.

## In one sentence

v2.18.0 sends order confirmations in the background with `void confirmOrder(order)`. When MailWave answers with an error (about 0.6 % of calls, normal for any provider), that promise rejects with nothing to handle it, and since Node.js 15 an unhandled rejection terminates the process. Every few dozen orders the whole API dies, taking every in-flight request with it, and restarts.

## What happens

```ts
// Customers shouldn't wait for the email provider: confirm in the background.
void confirmOrder(order);   // started, never awaited, never .catch()-ed
return order;
```

- `void` discards the promise. It silences the "floating promise" lint warning, but it handles nothing.
- `sendOrderConfirmation` throws on a non-2xx response, so the promise returned by `confirmOrder` rejects.
- Nothing is attached to that promise. Node's default (`--unhandled-rejections=throw`) turns it into an uncaught exception: the error and its stack go to stderr and the process exits with code 1.
- The container runtime restarts the process within a second or two. Meanwhile the proxy has no backend and answers 502, and every request the process was handling is cut off mid-flight.

With ~3 orders/s and a 0.6 % provider error rate, that's a crash every 40–60 s.

## Why customers saw duplicate orders

The crash isn't tied to the request that caused it. The order that triggered the email was already committed and answered. The requests that die are whatever happens to be in flight, including other customers' checkouts, some of them already committed in the database. Their browsers get a 502, they click again, and they get a second order. (Incident 010 comes back to this.)

## The evidence chain

| Observation | Where | What it means |
|---|---|---|
| 502 bursts every ~40–60 s, each a second or two long | *Requests per second by status* | Not slow requests: the API isn't there. |
| One restart per burst; memory flat between them | *API restarts*, *Memory* | The process exits; nothing builds up first (unlike incident 002). |
| `Error: MailWave responded 503 … at sendOrderConfirmation … at async confirmOrder`, then the process exits | `./lab logs api` | An error thrown in the background confirmation kills the process. |
| No `request failed` log line or 500 response for that error | Logs, edge metrics | Nobody caught it: no request handler, no error middleware. |
| A few 503s in MailWave's delivery log, at the same moments | MailWave log, `mailwave_requests_total` | The provider is healthy (99.4 %); its normal failure rate is the trigger. |
| `void confirmOrder(order)` in `placeOrder` | `orders.service.ts` | The unhandled promise. |
| v2.18.0 shipped the background confirmation yesterday afternoon | `CHANGELOG.md` | When it started. |

The *Calls to other services* panel barely shows the 503s: the API records each failed call and then dies before Prometheus can scrape it. When a process crashes, its own metrics are the least reliable witnesses; logs written to stderr and the other side's records are better.

### Red herrings

- **The OpenTelemetry bump** shipped the next morning. New instrumentation is a classic suspect for crashes, but the bursts started the day before.
- **"MailWave is down."** It answers 99.4 % of requests. A dependency failing occasionally is a fact of life; the bug is in how we handle it.
- **"502 means the proxy is broken."** Traefik reports 502 because there is no backend to talk to.

## Trigger vs. root cause

- **Root cause**: a fire-and-forget promise without error handling, in a runtime that treats unhandled rejections as fatal.
- **Trigger**: MailWave's normal error rate multiplied by order volume.
- **Why it wasn't caught**: tests mocked MailWave with a provider that never fails, and `void` made the lint rule look satisfied.

Next: [FIX.md](FIX.md) and an example [POSTMORTEM.md](POSTMORTEM.md).
