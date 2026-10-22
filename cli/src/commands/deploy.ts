import { ensureDocker } from '../lib/compose.ts';
import { ensureRunning, incidentFromArgs } from '../lib/current.ts';
import { deploy as deployService } from '../lib/deploy.ts';
import { relative } from '../lib/paths.ts';
import { diffTrees, ensureSnapshot, hashTree } from '../lib/source.ts';
import { loadState, progressOf, saveState } from '../lib/state.ts';
import { dim, log } from '../lib/ui.ts';

export async function deploy(args: string[], flags: { build: boolean }): Promise<void> {
  const incident = incidentFromArgs(args);
  await ensureDocker();
  await ensureRunning(incident);

  const diff = diffTrees(await ensureSnapshot(incident), incident.appSrcDir);
  const changed = [...diff.changed, ...diff.added.map((file) => `${file} (new)`), ...diff.removed.map((file) => `${file} (deleted)`)];
  log.step(`Deploying ${relative(incident.appSrcDir)}${flags.build ? ' (rebuilding the image)' : ''}…`);
  if (changed.length > 0) log.info(dim(`  changed since the original: ${changed.join(', ')}`));

  await deployService(incident, { build: flags.build, note: `Deployed working copy (${changed.length} files changed)` });

  const state = loadState();
  progressOf(state, incident).deployedHash = hashTree(incident.appSrcDir);
  saveState(state);
  log.ok('Deployed and healthy. Watch the dashboards, then run `./lab verify` when you think it is fixed.');
}
