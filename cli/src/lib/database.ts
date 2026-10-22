import { compose, composeOrFail } from './compose.ts';
import type { Incident } from './incidents.ts';

/**
 * Replaces the incident's database with the pristine copy made right after the
 * seed (db/04-template.sh). Takes a few seconds; the app services are stopped
 * first so nothing reconnects halfway through.
 */
export async function restoreDatabase(incident: Incident): Promise<void> {
  await compose(incident, ['stop', ...incident.appServices]);
  const psql = (database: string, statements: string[]) =>
    composeOrFail(
      incident,
      ['exec', '-T', 'postgres', 'psql', '-U', 'shop', '-d', database, '-v', 'ON_ERROR_STOP=1', ...statements.flatMap((sql) => ['-c', sql])],
      'Restoring the database',
    );
  await psql('postgres', ['DROP DATABASE IF EXISTS shop WITH (FORCE)', 'CREATE DATABASE shop TEMPLATE shop_pristine']);
  // Query statistics start over too, so pg_stat_statements only shows the new run.
  await psql('shop', ['SELECT pg_stat_statements_reset()']);
}
