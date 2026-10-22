import express from 'express';
import { config } from './config.ts';
import { pool } from './db.ts';

export const healthRouter = express.Router();

/** Liveness: the process is up and its event loop answers. */
healthRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: config.version });
});

/** Readiness: dependencies are reachable. */
healthRouter.get('/ready', async (_req, res) => {
  await pool.query('SELECT 1');
  res.json({ status: 'ready' });
});
