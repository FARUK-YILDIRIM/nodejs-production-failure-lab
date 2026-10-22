import { compose, ensureDocker } from '../lib/compose.ts';
import { findIncident } from '../lib/incidents.ts';
import { closeSession, loadState, progressOf, saveState } from '../lib/state.ts';
import { log } from '../lib/ui.ts';

export async function stop(flags: { volumes: boolean }): Promise<void> {
  await ensureDocker();
  const state = loadState();
  if (!state.current) {
    log.info('No incident is running.');
    return;
  }

  const incident = findIncident(state.current);
  log.step(`Stopping incident ${incident.id}…`);
  await compose(incident, ['down', '--remove-orphans', ...(flags.volumes ? ['--volumes'] : [])]);

  closeSession(progressOf(state, incident));
  delete state.current;
  saveState(state);
  log.ok(`Stopped. Your clock is paused; \`./lab start ${incident.id}\` picks up where you left off.`);
  if (flags.volumes) log.info('Database and metrics volumes were removed; the next start reseeds them.');
}
