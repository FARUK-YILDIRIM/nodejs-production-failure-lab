import { runChecks } from '../lib/checks.ts';
import { compose, composeOrFail, ensureDocker, runningServices } from '../lib/compose.ts';
import { ensureRunning, incidentFromArgs } from '../lib/current.ts';
import { deploy } from '../lib/deploy.ts';
import { resetEnvironment } from '../lib/environment.ts';
import type { Incident, Slo } from '../lib/incidents.ts';
import { loadBaseline, measure, RUNTIME_METRICS, saveBaseline, saveRun, type Measurement } from '../lib/measure.ts';
import { ensureSnapshot, hashTree } from '../lib/source.ts';
import {
  activeMs,
  loadState,
  markSolvedIfComplete,
  penaltyBreakdown,
  penaltyMs,
  progressOf,
  saveState,
  type Progress,
} from '../lib/state.ts';
import { bold, dim, formatDuration, green, log, red, table } from '../lib/ui.ts';

const formatMs = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`);

function formatSlo(slo: Slo, value: number | null | undefined): string {
  if (value === null || value === undefined) return dim('n/a');
  switch (slo.unit) {
    case 'ms':
      return formatMs(value);
    case 'ratio':
      return `${(value * 100).toFixed(2)} %`;
    case 'count':
      return Number.isInteger(value) ? String(value) : value.toFixed(2);
    case 'bytes/s':
      return Math.abs(value) >= 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(1)} MB/s` : `${Math.round(value / 1024)} KB/s`;
  }
}

const formatTarget = (slo: Slo) => (slo.unit === 'count' && slo.max === 0 ? '= 0' : `< ${formatSlo(slo, slo.max)}`);

function formatRuntime(unit: (typeof RUNTIME_METRICS)[number]['unit'], value: number | undefined): string {
  if (value === undefined) return dim('n/a');
  switch (unit) {
    case 'cores':
      return value.toFixed(2);
    case 'percent':
      return `${Math.round(value * 100)} %`;
    case 'seconds':
      return formatMs(value * 1000);
    case 'bytes':
      return `${Math.round(value / 1024 / 1024)} MB`;
    case 'count':
      return String(Math.round(value));
  }
}

function printResults(incident: Incident, after: Measurement, before: Measurement | undefined): boolean[] {
  const verdicts = incident.verify.slos.map((slo, index) => {
    const value = after.slos[index];
    return value !== null && value !== undefined && value <= slo.max;
  });

  const sloRows = incident.verify.slos.map((slo, index) => [
    slo.label,
    ...(before ? [formatSlo(slo, before.slos[index])] : []),
    bold(formatSlo(slo, after.slos[index])),
    formatTarget(slo),
    verdicts[index] ? green('✔') : red('✘'),
  ]);
  const runtimeRows = RUNTIME_METRICS.map((metric) => [
    dim(metric.label),
    ...(before ? [dim(formatRuntime(metric.unit, before.runtime[metric.id]))] : []),
    dim(formatRuntime(metric.unit, after.runtime[metric.id])),
    '',
    '',
  ]);

  const header = before ? ['', 'Before', 'After', 'Target', ''] : ['', 'Measured', 'Target', ''];
  log.info();
  log.info(table([...sloRows, [dim('runtime (for your postmortem)'), '', '', '', ''], ...runtimeRows], header));
  log.info(dim(`\n  ${after.requests} requests in ${after.durationSeconds}s. Raw results: .lab/runs/${incident.slug}/`));
  return verdicts;
}

export function printSolved(incident: Incident, progress: Progress): void {
  const clock = activeMs(progress);
  const penalties = penaltyMs(progress);
  log.title(`🏁 Incident ${incident.id} solved!`);
  log.info(
    table([
      ['Clock', formatDuration(clock)],
      ['Penalties', `+${formatDuration(penalties)} ${dim(`(${penaltyBreakdown(progress)})`)}`],
      ['Your time to resolve', bold(formatDuration(clock + penalties))],
    ]),
  );
  log.info(`\n  Next: write the postmortem with ${bold(`./lab report ${incident.id}`)}, then compare with ${bold(`./lab solution ${incident.id}`)}.\n`);
}

export async function verify(args: string[], flags: { ci: boolean; expectFail: boolean; baseline: boolean }): Promise<void> {
  const incident = incidentFromArgs(args);
  await ensureDocker();
  await ensureRunning(incident);

  const state = loadState();
  const progress = progressOf(state, incident);
  const snapshot = await ensureSnapshot(incident);
  const originalHash = hashTree(snapshot);
  const currentHash = hashTree(incident.appSrcDir);
  const unchanged = currentHash === originalHash;

  log.title(`Verifying incident ${incident.id} · ${incident.title}`);

  const { warmupSeconds, durationSeconds } = incident.verify;
  const trafficWasOn = (await runningServices(incident)).includes('traffic');
  await composeOrFail(incident, ['stop', 'traffic'], 'Pausing production traffic');
  let before: Measurement | undefined;
  let after: Measurement;
  try {
    // Every run starts from a fresh deploy of what is on disk: nothing left over from
    // earlier runs (a heap near its limit, an exhausted pool, a hand-made index…).
    log.step('Deploying your working copy…');
    await resetEnvironment(incident);
    await deploy(incident, { note: 'Deployed working copy (verify)' });
    progress.deployedHash = currentHash;
    saveState(state);

    log.step('Functional checks: the API must behave exactly as before');
    const checks = await runChecks(incident);
    for (const check of checks) {
      if (check.error) log.fail(`${check.name} ${dim(`— ${check.error}`)}`);
      else log.ok(dim(check.name));
    }
    if (checks.some((check) => check.error)) {
      log.fail(
        bold(
          checks.some((check) => check.error && check.unavailable)
            ? 'Functional checks failed: the API kept going down while they ran.'
            : 'Functional checks failed: a fix must not change what the API returns.',
        ),
      );
      process.exitCode = 1;
      return;
    }

    if (flags.baseline && !unchanged) {
      before = loadBaseline(incident, originalHash);
      if (!before) {
        log.step(`Measuring the original code first (only once, ~${warmupSeconds + durationSeconds + 30}s)…`);
        await resetEnvironment(incident);
        await deploy(incident, { sourceDir: snapshot, note: 'Deployed original code (baseline)' });
        try {
          before = await measure(incident, 'original', originalHash);
          saveBaseline(incident, before);
        } finally {
          await resetEnvironment(incident);
          await deploy(incident, { note: 'Deployed working copy (verify)' });
        }
      }
    }

    log.step(`Load test: ${warmupSeconds}s warm-up, then ${durationSeconds}s of the standard traffic mix…`);
    after = await measure(incident, unchanged ? 'original' : 'yours', currentHash);
    if (unchanged) saveBaseline(incident, after);
    saveRun(incident, after);
  } finally {
    if (trafficWasOn) await compose(incident, ['up', '-d', 'traffic']);
  }

  const verdicts = printResults(incident, after, before);
  const passed = verdicts.every(Boolean);
  log.info();

  if (flags.expectFail) {
    if (passed) {
      log.fail('Expected the original code to violate the SLOs, but it met them: the incident no longer reproduces.');
      process.exitCode = 1;
    } else {
      log.ok('The incident reproduces: the original code violates its SLOs.');
    }
    return;
  }

  if (!passed) {
    log.fail(bold('Not fixed yet: some SLOs are still violated.'));
    if (unchanged) log.info(dim('  This is the original code, so these numbers are the baseline to beat.'));
    process.exitCode = 1;
    return;
  }

  log.ok(bold('🚩 Fix verified: every SLO is met and the API behaves exactly as before.'));
  if (flags.ci || progress.fixedAt) return;

  progress.fixedAt = new Date().toISOString();
  const solved = markSolvedIfComplete(progress);
  saveState(state);
  if (solved) printSolved(incident, progress);
  else log.info(dim(`One flag to go: \`./lab submit ${incident.id}\` with your diagnosis.`));
}
