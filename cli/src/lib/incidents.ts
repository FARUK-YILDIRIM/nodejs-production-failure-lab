import fs from 'node:fs';
import path from 'node:path';
import { LabError } from './errors.ts';
import { INCIDENTS_DIR, SPOILERS_DIR } from './paths.ts';

export type Question =
  | { id: string; prompt: string; type: 'endpoint' | 'text'; hint?: string; answers: string[] }
  | { id: string; prompt: string; type: 'choice'; choices: { id: string; label: string }[]; answers: string[] };

/** A user-facing service level objective, evaluated on the k6 end-of-test summary. */
export interface Slo {
  label: string;
  /** k6 metric name, optionally with a tag filter: `http_req_duration{journey:catalog}`. */
  metric: string;
  /** k6 summary stat: `p(95)`, `avg`, `rate`… */
  stat: string;
  max: number;
  unit: 'ms' | 'ratio';
}

/** incident.json */
export interface IncidentManifest {
  id: string;
  title: string;
  difficulty: number;
  estimatedTime: string;
  summary: string;
  alert: string;
  submit: { questions: Question[] };
  verify: { warmupSeconds: number; durationSeconds: number; slos: Slo[] };
}

export interface Incident extends IncidentManifest {
  slug: string;
  dir: string;
  composeFile: string;
  appDir: string;
  appSrcDir: string;
  readme: string;
  spoilersDir: string;
  /** The service students change and deploy. */
  appService: 'api';
}

function load(slug: string): Incident {
  const dir = path.join(INCIDENTS_DIR, slug);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'incident.json'), 'utf8')) as IncidentManifest;
  return {
    ...manifest,
    slug,
    dir,
    composeFile: path.join(dir, 'compose.yaml'),
    appDir: path.join(dir, 'app'),
    appSrcDir: path.join(dir, 'app', 'src'),
    readme: path.join(dir, 'README.md'),
    spoilersDir: path.join(SPOILERS_DIR, slug),
    appService: 'api',
  };
}

export function listIncidents(): Incident[] {
  return fs
    .readdirSync(INCIDENTS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(INCIDENTS_DIR, entry.name, 'incident.json')))
    .map((entry) => load(entry.name))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Accepts "1", "001" or the full slug "001-latency-spike". */
export function findIncident(ref: string | undefined): Incident {
  if (!ref) throw new LabError('Which incident? Pass its number, e.g. `./lab start 001` (see `./lab list`).');
  const id = /^\d+$/.test(ref) ? ref.padStart(3, '0') : undefined;
  const incident = listIncidents().find((candidate) => candidate.id === id || candidate.slug === ref);
  if (!incident) throw new LabError(`No incident "${ref}". Run \`./lab list\` to see them all.`);
  return incident;
}
