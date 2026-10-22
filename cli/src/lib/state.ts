import fs from 'node:fs';
import path from 'node:path';
import type { Incident } from './incidents.ts';
import { STATE_DIR } from './paths.ts';

export const HINT_PENALTY_MS = 10 * 60_000;
export const WRONG_DIAGNOSIS_PENALTY_MS = 5 * 60_000;

interface Session {
  start: string;
  end?: string;
}

export interface Progress {
  /** Time only counts while the incident is running (`start` → `stop`). */
  sessions: Session[];
  hintsRevealed: number;
  wrongSubmissions: number;
  diagnosedAt?: string;
  fixedAt?: string;
  solvedAt?: string;
  solutionViewedAt?: string;
  /** Hash of the app source that is currently deployed. */
  deployedHash?: string;
}

export interface State {
  current?: string;
  incidents: Record<string, Progress>;
}

const FILE = path.join(STATE_DIR, 'state.json');

export function loadState(): State {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8')) as State;
  } catch {
    return { incidents: {} };
  }
}

export function saveState(state: State): void {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(FILE, `${JSON.stringify(state, null, 2)}\n`);
}

export function progressOf(state: State, incident: Incident): Progress {
  state.incidents[incident.id] ??= { sessions: [], hintsRevealed: 0, wrongSubmissions: 0 };
  return state.incidents[incident.id] as Progress;
}

export function openSession(progress: Progress): void {
  const last = progress.sessions.at(-1);
  if (!last || last.end) progress.sessions.push({ start: new Date().toISOString() });
}

export function closeSession(progress: Progress): void {
  const last = progress.sessions.at(-1);
  if (last && !last.end) last.end = new Date().toISOString();
}

/** Active time until the incident was solved (or until now). */
export function activeMs(progress: Progress): number {
  const until = progress.solvedAt ? Date.parse(progress.solvedAt) : Date.now();
  return progress.sessions.reduce((total, session) => {
    const start = Date.parse(session.start);
    const end = Math.min(session.end ? Date.parse(session.end) : Date.now(), until);
    return total + Math.max(0, end - start);
  }, 0);
}

export function penaltyMs(progress: Progress): number {
  return progress.hintsRevealed * HINT_PENALTY_MS + progress.wrongSubmissions * WRONG_DIAGNOSIS_PENALTY_MS;
}

/** "1 hint, 2 wrong diagnoses" */
export function penaltyBreakdown({ hintsRevealed, wrongSubmissions }: Progress): string {
  return `${hintsRevealed} ${hintsRevealed === 1 ? 'hint' : 'hints'}, ${wrongSubmissions} wrong ${wrongSubmissions === 1 ? 'diagnosis' : 'diagnoses'}`;
}

/** Marks the incident solved once both flags are captured. Returns true the moment it happens. */
export function markSolvedIfComplete(progress: Progress): boolean {
  if (progress.solvedAt || !progress.diagnosedAt || !progress.fixedAt) return false;
  progress.solvedAt = new Date().toISOString();
  return true;
}
