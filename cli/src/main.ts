import { parseArgs } from 'node:util';
import { deploy } from './commands/deploy.ts';
import { dev } from './commands/dev.ts';
import { hint } from './commands/hint.ts';
import { report } from './commands/report.ts';
import { reset } from './commands/reset.ts';
import { logs, psql } from './commands/shell.ts';
import { solution } from './commands/solution.ts';
import { start } from './commands/start.ts';
import { list, status } from './commands/status.ts';
import { stop } from './commands/stop.ts';
import { submit } from './commands/submit.ts';
import { traffic } from './commands/traffic.ts';
import { verify } from './commands/verify.ts';
import { LabError } from './lib/errors.ts';
import { bold, dim, log } from './lib/ui.ts';

const HELP = `
${bold('Node Production Failure Lab')}: break, observe, diagnose and fix production incidents.

${bold('Usage')}  ./lab <command> [incident] [options]

${bold('Play')}
  list                  Incidents and your progress
  start <id>            Start an incident (stops any other)       ${dim('--no-traffic')}
  status                What's running, your clock and your flags
  hint [id]             Reveal the next hint (+10 min)             ${dim('--yes')}
  submit [id]           🚩 Submit your diagnosis                   ${dim('--answer id=value')}
  deploy                Deploy your working copy of the service    ${dim('--build')}
  verify [id]           🚩 Prove the fix: checks + load test + SLOs ${dim('--no-baseline')}
  report [id]           Create your postmortem from the template
  solution [id]         Read the official solution                 ${dim('--yes')}
  stop                  Stop the lab and pause your clock          ${dim('--volumes')}

${bold('Tools')}
  traffic on|off        Pause or resume simulated production traffic
  logs [service]        Follow a service's logs (default: api)
  psql                  SQL shell on the incident's database
  reset [id]            Restore the original code and start over  ${dim('--yes')}

${bold('Authoring')}  ${dim('(see docs/authoring-incidents.md)')}
  dev answer-hash <id> <question> <answer>   Hash an accepted answer for incident.json
  dev body-hash <path>                       Golden hash of a response, for checks.ts
  verify <id> --ci --expect-fail             Exit 0 only if the original code violates its SLOs
`;

const OPTIONS = {
  yes: { type: 'boolean', short: 'y', default: false },
  'no-traffic': { type: 'boolean', default: false },
  build: { type: 'boolean', default: false },
  volumes: { type: 'boolean', default: false },
  ci: { type: 'boolean', default: false },
  'expect-fail': { type: 'boolean', default: false },
  'no-baseline': { type: 'boolean', default: false },
  answer: { type: 'string', multiple: true, default: [] as string[] },
  help: { type: 'boolean', short: 'h', default: false },
} as const;

async function main(argv: string[]): Promise<void> {
  const [command = 'help', ...rest] = argv;
  const { values: flags, positionals: args } = parseArgs({ args: rest, options: OPTIONS, allowPositionals: true });

  if (flags.help) {
    log.info(HELP);
    return;
  }

  switch (command) {
    case 'list':
      return list();
    case 'start':
      return start(args, { traffic: !flags['no-traffic'] });
    case 'status':
      return status();
    case 'hint':
      return hint(args, { yes: flags.yes });
    case 'submit':
      return submit(args, { answers: flags.answer });
    case 'deploy':
      return deploy(args, { build: flags.build });
    case 'verify':
      return verify(args, { ci: flags.ci, expectFail: flags['expect-fail'], baseline: !flags['no-baseline'] && !flags.ci });
    case 'report':
      return report(args);
    case 'solution':
      return solution(args, { yes: flags.yes });
    case 'stop':
      return stop({ volumes: flags.volumes });
    case 'traffic':
      return traffic(args);
    case 'logs':
      return logs(args);
    case 'psql':
      return psql();
    case 'reset':
      return reset(args, { yes: flags.yes });
    case 'dev':
      return dev(args);
    case 'help':
    case '--help':
    case '-h':
      log.info(HELP);
      return;
    default:
      throw new LabError(`Unknown command "${command}". Run \`./lab help\`.`);
  }
}

main(process.argv.slice(2)).catch((err: unknown) => {
  if (err instanceof LabError || (err instanceof TypeError && 'code' in err && String(err.code).startsWith('ERR_PARSE_ARGS'))) {
    log.fail(err.message);
  } else {
    console.error(err);
  }
  process.exitCode = 1;
});
