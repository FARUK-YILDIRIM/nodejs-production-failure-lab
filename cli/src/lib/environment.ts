import { composeOrFail } from './compose.ts';
import { restoreDatabase } from './database.ts';
import type { Incident } from './incidents.ts';

/**
 * Puts back what a run must not inherit from the previous one: the database, for
 * incidents whose fix ships a migration, and the stand-ins for other teams'
 * services that keep state between requests (a queue still full of work, say).
 */
export async function resetEnvironment(incident: Incident): Promise<void> {
  if (incident.resetDatabase) await restoreDatabase(incident);
  if (incident.resetServices?.length) {
    await composeOrFail(incident, ['restart', ...incident.resetServices], `Restarting ${incident.resetServices.join(', ')}`);
  }
}
