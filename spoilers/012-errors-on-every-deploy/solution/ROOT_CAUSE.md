# Incident 012 · Root cause

> ⚠️ Spoilers. Read this after `./lab verify 012` passes, or once you've decided to stop.

## In one sentence

When an instance receives SIGTERM, it stops accepting connections at once, while its `/ready` passed a moment ago and the proxy only checks again within 2 s. Until that check fails, the proxy keeps sending the instance its share of new requests, and each one is refused: a 502. A rolling deploy does this once per instance.

## What happens

```ts
// server.ts, since the first version
function shutdown(signal) {
  setTimeout(() => process.exit(1), 8_000).unref();
  server.close(() => { metricsServer.close(); pool.end().finally(() => process.exit(0)); });
}
```

For `api-1` during a deploy:

```
 0.0 s   Docker sends SIGTERM to api-1.
 0.0 s   server.close(): the listening socket closes, new connections are refused.
 0.0 s   … but the proxy's last check of /ready passed: it keeps sending api-1 half of the requests.
         Each one needs a connection to api-1 that it can't get: 502.
≤2.0 s   The proxy's next check fails: api-1 is out of rotation. The 502s stop.
 8.0 s   server.close() still hasn't finished: the keep-alive connections the proxy had
         open stay open (95 s keep-alive timeout). The safety timer kills the process.
~10 s    The new api-1 is listening; its /ready passes: back in rotation.
```

Then the same for `api-2`. About a hundred requests fail per deploy, on every endpoint: the bursts aren't about what the requests do, only about where the proxy sends them.

The shutdown handler looks graceful, and it does let requests in flight finish. What it misses is the time the proxy needs to stop sending new ones: a load balancer learns about an instance leaving from its health checks, so the instance has to announce it and keep serving until the load balancer has acted on it. Kubernetes has exactly the same race between a pod's termination and its removal from the Service's endpoints.

## The evidence chain

| Observation | Where | What it means |
|---|---|---|
| 502s in two short bursts per deploy, on every endpoint, never between deploys | *Requests per second by status*, deploy annotations | The deploy itself causes them, not a code path. |
| Each burst starts when an instance logs `shutting down`, and lasts up to 2 s | `./lab logs`, the edge graph | The window between SIGTERM and the proxy's next readiness check. |
| The proxy's failing spans target the instance being stopped (`server.address`: `api-1`) | Jaeger (`traefik`, `ReverseProxy` spans) | The proxy still sends requests to an instance that stopped accepting them. |
| The next log line from that instance is its restart, 8 to 10 s later | `./lab logs` | `server.close()` never completes: the safety timer kills the process. |
| `/ready` answers 200 until the listener closes | The code | Nothing tells the proxy in advance that the instance is leaving. |

### Red herrings

- **"The new instance gets traffic before it's ready."** The proxy only sends it requests once `/ready` passes, and the bursts start before it even exists.
- **"Requests in flight are cut."** They finish: that part of the shutdown works.
- **"Two instances aren't enough."** With ten instances, each deploy would cause ten smaller bursts.
- **"Make the proxy retry."** Retrying a refused `GET` would help; retrying a `POST` whose fate is unknown would not, and the proxy can't tell which is which.

## Trigger vs. root cause

- **Root cause**: a shutdown that stops accepting connections before the load balancer has stopped sending them, with no way for the load balancer to know in advance.
- **Trigger**: none beyond routine deploys. The bug was always there; with a single instance, every deploy was an outage anyway, so nobody noticed the difference.
- **Why it wasn't caught**: "graceful shutdown" was tested by checking that requests in flight complete, never under load with a load balancer in front.

Next: [FIX.md](FIX.md) and an example [POSTMORTEM.md](POSTMORTEM.md).
