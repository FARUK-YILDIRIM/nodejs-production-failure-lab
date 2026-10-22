import Pyroscope from '@pyroscope/nodejs';

/** Continuous profiling: wall-clock (with CPU time) and heap profiles pushed to Pyroscope. */
export function startProfiling(): void {
  const serverAddress = process.env.PYROSCOPE_SERVER_ADDRESS;
  if (!serverAddress) return;

  Pyroscope.init({
    serverAddress,
    appName: process.env.OTEL_SERVICE_NAME ?? 'shopflow-api',
    wall: { collectCpuTime: true },
  });
  Pyroscope.start();
}
