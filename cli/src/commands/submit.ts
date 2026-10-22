import { isCorrect } from '../lib/answers.ts';
import { incidentFromArgs } from '../lib/current.ts';
import { LabError } from '../lib/errors.ts';
import { loadState, markSolvedIfComplete, progressOf, saveState, WRONG_DIAGNOSIS_PENALTY_MS } from '../lib/state.ts';
import { ask, bold, choose, dim, formatDuration, interactive, log, yellow } from '../lib/ui.ts';
import { printSolved } from './verify.ts';

/** `--answer id=value` pairs, for scripted runs. */
function parseAnswers(pairs: string[]): Map<string, string> {
  return new Map(
    pairs.map((pair) => {
      const [id, ...value] = pair.split('=');
      return [id ?? '', value.join('=')];
    }),
  );
}

export async function submit(args: string[], flags: { answers: string[] }): Promise<void> {
  const incident = incidentFromArgs(args);
  const state = loadState();
  const progress = progressOf(state, incident);

  if (progress.diagnosedAt) {
    log.ok(`🚩 Diagnosis already captured for incident ${incident.id}.`);
    return;
  }

  const given = parseAnswers(flags.answers);
  const { questions } = incident.submit;
  if (!interactive() && questions.some((question) => !given.has(question.id))) {
    throw new LabError(`Answer interactively, or pass every answer: ${questions.map((q) => `--answer ${q.id}=…`).join(' ')}`);
  }

  log.title(`Diagnosis · incident ${incident.id}`);
  log.info(dim(`${questions.length} questions. A wrong submission adds +${formatDuration(WRONG_DIAGNOSIS_PENALTY_MS)} to your time.\n`));

  const results: boolean[] = [];
  for (const [index, question] of questions.entries()) {
    const prompt = `${bold(`${index + 1}. ${question.prompt}`)}`;
    let answer = given.get(question.id);
    if (answer === undefined) {
      if (question.type === 'choice') {
        answer = await choose(prompt, question.choices);
      } else {
        log.info(prompt);
        answer = await ask(`  ${question.hint ? dim(`${question.hint} `) : ''}› `);
      }
      log.info();
    }
    results.push(isCorrect(incident.id, question, answer));
  }

  if (results.every(Boolean)) {
    progress.diagnosedAt = new Date().toISOString();
    const solved = markSolvedIfComplete(progress);
    saveState(state);
    log.ok(bold('🚩 Correct diagnosis! Flag 1 captured.'));
    if (solved) printSolved(incident, progress);
    else log.info(dim(`Now fix it: change the code, \`./lab deploy\`, then \`./lab verify ${incident.id}\` for the second flag.`));
    return;
  }

  progress.wrongSubmissions += 1;
  saveState(state);
  questions.forEach((question, index) =>
    results[index] ? log.ok(question.prompt) : log.fail(`${question.prompt} ${dim('(not quite)')}`),
  );
  log.info(yellow(`\n+${formatDuration(WRONG_DIAGNOSIS_PENALTY_MS)}. Gather more evidence and submit again.`));
  process.exitCode = 1;
}
