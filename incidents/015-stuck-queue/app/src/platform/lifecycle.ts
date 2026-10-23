import type { RequestHandler } from 'express';

let draining = false;

/** Shutting down: the instance still answers, but asks not to get new requests. */
export const isDraining = () => draining;

export function startDraining(): void {
  draining = true;
}

/**
 * While draining, every response closes its connection: the proxy then opens a
 * new one for its next request, to an instance that isn't going away, instead of
 * reusing a connection this instance is about to close.
 */
export const closeConnectionsWhileDraining: RequestHandler = (_req, res, next) => {
  if (draining) res.set('Connection', 'close');
  next();
};
