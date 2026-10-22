import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const INCIDENTS_DIR = path.join(ROOT, 'incidents');
export const SPOILERS_DIR = path.join(ROOT, 'spoilers');
export const TEMPLATES_DIR = path.join(ROOT, 'templates');
export const REPORTS_DIR = path.join(ROOT, 'reports');

/** Local, git-ignored lab state: progress, code snapshots, measurement results. */
export const STATE_DIR = path.join(ROOT, '.lab');

const port = (name: string, fallback: number) => Number(process.env[`LAB_PORT_${name}`] ?? fallback);

export const urls = {
  api: `http://localhost:${port('API', 8080)}`,
  grafana: `http://localhost:${port('GRAFANA', 3000)}`,
  prometheus: `http://localhost:${port('PROMETHEUS', 9090)}`,
  jaeger: `http://localhost:${port('JAEGER', 16686)}`,
  pyroscope: `http://localhost:${port('PYROSCOPE', 4040)}`,
  inspector: `127.0.0.1:${port('INSPECTOR', 9229)}`,
};

export const relative = (file: string) => path.relative(process.cwd(), file) || '.';
