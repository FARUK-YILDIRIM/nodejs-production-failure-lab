import { LabError } from './errors.ts';
import { run, type RunOptions } from './exec.ts';
import type { Incident } from './incidents.ts';

export function compose(incident: Incident, args: string[], options?: RunOptions) {
  return run('docker', ['compose', '-f', incident.composeFile, ...args], options);
}

/** Like compose(), but turns a non-zero exit into a LabError that includes Docker's output. */
export async function composeOrFail(incident: Incident, args: string[], action: string, options?: RunOptions) {
  const result = await compose(incident, args, options);
  if (result.code !== 0) {
    const output = (result.stderr || result.stdout).trim().split('\n').slice(-15).join('\n');
    throw new LabError(`${action} failed:\n${output}`);
  }
  return result;
}

export async function ensureDocker(): Promise<void> {
  const result = await run('docker', ['info', '--format', '{{.ServerVersion}}']);
  if (result.code !== 0) {
    throw new LabError('Docker is not running. Start Docker Desktop (or the Docker daemon) and try again.');
  }
}

export async function runningServices(incident: Incident): Promise<string[]> {
  const result = await compose(incident, ['ps', '--status', 'running', '--services']);
  return result.code === 0 ? result.stdout.split('\n').filter(Boolean) : [];
}

/** Services started by default (excludes on-demand ones such as the k6 runner). */
export async function defaultServices(incident: Incident): Promise<string[]> {
  const result = await composeOrFail(incident, ['config', '--services'], 'Reading compose.yaml');
  return result.stdout.split('\n').filter(Boolean);
}
