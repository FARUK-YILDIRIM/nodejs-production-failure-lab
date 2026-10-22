import { Histogram } from 'prom-client';
import { registry } from '../telemetry/metrics.ts';

const outboundDuration = new Histogram({
  name: 'http_client_request_duration_seconds',
  help: 'Duration of HTTP calls to other services, by peer and response status ("error" when no response came back).',
  labelNames: ['peer', 'method', 'status_code'] as const,
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  registers: [registry],
});

/** fetch() for calls to other services, recording latency and status per peer. */
export async function callService(peer: string, url: string, init: RequestInit = {}): Promise<Response> {
  const stopTimer = outboundDuration.startTimer({ peer, method: init.method ?? 'GET' });
  try {
    const response = await fetch(url, init);
    stopTimer({ status_code: String(response.status) });
    return response;
  } catch (err) {
    stopTimer({ status_code: 'error' });
    throw err;
  }
}
