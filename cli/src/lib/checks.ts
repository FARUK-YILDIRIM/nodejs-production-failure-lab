import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Incident } from './incidents.ts';
import { urls } from './paths.ts';

/**
 * Functional checks run before every load test: a fix must keep the API
 * behaving exactly as before. Each incident exports `checks` from checks.ts.
 */
export interface Check {
  name: string;
  run(api: Api): Promise<void>;
}

export interface Api {
  get(path: string): Promise<Response>;
  post(path: string, body: unknown): Promise<Response>;
}

export class CheckFailure extends Error {
  override name = 'CheckFailure';
}

export function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new CheckFailure(message);
}

export function expectStatus(response: Response, status: number): void {
  expect(response.status === status, `expected HTTP ${status}, got ${response.status}`);
}

export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/** The response body must be byte-for-byte what the original service returned. */
export async function expectBody(response: Response, expectedSha256: string): Promise<void> {
  expectStatus(response, 200);
  const actual = sha256(await response.text());
  expect(actual === expectedSha256, `response body changed (sha256 ${actual.slice(0, 12)}…, expected ${expectedSha256.slice(0, 12)}…)`);
}

const TIMEOUT_MS = 30_000;

export const api: Api = {
  get: (url) => fetch(`${urls.api}${url}`, { signal: AbortSignal.timeout(TIMEOUT_MS) }),
  post: (url, body) =>
    fetch(`${urls.api}${url}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }),
};

export interface CheckResult {
  name: string;
  error?: string;
  /** The API was down (crashing or restarting), so the check says nothing about behavior. */
  unavailable?: boolean;
}

async function healthy(): Promise<boolean> {
  try {
    return (await fetch(`${urls.api}/health`, { signal: AbortSignal.timeout(2_000) })).ok;
  } catch {
    return false;
  }
}

async function waitUntilHealthy(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await healthy()) return true;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return false;
}

export async function runChecks(incident: Incident): Promise<CheckResult[]> {
  const module = (await import(pathToFileURL(path.join(incident.dir, 'checks.ts')).href)) as { checks: Check[] };
  const results: CheckResult[] = [];
  for (const check of module.checks) {
    let result: CheckResult = { name: check.name };
    // A failure while the API is down (e.g. restarting after a crash) isn't a behavior
    // change: wait for it to come back and try again.
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await check.run(api);
        result = { name: check.name };
        break;
      } catch (err) {
        result = { name: check.name, error: err instanceof Error ? err.message : String(err) };
        if (await healthy()) break;
        result.unavailable = true;
        await waitUntilHealthy(60_000);
      }
    }
    results.push(result);
  }
  return results;
}
