import { runningServices } from './compose.ts';
import { LabError } from './errors.ts';
import { findIncident, type Incident } from './incidents.ts';
import { loadState } from './state.ts';

/** The incident named on the command line, or the one currently running. */
export function incidentFromArgs(args: string[]): Incident {
  if (args[0]) return findIncident(args[0]);
  const { current } = loadState();
  if (!current) throw new LabError('No incident is running. Start one with `./lab start <id>` (see `./lab list`).');
  return findIncident(current);
}

export async function ensureRunning(incident: Incident): Promise<void> {
  const { current } = loadState();
  const services = await runningServices(incident);
  if (current !== incident.id || !incident.appServices.every((service) => services.includes(service))) {
    throw new LabError(`Incident ${incident.id} is not running. Start it with \`./lab start ${incident.id}\`.`);
  }
}
