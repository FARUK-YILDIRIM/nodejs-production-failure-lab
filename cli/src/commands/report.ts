import fs from 'node:fs';
import path from 'node:path';
import { incidentFromArgs } from '../lib/current.ts';
import { relative, REPORTS_DIR, TEMPLATES_DIR } from '../lib/paths.ts';
import { activeMs, loadState, penaltyMs, progressOf } from '../lib/state.ts';
import { bold, formatDuration, log } from '../lib/ui.ts';

export function report(args: string[]): void {
  const incident = incidentFromArgs(args);
  const target = path.join(REPORTS_DIR, `${incident.slug}.md`);

  if (fs.existsSync(target)) {
    log.info(`Your postmortem is at ${bold(relative(target))}.`);
    return;
  }

  const progress = progressOf(loadState(), incident);
  const filled = fs
    .readFileSync(path.join(TEMPLATES_DIR, 'POSTMORTEM.md'), 'utf8')
    .replaceAll('{{id}}', incident.id)
    .replaceAll('{{title}}', incident.title)
    .replaceAll('{{date}}', new Date().toISOString().slice(0, 10))
    .replaceAll('{{time}}', formatDuration(activeMs(progress) + penaltyMs(progress)));

  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  fs.writeFileSync(target, filled);
  log.ok(`Postmortem created: ${bold(relative(target))}`);
  log.info('Fill it in with the evidence you collected (queries, screenshots, profiles), then compare with the official solution.');
}
