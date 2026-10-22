import { createApp } from './app.ts';
import { config } from './platform/config.ts';
import { pool } from './platform/db.ts';
import { logger } from './platform/logger.ts';
import { startMetricsServer } from './telemetry/metrics.ts';

const metricsServer = startMetricsServer(config.metricsPort);

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

let shuttingDown = false;

function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');

  // Docker sends SIGKILL after 10s; leave in a controlled way before that.
  setTimeout(() => process.exit(1), 8_000).unref();

  server.close(() => {
    metricsServer.close();
    pool.end().finally(() => process.exit(0));
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
