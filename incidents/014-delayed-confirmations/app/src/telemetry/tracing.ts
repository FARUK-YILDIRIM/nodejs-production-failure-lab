import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { KafkaJsInstrumentation } from '@opentelemetry/instrumentation-kafkajs';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';
import { NodeSDK } from '@opentelemetry/sdk-node';

const UNTRACED_PATHS = new Set(['/health', '/ready', '/metrics']);

/**
 * Traces are exported over OTLP. Service name, endpoint and sampling come from
 * the standard OTEL_* environment variables (see the incident's compose.yaml).
 */
export function startTracing(): void {
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return;

  const sdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (req) => UNTRACED_PATHS.has(req.url ?? ''),
        // Profiles are pushed to Pyroscope over HTTP; those calls are just noise.
        ignoreOutgoingRequestHook: (req) => req.hostname === 'pyroscope',
      }),
      new ExpressInstrumentation(),
      new PgInstrumentation(),
      new PinoInstrumentation(),
      // Order events: from the API that publishes them to the worker that consumes them.
      new KafkaJsInstrumentation(),
      // fetch() calls to other services.
      new UndiciInstrumentation({ ignoreRequestHook: (request) => request.origin.includes('pyroscope') }),
    ],
  });

  sdk.start();
  process.once('SIGTERM', () => void sdk.shutdown());
}
