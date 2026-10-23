import type { ErrorRequestHandler, RequestHandler } from 'express';
import { HttpError } from '../shared/http-errors.ts';
import { logger } from './logger.ts';

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ error: { code: 'not_found', message: `No route for ${req.method} ${req.path}` } });
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).set(err.headers).json({ error: { code: err.code, message: err.message } });
    return;
  }
  // Malformed JSON body, rejected by express.json().
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'bad_request', message: 'Request body is not valid JSON' } });
    return;
  }

  logger.error({ err, method: req.method, path: req.path }, 'unhandled error');
  res.status(500).json({ error: { code: 'internal', message: 'Internal server error' } });
};
