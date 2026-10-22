import { urls } from './paths.ts';

/** Adds an annotation (a vertical marker on every dashboard panel). Best effort. */
export async function annotate(text: string, tags: string[]): Promise<void> {
  try {
    await fetch(`${urls.grafana}/api/annotations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ time: Date.now(), tags, text }),
      signal: AbortSignal.timeout(3_000),
    });
  } catch {
    // Grafana not up yet: the marker is a nice-to-have.
  }
}

export async function waitForGrafana(timeoutMs = 60_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${urls.grafana}/api/health`, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return true;
    } catch {
      // still starting
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return false;
}
