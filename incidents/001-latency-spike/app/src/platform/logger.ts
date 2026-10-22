import { pino } from 'pino';
import { config } from './config.ts';

// JSON logs on stdout. Inside a traced request, trace_id and span_id are added
// automatically, so a log line can be matched with its trace in Jaeger.
export const logger = pino({
  level: config.logLevel,
  base: { service: config.service, version: config.version },
  timestamp: pino.stdTimeFunctions.isoTime,
});
