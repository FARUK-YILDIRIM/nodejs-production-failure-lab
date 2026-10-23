import { createApp } from './app.ts';
import { config } from './platform/config.ts';
import { pool } from './platform/db.ts';
import { disconnectProducer } from './orders/order-events.ts';
import { startDraining } from './platform/lifecycle.ts';
import { logger } from './platform/logger.ts';
import { migrate } from './platform/migrations.ts';
import { startMetricsServer } from './telemetry/metrics.ts';

const metricsServer = startMetricsServer(config.metricsPort);

// Schema changes ship with the code: apply pending migrations before serving traffic.
await migrate();

const server = createApp().listen(config.port, (err?: Error) => {
  if (err) {
    logger.fatal({ err }, 'failed to start');
    process.exit(1);
  }
  logger.info({ port: config.port }, 'shopflow-api listening');
});

// Must outlive the proxy's idle timeout for upstream connections (Traefik: 90s);
// otherwise Node can close a keep-alive connection the proxy is about to reuse.
server.keepAliveTimeout = 95_000;
server.headersTimeout = 96_000;

// The proxy checks each instance's /ready every 2 s. Keep serving for longer than
// that after SIGTERM, so it has stopped sending requests here before we stop
// accepting them.
const DRAIN_MS = 5_000;

let shuttingDown = false;

function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  // 1. /ready answers 503, and responses close their connections.
  startDraining();
  logger.info({ signal, drainMs: DRAIN_MS }, 'shutting down: draining');

  // Docker sends SIGKILL after 10s; leave in a controlled way before that.
  setTimeout(() => process.exit(1), 9_000).unref();

  // 2. Once the proxy has moved on: stop accepting connections, let the requests
  // in flight finish, then close the database pool and exit.
  setTimeout(() => {
    logger.info('shutting down: closing');
    server.close(() => {
      metricsServer.close();
      disconnectProducer()
        .then(() => pool.end())
        .finally(() => process.exit(0));
    });
    server.closeIdleConnections();
  }, DRAIN_MS).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
