import { LabError } from './errors.ts';
import { run, type RunOptions } from './exec.ts';
import type { Incident } from './incidents.ts';

export function compose(incident: Incident, args: string[], options: RunOptions = {}) {
  // The edge proxy load-balances over the API's instances when there are several.
  const replicas = incident.appServices.length > 1 ? incident.appServices.join(',') : '';
  return run('docker', ['compose', '-f', incident.composeFile, ...args], {
    ...options,
    env: { LAB_API_REPLICAS: replicas, ...options.env },
  });
}

/** Waits until Docker reports the service's container as healthy. */
export async function waitHealthy(incident: Incident, service: string, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await compose(incident, ['ps', '--format', '{{.Health}}', service]);
    if (result.stdout.trim() === 'healthy') return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new LabError(`${service} did not become healthy within ${Math.round(timeoutMs / 1000)}s`);
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
