import fs from 'node:fs';
import path from 'node:path';
import { composeOrFail } from './compose.ts';
import { sleep } from './exec.ts';
import type { Incident, Slo } from './incidents.ts';
import { STATE_DIR, urls } from './paths.ts';

/** The same runtime signals are reported for every incident, so they don't point at any answer. */
export const RUNTIME_METRICS = [
  { id: 'cpu', label: 'CPU (cores)', query: 'rate(process_cpu_seconds_total{job="api"}[$range])', unit: 'cores' },
  { id: 'elu', label: 'Event loop utilization', query: 'avg_over_time(nodejs_eventloop_utilization{job="api"}[$range])', unit: 'percent' },
  { id: 'lag', label: 'Event loop delay (max)', query: 'max_over_time(nodejs_eventloop_lag_max_seconds{job="api"}[$range])', unit: 'seconds' },
  { id: 'heap', label: 'Heap used (max)', query: 'max_over_time(nodejs_heap_size_used_bytes{job="api"}[$range])', unit: 'bytes' },
  { id: 'pool', label: 'DB pool waiting (max)', query: 'max_over_time(db_pool_connections{job="api",state="waiting"}[$range])', unit: 'count' },
] as const;

export type RuntimeMetricId = (typeof RUNTIME_METRICS)[number]['id'];

export interface Measurement {
  label: string;
  sourceHash: string;
  measuredAt: string;
  durationSeconds: number;
  requests: number;
  /** SLO values, in the order of incident.verify.slos (ms or ratio). */
  slos: (number | null)[];
  runtime: Partial<Record<RuntimeMetricId, number>>;
}

interface K6Summary {
  metrics: Record<string, { values: Record<string, number> }>;
}

const runsDir = (incident: Incident) => path.join(STATE_DIR, 'runs', incident.slug);

/** Runs the incident's k6 script in a throwaway container on the lab network. */
async function k6(incident: Incident, mode: 'warmup' | 'verify', seconds: number): Promise<K6Summary | undefined> {
  const dir = runsDir(incident);
  fs.mkdirSync(dir, { recursive: true });
  // A fresh name per run: Docker Desktop's file sharing can briefly hide a file
  // that was deleted and recreated under the same name.
  const summaryName = `k6-summary-${Date.now()}.json`;

  await composeOrFail(
    incident,
    [
      'run', '--rm', '--no-deps', '-T',
      '-e', `MODE=${mode}`,
      '-e', `DURATION=${seconds}s`,
      '-e', `SUMMARY_PATH=/results/${summaryName}`,
      '-v', `${dir}:/results`,
      'k6', 'run', '--quiet', '--no-usage-report', '/load/load.ts',
    ],
    `k6 ${mode} run`,
  );

  if (mode === 'warmup') return undefined;
  const summaryFile = path.join(dir, summaryName);
  for (let attempt = 0; !fs.existsSync(summaryFile) && attempt < 20; attempt++) await sleep(250);
  return JSON.parse(fs.readFileSync(summaryFile, 'utf8')) as K6Summary;
}

async function promQuery(expr: string, at: Date): Promise<number | undefined> {
  const url = new URL('/api/v1/query', urls.prometheus);
  url.searchParams.set('query', expr);
  url.searchParams.set('time', String(at.getTime() / 1000));
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    const body = (await response.json()) as { data?: { result?: { value?: [number, string] }[] } };
    const raw = body.data?.result?.[0]?.value?.[1];
    const value = raw === undefined ? Number.NaN : Number(raw);
    return Number.isFinite(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function sloValue(summary: K6Summary, slo: Slo): number | null {
  const value = summary.metrics[slo.metric]?.values[slo.stat];
  return typeof value === 'number' ? value : null;
}

/**
 * Warm-up, then a fixed-length load run at the standard traffic mix (open model),
 * then server-side runtime metrics for exactly the measured window.
 */
export async function measure(incident: Incident, label: string, sourceHash: string): Promise<Measurement> {
  const { warmupSeconds, durationSeconds, slos } = incident.verify;
  await k6(incident, 'warmup', warmupSeconds);

  const startedAt = Date.now();
  const summary = await k6(incident, 'verify', durationSeconds);
  const endedAt = new Date();
  if (!summary) throw new Error('k6 produced no summary');

  // Let Prometheus scrape the last seconds of the run.
  await sleep(7_000);
  const range = `${Math.max(10, Math.round((endedAt.getTime() - startedAt) / 1000))}s`;
  const runtime: Measurement['runtime'] = {};
  for (const metric of RUNTIME_METRICS) {
    const value = await promQuery(metric.query.replace('$range', range), endedAt);
    if (value !== undefined) runtime[metric.id] = value;
  }

  return {
    label,
    sourceHash,
    measuredAt: endedAt.toISOString(),
    durationSeconds,
    requests: summary.metrics.http_reqs?.values.count ?? 0,
    slos: slos.map((slo) => sloValue(summary, slo)),
    runtime,
  };
}

const baselineFile = (incident: Incident) => path.join(runsDir(incident), 'baseline.json');

export function loadBaseline(incident: Incident, sourceHash: string): Measurement | undefined {
  try {
    const baseline = JSON.parse(fs.readFileSync(baselineFile(incident), 'utf8')) as Measurement;
    return baseline.sourceHash === sourceHash ? baseline : undefined;
  } catch {
    return undefined;
  }
}

export function saveBaseline(incident: Incident, measurement: Measurement): void {
  fs.mkdirSync(runsDir(incident), { recursive: true });
  fs.writeFileSync(baselineFile(incident), `${JSON.stringify(measurement, null, 2)}\n`);
}

export function saveRun(incident: Incident, measurement: Measurement): void {
  const stamp = measurement.measuredAt.replaceAll(':', '-').slice(0, 19);
  fs.writeFileSync(path.join(runsDir(incident), `verify-${stamp}.json`), `${JSON.stringify(measurement, null, 2)}\n`);
}
