import { composeOrFail, waitHealthy } from './compose.ts';
import { annotate } from './grafana.ts';
import type { Incident } from './incidents.ts';

/**
 * Recreates the app containers so they run the given source tree (default: your
 * working copy in app/src). Traffic keeps flowing; with a single instance, the
 * proxy returns 502s for the few seconds the service is down, as a real
 * single-instance deploy would. Several instances are replaced one at a time
 * (a rolling deploy): each one has to be healthy before the next one goes.
 */
export async function deploy(
  incident: Incident,
  { sourceDir, build = false, note }: { sourceDir?: string; build?: boolean; note: string },
): Promise<void> {
  for (const service of incident.appServices) {
    await composeOrFail(
      incident,
      ['up', '-d', '--no-deps', '--force-recreate', '--wait', '--wait-timeout', '120', ...(build ? ['--build'] : []), service],
      'Deploy',
      { env: sourceDir ? { LAB_APP_SRC: sourceDir } : {} },
    );
  }
  await annotate(note, ['deploy']);
}

/**
 * Restarts the app's instances one at a time, as a deploy of the same code would:
 * each gets SIGTERM, then starts again, and has to be healthy before the next one.
 */
export async function rollingRestart(incident: Incident): Promise<void> {
  await annotate('Rolling restart (verify)', ['deploy']);
  for (const service of incident.appServices) {
    await composeOrFail(incident, ['restart', service], `Restarting ${service}`);
    await waitHealthy(incident, service);
  }
}
