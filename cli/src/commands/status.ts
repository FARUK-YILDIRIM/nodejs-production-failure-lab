import { runningServices } from '../lib/compose.ts';
import { listIncidents, type Incident } from '../lib/incidents.ts';
import { activeMs, loadState, penaltyBreakdown, penaltyMs, progressOf, type Progress } from '../lib/state.ts';
import { bold, dim, formatDuration, green, log, stars, table, yellow } from '../lib/ui.ts';

function statusLabel(progress: Progress | undefined): string {
  if (!progress || progress.sessions.length === 0) return dim('not started');
  const viewed = progress.solutionViewedAt ? dim(' · solution viewed') : '';
  if (progress.solvedAt) return green(`solved in ${formatDuration(activeMs(progress) + penaltyMs(progress))}`) + viewed;
  const flags = [progress.diagnosedAt && '🚩 diagnosed', progress.fixedAt && '🚩 fixed'].filter(Boolean).join(', ');
  return yellow(flags ? `in progress (${flags})` : 'in progress') + viewed;
}

export function list(): void {
  const { incidents } = loadState();
  log.title('Incidents');
  log.info(
    table(
      listIncidents().map((incident) => [
        incident.id,
        incident.title,
        stars(incident.difficulty),
        incident.estimatedTime,
        statusLabel(incidents[incident.id]),
      ]),
      ['ID', 'Title', 'Difficulty', 'Time', 'Status'],
    ),
  );
  log.info(`\n  ${dim('Start one with')} ${bold('./lab start <id>')}\n`);
}

export async function status(): Promise<void> {
  const state = loadState();
  if (!state.current) {
    log.info('No incident is running.');
    list();
    return;
  }

  const incident = listIncidents().find((candidate) => candidate.id === state.current) as Incident;
  const progress = progressOf(state, incident);
  const services = await runningServices(incident);

  log.title(`Incident ${incident.id} · ${incident.title}`);
  log.info(
    table([
      ['Clock', formatDuration(activeMs(progress))],
      ['Penalties', `${formatDuration(penaltyMs(progress))} ${dim(`(${penaltyBreakdown(progress)})`)}`],
      ['🚩 Diagnosis', progress.diagnosedAt ? green('captured') : dim(`./lab submit ${incident.id}`)],
      ['🚩 Fix', progress.fixedAt ? green('captured') : dim(`./lab verify ${incident.id}`)],
      ['Services', services.join(', ') || yellow('none running')],
    ]),
  );
  log.info();
}
