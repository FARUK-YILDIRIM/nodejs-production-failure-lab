import fs from 'node:fs';
import path from 'node:path';
import { incidentFromArgs } from '../lib/current.ts';
import { LabError } from '../lib/errors.ts';
import { HINT_PENALTY_MS, loadState, progressOf, saveState } from '../lib/state.ts';
import { bold, confirm, dim, formatDuration, log, yellow } from '../lib/ui.ts';

export async function hint(args: string[], flags: { yes: boolean }): Promise<void> {
  const incident = incidentFromArgs(args);
  const hintsDir = path.join(incident.spoilersDir, 'hints');
  const files = fs.existsSync(hintsDir) ? fs.readdirSync(hintsDir).filter((file) => file.endsWith('.md')).sort() : [];
  if (files.length === 0) throw new LabError(`Incident ${incident.id} has no hints.`);

  const state = loadState();
  const progress = progressOf(state, incident);
  const show = (index: number) => {
    log.title(`Hint ${index + 1}/${files.length}`);
    log.info(fs.readFileSync(path.join(hintsDir, files[index] as string), 'utf8').trim());
  };

  // Once solved, hints are free to read.
  if (progress.solvedAt) {
    files.forEach((_, index) => show(index));
    return;
  }

  for (let index = 0; index < progress.hintsRevealed; index++) show(index);

  if (progress.hintsRevealed >= files.length) {
    log.info(dim(`\nThat was the last hint. The full solution: ./lab solution ${incident.id}`));
    return;
  }

  log.info();
  const reveal = await confirm(
    `Reveal hint ${progress.hintsRevealed + 1}/${files.length}? It adds ${yellow(`+${formatDuration(HINT_PENALTY_MS)}`)} to your time.`,
    { assumeYes: flags.yes },
  );
  if (!reveal) return;

  show(progress.hintsRevealed);
  progress.hintsRevealed += 1;
  saveState(state);
  log.info(dim(`\n${bold(String(progress.hintsRevealed))} of ${files.length} hints used.`));
}
