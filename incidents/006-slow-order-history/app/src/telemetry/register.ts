// Preloaded with `node --import ./src/telemetry/register.ts` so tracing and
// profiling are running before any application module is imported.
import { register } from 'import-in-the-middle/register-hooks.mjs';

// ESM imports of these packages are intercepted so the OpenTelemetry
// instrumentations can patch them. Everything else, including our own .ts
// files, loads untouched.
register({ include: ['express', 'pg', 'pg-pool', 'pino', 'http', 'https'] });

const { startTracing } = await import('./tracing.ts');
const { startProfiling } = await import('./profiling.ts');

startTracing();
startProfiling();
