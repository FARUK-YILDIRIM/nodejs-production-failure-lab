# Authoring an incident

A good incident is a **realistic failure** that is **observable** with the lab's tools, **hidden** behind symptoms, and **provably fixed** by a measurable change.

## 1. Design it on paper first

Answer these before writing code:

- **The failure**: what goes wrong, and why would a reasonable engineer have written that code? (A bulk export that loops over the catalog is realistic; a `for` loop to five billion is not.)
- **Victim vs. culprit**: which requests suffer, and which one causes it? The best incidents make innocent endpoints look guilty.
- **The evidence chain**: which observations, in which tools, lead from the alert to the root cause? Write them down as a table; it becomes `ROOT_CAUSE.md`.
- **Red herrings**: what looks guilty but isn't? Let them emerge naturally (a recent unrelated deploy, a busy panel) rather than planting fake bugs.
- **Trigger**: why does it start *now*? A usage pattern, a data volume, a deploy, a dependency.
- **The fix, measured**: what changes the numbers, and by how much?

## 2. Create the incident

```
incidents/00N-<symptom>/       # name it after the symptom, never the cause
├── README.md                  # the brief
├── incident.json
├── compose.yaml
├── app/                       # start from the latest incident's app with its fix applied
├── db/
├── load/load.ts
├── services/                  # optional: third-party stand-ins (an email provider, a tax API)
│                              # and infrastructure (a slow DNS resolver, network latency)
└── checks.ts
spoilers/00N-<symptom>/
├── hints/1.md 2.md 3.md
├── solution/ROOT_CAUSE.md FIX.md POSTMORTEM.md
└── fix.patch
```

Copy the most recent incident, apply its `fix.patch` so the service starts healthy, then introduce the new failure. Bump the version in `app/package.json` and write a believable `app/CHANGELOG.md`: it's part of the investigation.

Keep the failure out of names and comments: no `INCIDENT_` flags, no `// slow on purpose`.

## 3. The brief (`README.md`)

Write it like a page from on-call: an alert, a message from Support, what you know, recent deploys. Give symptoms and context, not conclusions. Don't write "CPU is at 96 %": let the student find it. End with the tools table, the success criteria and the rules.

## 4. `incident.json`

- `submit.questions`: a few structured questions (an endpoint, a choice among plausible resources, a choice among plausible root causes). Store hashes, never answers:

  ```bash
  ./lab dev answer-hash 004 endpoint "/api/orders"
  ```

  Add every accepted spelling's hash to `answers`.
- `verify.slos`: SLOs with a `max` and a `unit` (`ms`, `ratio`, `count`, `bytes/s`). User-facing ones read the k6 summary (`metric` + `stat`); server-side ones use `"source": "prometheus"` and a `query` where `$range` is the measured window:

  ```json
  { "label": "Restarts", "source": "prometheus", "query": "changes(process_start_time_seconds{job=\"api\"}[$range])", "max": 0, "unit": "count" }
  ```

  Facts only the database knows (duplicate rows, lost updates) use `"source": "sql"` and a query returning one number, where `$start` and `$end` are the measured window as `timestamptz`:

  ```json
  { "label": "Duplicate orders", "source": "sql", "query": "SELECT count(*) FROM orders WHERE created_at >= $start AND …", "max": 0, "unit": "count" }
  ```

  `max` is inclusive: `"max": 0` with `"unit": "count"` reads as "= 0". An SLO can set `min` instead, for things a fix must produce rather than avoid, such as messages parked in a dead-letter topic.

  Choose targets the broken code clearly misses and the reference fix clearly meets, with margin on both sides: measure each a few times. Lengthen `warmupSeconds`/`durationSeconds` when a signal needs time to settle (caches filling up, memory trends).

If the fix changes the database, set `"resetDatabase": true`, end the seed with `db/04-template.sh` (copy it from incident 005) and ship the fix as a migration in `app/src/migrations`.

If a stand-in service keeps state that would leak from one run into the next (a queue, a cache), list it in `"resetServices"`: `verify` and `reset` restart it before each run.

To run the API as several instances behind the edge proxy, declare them as separate Compose services (`api-1`, `api-2`; only the first one builds the image, the others use it with `pull_policy: never`) and list them in `"services"`. Deploys then replace them one at a time. Set `verify.rollingRestartAt` to restart them during the measurement.

Other services built from `app/` (a `worker` running `src/worker.ts`, say) go in `"services"` too: they are deployed with the student's code, but only services named `api` or `api-<n>` sit behind the edge proxy. A message broker keeps its state between runs: list it, and its exporter, in `"resetServices"`.

## 5. Functional checks (`checks.ts`)

Every deterministic endpoint gets a golden SHA-256 of its response body, taken from the broken service (it is functionally correct, just slow or fragile):

```bash
./lab dev body-hash "/api/products/4242"
```

Writes and validation get behavioral checks. The seed must be deterministic (`setseed`, fixed dates), so hashes match on every machine.

## 6. Traffic (`load/load.ts`)

Use `constant-arrival-rate` scenarios, one per customer journey, tagged with `journey` (SLOs refer to `http_req_duration{journey:…}`). The trigger should be part of normal traffic, not a special "attack" scenario.

## 7. Calibrate

```bash
./lab start 00N
./lab verify 00N              # the original: must clearly violate the SLOs
git apply spoilers/00N-*/fix.patch
./lab verify 00N              # the fix: must clearly meet them
./lab reset 00N --yes
```

Check the dashboards while it runs: are the symptoms visible? Is the evidence chain in `ROOT_CAUSE.md` really observable? Profile it yourself.

## 8. Hints and solution

- Three hints, from "where to look" to "what to look at". The third should make the incident solvable without giving the answer away.
- `ROOT_CAUSE.md`: one-sentence summary, the mechanism, the evidence chain, trigger vs. root cause.
- `FIX.md`: mitigation, the fix with measured before/after numbers, alternatives and their trade-offs, prevention (including an alert rule).
- `POSTMORTEM.md`: an example postmortem in the template's format.
- `fix.patch`: `git diff` of the fix against the incident's `app/src`.
