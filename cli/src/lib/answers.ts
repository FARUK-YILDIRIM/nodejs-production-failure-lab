import { createHash } from 'node:crypto';
import type { Question } from './incidents.ts';

/**
 * Answers are stored as salted hashes in incident.json, so browsing the repo
 * doesn't spoil them. They only need to resist accidental reading, not attackers.
 */
export function normalizeAnswer(question: Question, raw: string): string {
  const value = raw.trim().toLowerCase();
  switch (question.type) {
    case 'choice':
      return value;
    case 'endpoint':
      return (
        value
          .replace(/^(get|post|put|patch|delete)\s+/, '')
          .replace(/^https?:\/\/[^/]+/, '')
          .split('?', 1)[0]!
          .replace(/\/+$/, '')
          .replace(/^(?!\/)/, '/')
      );
    case 'text':
      return value.replace(/\(\)$/, '').replace(/\s+/g, ' ');
  }
}

export function answerHash(incidentId: string, questionId: string, normalized: string): string {
  return createHash('sha256').update(`nplab:${incidentId}:${questionId}:${normalized}`).digest('hex');
}

export function isCorrect(incidentId: string, question: Question, raw: string): boolean {
  return question.answers.includes(answerHash(incidentId, question.id, normalizeAnswer(question, raw)));
}
