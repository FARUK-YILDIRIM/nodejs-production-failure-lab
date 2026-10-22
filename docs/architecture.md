# Architecture

## Layout

```
node-production-failure-lab/
├── lab                    # CLI entry point (bash → node cli/src/main.ts)
├── cli/src/               # the game: start, submit, verify, hints, scoring…
├── platform/              # shared by every incident
│   ├── compose.yaml       # Traefik, Prometheus, Grafana, Jaeger, Pyroscope
│   ├── traefik/           # edge routing
│   ├── prometheus/        # scrape config + SLO alert rules
│   ├── grafana/           # provisioned data sources and dashboards
│   └── jaeger/            # Jaeger v2 config (in-memory storage)
├── incidents/
│   └── 001-latency-spike/
│       ├── README.md      # the brief: scenario, symptoms, tools, success criteria
│       ├── incident.json  # metadata, hashed answers, SLOs
│       ├── compose.yaml   # the service, its dependencies, simulated traffic
│       ├── app/           # the broken service (a frozen snapshot)
│       ├── db/            # schema and deterministic seed
│       ├── load/load.ts   # k6 traffic model
│       └── checks.ts      # functional checks with golden response hashes
├── spoilers/
│   └── 001-latency-spike/
│       ├── hints/         # 1.md … 3.md, revealed one at a time
│       ├── solution/      # ROOT_CAUSE.md, FIX.md, POSTMORTEM.md
│       └── fix.patch      # the reference fix, applied by CI
├── templates/POSTMORTEM.md
└── .lab/                  # local state (git-ignored): progress, snapshots, results
```

## How an incident runs

`./lab start 001` runs `docker compose -f incidents/001-latency-spike/compose.yaml up`. That file `include`s `platform/compose.yaml`, so every incident gets the same proxy and observability stack around a different service. All incidents share the Compose project name `nplab`: starting another incident replaces the previous one.

The service's `src/` is bind-mounted into its container, so `./lab deploy` only has to recreate the container to run the student's working copy. Dependencies are baked into the image; `./lab deploy --build` rebuilds it.

On first start, the CLI snapshots the original `src/` into `.lab/snapshots/` (from git `HEAD` when the incident is committed). The snapshot is the reference for "before" measurements and for `./lab reset`.

Some fixes change the database (an index, a column). Those incidents set `"resetDatabase": true`: their seed ends by copying the database to `shop_pristine` (`db/04-template.sh`), and `verify` and `reset` recreate `shop` from that template in seconds before deploying. The service applies its own SQL migrations from `src/migrations` at startup, so a database fix is part of the code like any other.

## Telemetry

| Signal | Producer | Store | Notes |
|---|---|---|---|
| Edge metrics | Traefik | Prometheus | Request rate and latency histograms as customers see them |
| Service metrics | `prom-client` in the service | Prometheus | Default Node.js metrics + per-route latency, DB query time, pool state, event loop utilization |
| Traces | Traefik + OpenTelemetry (http, express, pg, pino) | Jaeger | 20 % sampled at the edge; the service follows the parent's decision |
| Profiles | `@pyroscope/nodejs` | Pyroscope | Wall-clock with CPU time, and heap; browse them in Grafana → Drilldown → Profiles |
| Logs | pino (JSON on stdout) | `docker compose logs` | Slow and failed requests, with `trace_id` |
| Database | postgres-exporter (`pg_stat_statements`, sessions, table scans), slow query log | Prometheus, PostgreSQL | Also on the dashboard via Grafana's PostgreSQL data source |

The service's instrumentation is loaded with `node --import ./src/telemetry/register.ts`. It registers `import-in-the-middle` as a synchronous module hook (Node ≥ 24.11) limited to the packages OpenTelemetry patches, then starts tracing and profiling before any application module loads.

## Measuring a fix

`./lab verify` runs, in order:

1. **Deploy** the working copy if it changed since the last deploy.
2. **Functional checks** (`checks.ts`): golden SHA-256 hashes of deterministic responses, plus behavioral checks for writes and validation. A fix must not change what the API returns.
3. **Baseline**, once per original snapshot: deploy the original code, warm up, run the load, collect metrics; then redeploy the working copy. The result is cached in `.lab/runs/`.
4. **Measurement**: the background traffic is paused, then k6 warms up for 15 s and runs the standard traffic mix for 60 s. Client-side percentiles come from k6's summary; server-side runtime numbers come from Prometheus for exactly that window.
5. **Verdict**: every SLO in `incident.json` must be met. An SLO reads either a client-side statistic from the k6 summary (`metric` + `stat`) or, with `"source": "prometheus"`, a PromQL query evaluated over exactly the measured window (`$range`), e.g. restarts or live-heap growth.

The load model uses k6's `constant-arrival-rate` executor. New requests keep arriving while the service stalls, as real users do. A closed model (a fixed number of connections waiting for responses) would stop sending during a stall and report a far rosier tail.

The service container is limited to 1 CPU and 512 MB so that results are comparable across machines and resource problems show up within minutes.

## Scoring

Progress lives in `.lab/state.json`. The clock counts only the time an incident is running (sessions between `start` and `stop`) until both flags are captured. Each hint adds 10 minutes and each wrong diagnosis 5 minutes. Answers in `incident.json` are SHA-256 hashes of `nplab:<incident>:<question>:<normalized answer>`: enough to avoid accidental spoilers, not meant to stop anyone determined to cheat.

## Why not…

- **…one app with incidents behind feature flags?** `grep INCIDENT` would find the answer, incidents would interfere with each other, and fixing one could break another. Frozen snapshots make each incident permanent.
- **…Grafana's Jaeger data source?** Jaeger v2 only serves its v3 query API, which Grafana's data source doesn't speak yet. The Jaeger UI is used directly.
- **…autocannon?** It's a closed-loop tool; see coordinated omission above.
