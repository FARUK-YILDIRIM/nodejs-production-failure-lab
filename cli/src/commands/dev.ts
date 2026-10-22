import { answerHash, normalizeAnswer } from '../lib/answers.ts';
import { api, sha256 } from '../lib/checks.ts';
import { LabError } from '../lib/errors.ts';
import { findIncident } from '../lib/incidents.ts';
import { log } from '../lib/ui.ts';

const USAGE = 'Usage: ./lab dev answer-hash <incident> <question-id> <answer> | ./lab dev body-hash <path>';

/** Helpers for incident authors. */
export async function dev(args: string[]): Promise<void> {
  const [command, ...rest] = args;

  if (command === 'answer-hash') {
    const [id, questionId, ...words] = rest;
    const incident = findIncident(id);
    const question = incident.submit.questions.find((candidate) => candidate.id === questionId);
    if (!question || words.length === 0) {
      throw new LabError(`${USAGE}\nThe question must already exist in incident.json (with "answers": []).`);
    }
    const normalized = normalizeAnswer(question, words.join(' '));
    log.info(`${answerHash(incident.id, question.id, normalized)}  ${normalized}`);
    return;
  }

  if (command === 'body-hash') {
    const [path] = rest;
    if (!path) throw new LabError(USAGE);
    const response = await api.get(path);
    const body = await response.text();
    log.info(`${sha256(body)}  HTTP ${response.status}  ${body.length} bytes  ${path}`);
    return;
  }

  throw new LabError(USAGE);
}
