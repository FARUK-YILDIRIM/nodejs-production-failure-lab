import fs from 'node:fs';
import path from 'node:path';
import { incidentFromArgs } from '../lib/current.ts';
import { LabError } from '../lib/errors.ts';
import { relative } from '../lib/paths.ts';
import { loadState, progressOf, saveState } from '../lib/state.ts';
import { bold, confirm, dim, log } from '../lib/ui.ts';

export async function solution(args: string[], flags: { yes: boolean }): Promise<void> {
  const incident = incidentFromArgs(args);
  const dir = path.join(incident.spoilersDir, 'solution');
  if (!fs.existsSync(dir)) throw new LabError(`Incident ${incident.id} has no published solution yet.`);

  const state = loadState();
  const progress = progressOf(state, incident);
  if (!progress.solvedAt) {
    const proceed = await confirm(
      `You haven't solved incident ${incident.id} yet. Reading the solution ends the challenge for this run. Continue?`,
      { assumeYes: flags.yes },
    );
    if (!proceed) return;
    progress.solutionViewedAt ??= new Date().toISOString();
    saveState(state);
  }

  log.info(fs.readFileSync(path.join(dir, 'ROOT_CAUSE.md'), 'utf8').trim());
  log.info();
  log.info(bold('More in the solution folder:'));
  for (const file of fs.readdirSync(dir).filter((name) => name !== 'ROOT_CAUSE.md').sort()) {
    log.info(`  ${relative(path.join(dir, file))}`);
  }
  const patch = path.join(incident.spoilersDir, 'fix.patch');
  if (fs.existsSync(patch)) log.info(`  ${relative(patch)} ${dim('(apply with `git apply`)')}`);
  log.info();
}
