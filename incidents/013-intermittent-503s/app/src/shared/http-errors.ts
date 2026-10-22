export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly headers: Record<string, string>;

  constructor(status: number, code: string, message: string, headers: Record<string, string> = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

export const badRequest = (message: string) => new HttpError(400, 'bad_request', message);

export const notFound = (resource: string) => new HttpError(404, 'not_found', `${resource} not found`);

export const paymentRequired = (message: string) => new HttpError(402, 'payment_declined', message);

export const conflict = (message: string) => new HttpError(409, 'conflict', message);

/** The same request is still being processed: the client should try again in a moment. */
export const stillInProgress = (message: string) => new HttpError(409, 'in_progress', message, { 'Retry-After': '1' });
