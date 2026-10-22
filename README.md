# Node Production Failure Lab

**Realistic Node.js production incidents you run on your laptop, investigate with real observability tools, and fix under measurement.** A CTF for backend engineers and SREs: instead of capturing a flag hidden in a binary, you capture a correct diagnosis and a fix that holds up under load.

```
./lab start 001        🔥 an alert fires, customers complain
   investigate          Grafana · Prometheus · Jaeger · Pyroscope · logs · psql · Node inspector
./lab submit 001       🚩 flag 1: the right diagnosis, proven with evidence
   fix + ./lab deploy
./lab verify 001       🚩 flag 2: functional checks + load test + SLOs, before vs. after
./lab report 001       📝 a blameless postmortem
```

What `./lab verify` printed for incident 001, original code vs. a correct fix:

```
                    Before   After    Target
  Catalog p95       1.84 s   12 ms    < 250 ms   ✔
  Checkout p95      1.83 s   16 ms    < 400 ms   ✔
  Account p95       1.70 s   12 ms    < 300 ms   ✔
  Reports p95       2.56 s   294 ms   < 3.00 s   ✔
  Error rate        0.00 %   0.00 %   < 1.00 %   ✔
```

## Why

Most of what makes a senior backend engineer valuable in an incident isn't in tutorials: telling a symptom from a cause, distrusting the most obvious graph, knowing what a blocked event loop or a leaked connection *looks like* in telemetry, and proving a fix with numbers instead of a hunch. This lab is a place to practice exactly that, repeatedly and safely.

Every incident follows the same loop: **observe → hypothesize → investigate → prove → fix → measure → prevent.**

## Quick start

You need **Docker** (Docker Desktop with ≥ 4 GB of memory is fine), **Node.js 22.18+** (24 recommended) and **git**.

```bash
git clone <this repository> node-production-failure-lab
cd node-production-failure-lab
./lab start 001
```

The first start builds the service and seeds a database with ~500k rows, which takes a minute or two. Then open Grafana at http://localhost:3000 and read the brief in [`incidents/001-latency-spike/README.md`](incidents/001-latency-spike/README.md).

Optional, for editor IntelliSense in the service code: `npm install` in the incident's `app/` folder.

## Incidents

| # | Incident | Difficulty | Status |
|---|---|---|---|
| 001 | [Latency spike](incidents/001-latency-spike/README.md) | ★☆☆ | ✅ playable |
| 002 | [Random restarts](incidents/002-random-restarts/README.md) | ★☆☆ | ✅ playable |
| 003 | [Error bursts](incidents/003-error-bursts/README.md) | ★☆☆ | ✅ playable |
| 004 | [Slow checkout](incidents/004-slow-checkout/README.md) | ★★☆ | ✅ playable |
| 005 | [Database overload](incidents/005-database-overload/README.md) | ★☆☆ | ✅ playable |
| 006 | [Slow order history](incidents/006-slow-order-history/README.md) | ★☆☆ | ✅ playable |
| 007 | Hanging requests | ★★☆ | 🛠 next |

Incidents are named after their **symptoms**, never their causes, and difficulty doesn't tell you the category: real incidents don't arrive labeled "database problem". The longer roadmap covers the Node.js runtime, PostgreSQL, distributed systems (timeouts, retries, circuit breakers), messaging and Kafka, and platform limits.

## Rules of the game

- **Two flags per incident.** `submit` checks your diagnosis (answers are stored hashed, so browsing the repo doesn't spoil them). `verify` checks your fix: the API must return exactly what it returned before, byte for byte, and meet every SLO under the standard load.
- **Your score is your time to resolve** (MTTR). The clock only runs while the incident is running; `./lab stop` pauses it.
- **Hints cost 10 minutes** each, **wrong diagnoses 5 minutes**.
- **Telemetry first, code last.** The service is small enough to read in an afternoon; the point is to find the problem the way you would in a codebase too big to read.
- **Don't open `spoilers/`** until you're done. VS Code hides it by default (`.vscode/settings.json`).

## Commands

| Command | What it does |
|---|---|
| `./lab list` | Incidents and your progress |
| `./lab start <id>` | Start an incident (stops any other). `--no-traffic` to start without simulated customers |
| `./lab status` | What's running, your clock and your flags |
| `./lab hint [id]` | Reveal the next hint (+10 min) |
| `./lab submit [id]` | 🚩 Submit your diagnosis |
| `./lab deploy` | Restart the service with your working copy of `app/src` (`--build` after dependency changes) |
| `./lab verify [id]` | 🚩 Functional checks, then a load test with before/after numbers |
| `./lab report [id]` | Create your postmortem from the [template](templates/POSTMORTEM.md) |
| `./lab solution [id]` | Read the official root cause, fix and an example postmortem |
| `./lab traffic on\|off` | Pause or resume the simulated customers |
| `./lab logs [service]` | Follow a service's logs |
| `./lab psql` | SQL shell on the incident's database |
| `./lab shell [service]` | A shell inside a service's container, e.g. to run `getent hosts <name>` |
| `./lab reset [id]` | Restore the original code and start the incident over (your version is backed up) |
| `./lab stop` | Stop everything and pause your clock (`--volumes` also drops the data) |

## What's running

```
  k6 · simulated customers (open model, ~38 req/s)
          │
          ▼
  Traefik · edge proxy ─────────────────────── latency as customers see it
          │
          ▼
  shopflow-api · Node.js 24, TypeScript, Express 5 ───► PostgreSQL 17 ◄── postgres-exporter
     │ prom-client      │ OpenTelemetry     │ Pyroscope SDK       (pg_stat_statements)
     ▼                  ▼                   ▼
  Prometheus          Jaeger             Pyroscope
     └──────────────── Grafana ─────────────┘
```

| Tool | URL |
|---|---|
| API (through the proxy) | http://localhost:8080 |
| Grafana (dashboards, profiles) | http://localhost:3000 |
| Prometheus | http://localhost:9090 |
| Jaeger | http://localhost:16686 |
| Node.js inspector | `chrome://inspect` → `127.0.0.1:9229` |

Ports are bound to `127.0.0.1` and can be changed with `LAB_PORT_API`, `LAB_PORT_GRAFANA`, `LAB_PORT_PROMETHEUS`, `LAB_PORT_JAEGER`, `LAB_PORT_PYROSCOPE` and `LAB_PORT_INSPECTOR`.

## Design decisions

- **Each incident is a frozen, self-contained service** (`incidents/<id>/app`), including its telemetry code, since some incidents live *inside* the instrumentation. The edge proxy and the observability stack are shared ([`platform/`](platform)).
- **Load is an open model.** Customers keep arriving at a constant rate even when the API stalls. A closed-loop load generator slows down with the server and under-reports exactly the tail latency an incident is about (coordinated omission).
- **Latency is measured at two places.** The proxy sees what customers experience; the service only sees the time after it picked a request up. The gap between the two is often the first clue.
- **Before/after on your own machine.** `verify` measures the original code once and your version every time, with the same traffic, CPU and memory limits.
- **TypeScript without a build step.** Node runs the `.ts` sources directly, so stack traces, CPU profiles and flame graphs point at real source lines.
- **CI proves every incident still reproduces** and that its reference fix still passes, so incidents don't silently rot when dependencies change.

More in [docs/architecture.md](docs/architecture.md).

## Contributing

New incidents are very welcome. [docs/authoring-incidents.md](docs/authoring-incidents.md) walks through designing one: a realistic failure, a brief that doesn't give it away, hints, functional checks, SLOs and a reference fix. See also [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
