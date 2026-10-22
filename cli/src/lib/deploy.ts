import { composeOrFail } from './compose.ts';
import { annotate } from './grafana.ts';
import type { Incident } from './incidents.ts';

/**
 * Recreates the app container so it runs the given source tree (default: your
 * working copy in app/src). Traffic keeps flowing; the proxy returns 502s for
 * the few seconds the service is down, as a real single-instance deploy would.
 */
export async function deploy(
  incident: Incident,
  { sourceDir, build = false, note }: { sourceDir?: string; build?: boolean; note: string },
): Promise<void> {
  await composeOrFail(
    incident,
    ['up', '-d', '--no-deps', '--force-recreate', '--wait', '--wait-timeout', '120', ...(build ? ['--build'] : []), ...incident.appServices],
    'Deploy',
    { env: sourceDir ? { LAB_APP_SRC: sourceDir } : {} },
  );
  await annotate(note, ['deploy']);
}
