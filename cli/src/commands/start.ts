import { compose, composeOrFail, defaultServices, ensureDocker, runningServices } from '../lib/compose.ts';
import { deploy } from '../lib/deploy.ts';
import { annotate, waitForGrafana } from '../lib/grafana.ts';
import { findIncident, type Incident } from '../lib/incidents.ts';
import { relative, urls } from '../lib/paths.ts';
import { ensureSnapshot, hashTree } from '../lib/source.ts';
import { closeSession, loadState, openSession, progressOf, saveState } from '../lib/state.ts';
import { bold, box, dim, log, red, stars, table, yellow } from '../lib/ui.ts';

export async function start(args: string[], flags: { traffic: boolean }): Promise<void> {
  const incident = findIncident(args[0]);
  await ensureDocker();

  const state = loadState();
  if (state.current && state.current !== incident.id) {
    const previous = findIncident(state.current);
    log.step(`Stopping incident ${previous.id} first…`);
    await compose(previous, ['down', '--remove-orphans']);
    closeSession(progressOf(state, previous));
    delete state.current;
    saveState(state);
  }

  await ensureSnapshot(incident);

  log.title(`Starting incident ${incident.id} · ${incident.title}`);
  log.info(dim('Building the service and starting the platform. The first start also seeds the database (~1 min).'));

  const progress = progressOf(state, incident);
  const sourceHash = hashTree(incident.appSrcDir);
  // `up` leaves a running service alone, so an undeployed change would stay undeployed.
  const staleDeploy =
    (await runningServices(incident)).includes(incident.appServices[0] ?? 'api') && progress.deployedHash !== sourceHash;

  const services = (await defaultServices(incident)).filter((service) => flags.traffic || service !== 'traffic');
  await composeOrFail(incident, ['up', '-d', '--build', '--remove-orphans', '--wait', '--wait-timeout', '300', ...services], 'Starting the incident', {
    env: { LAB_APP_SRC: '' },
  });
  if (staleDeploy) await deploy(incident, { note: 'Deployed working copy (start)' });
  if (!flags.traffic) await compose(incident, ['stop', 'traffic']);
  await waitForGrafana();

  openSession(progress);
  progress.deployedHash = sourceHash;
  state.current = incident.id;
  saveState(state);
  await annotate(`Incident ${incident.id} started`, ['lab']);

  printBrief(incident, flags.traffic);
}

function printBrief(incident: Incident, traffic: boolean): void {
  log.info();
  log.info(box([`${red('🔥')} ${bold(incident.alert)}`]));
  log.info();
  log.info(`  ${bold(incident.title)}  ${yellow(stars(incident.difficulty))}  ${dim(incident.estimatedTime)}`);
  log.info(`  ${incident.summary}`);
  log.info();
  log.info(`  Read the full brief: ${bold(relative(incident.readme))}`);
  log.info();
  log.info(
    table(
      [
        ['API (via edge proxy)', urls.api],
        ['Grafana', urls.grafana],
        ['Prometheus', urls.prometheus],
        ['Jaeger', urls.jaeger],
        ['Node.js inspector', `${urls.inspector}  ${dim('(chrome://inspect)')}`],
        ['Service code', relative(incident.appSrcDir)],
      ],
      ['Tool', 'Where'],
    ),
  );
  log.info();
  if (!traffic) log.info(dim('  Production traffic is off (--no-traffic). Turn it on with `./lab traffic on`.\n'));
  log.info(`  ${dim('Next:')} investigate → ${bold(`./lab submit ${incident.id}`)} → fix + ${bold('./lab deploy')} → ${bold(`./lab verify ${incident.id}`)}`);
  log.info(`  ${dim('Stuck?')} ${bold(`./lab hint ${incident.id}`)} ${dim('(+10 min)')}   ${dim('Done for today?')} ${bold('./lab stop')} ${dim('(pauses your clock)')}`);
  log.info();
}
