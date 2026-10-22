import { ensureDocker, runningServices } from '../lib/compose.ts';
import { incidentFromArgs } from '../lib/current.ts';
import { deploy } from '../lib/deploy.ts';
import { relative } from '../lib/paths.ts';
import { backupSource, diffTrees, ensureSnapshot, hashTree, replaceTree } from '../lib/source.ts';
import { loadState, saveState } from '../lib/state.ts';
import { bold, confirm, log } from '../lib/ui.ts';

/** Start the incident over: original code back in place, progress cleared. */
export async function reset(args: string[], flags: { yes: boolean }): Promise<void> {
  const incident = incidentFromArgs(args);
  const snapshot = await ensureSnapshot(incident);
  const diff = diffTrees(snapshot, incident.appSrcDir);
  const changes = diff.added.length + diff.removed.length + diff.changed.length;

  const proceed = await confirm(
    `Reset incident ${incident.id}? ${changes > 0 ? `${changes} changed file(s) in ${relative(incident.appSrcDir)} are restored to the original (a backup is kept) and ` : ''}your progress (clock, hints, flags) is cleared.`,
    { assumeYes: flags.yes },
  );
  if (!proceed) return;

  if (changes > 0) {
    const backup = backupSource(incident);
    replaceTree(snapshot, incident.appSrcDir);
    log.ok(`Original code restored. Your version is backed up in ${bold(relative(backup))}.`);
  }

  const state = loadState();
  const running = state.current === incident.id;
  state.incidents[incident.id] = {
    sessions: running ? [{ start: new Date().toISOString() }] : [],
    hintsRevealed: 0,
    wrongSubmissions: 0,
  };
  saveState(state);
  log.ok('Progress cleared.');

  if (running) {
    await ensureDocker();
    if ((await runningServices(incident)).includes(incident.appServices[0] ?? 'api')) {
      log.step('Redeploying the original code…');
      await deploy(incident, { note: 'Reset to original code' });
      const fresh = loadState();
      const progress = fresh.incidents[incident.id];
      if (progress) progress.deployedHash = hashTree(incident.appSrcDir);
      saveState(fresh);
      log.ok('Done. The clock restarted.');
    }
  }
}
