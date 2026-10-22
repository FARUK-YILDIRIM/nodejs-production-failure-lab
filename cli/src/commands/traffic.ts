import { composeOrFail, ensureDocker } from '../lib/compose.ts';
import { ensureRunning, incidentFromArgs } from '../lib/current.ts';
import { LabError } from '../lib/errors.ts';
import { log } from '../lib/ui.ts';

export async function traffic(args: string[]): Promise<void> {
  const [mode, ...rest] = args;
  if (mode !== 'on' && mode !== 'off') throw new LabError('Usage: ./lab traffic on|off');

  const incident = incidentFromArgs(rest);
  await ensureDocker();
  await ensureRunning(incident);

  if (mode === 'on') {
    await composeOrFail(incident, ['up', '-d', 'traffic'], 'Starting traffic');
    log.ok('Production traffic is flowing.');
  } else {
    await composeOrFail(incident, ['stop', 'traffic'], 'Stopping traffic');
    log.ok('Production traffic stopped. Handy for profiling a single request; remember to turn it back on.');
  }
}
