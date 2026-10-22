import { compose, ensureDocker } from '../lib/compose.ts';
import { ensureRunning, incidentFromArgs } from '../lib/current.ts';
import { interactive } from '../lib/ui.ts';

export async function logs(args: string[]): Promise<void> {
  const incident = incidentFromArgs([]);
  await ensureDocker();
  await ensureRunning(incident);
  await compose(incident, ['logs', '--follow', '--tail', '100', args[0] ?? incident.appServices[0] ?? 'api'], { inherit: true });
}

export async function shell(args: string[]): Promise<void> {
  const incident = incidentFromArgs([]);
  await ensureDocker();
  await ensureRunning(incident);
  await compose(incident, ['exec', ...(interactive() ? [] : ['-T']), args[0] ?? incident.appServices[0] ?? 'api', 'sh'], {
    inherit: true,
  });
}

export async function psql(): Promise<void> {
  const incident = incidentFromArgs([]);
  await ensureDocker();
  await ensureRunning(incident);
  await compose(incident, ['exec', ...(interactive() ? [] : ['-T']), 'postgres', 'psql', '-U', 'shop', '-d', 'shop'], {
    inherit: true,
  });
}
