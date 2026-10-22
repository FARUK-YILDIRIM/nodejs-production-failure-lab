import http from 'node:http';
import { config } from '../platform/config.ts';
import { outboundDuration } from '../platform/http-client.ts';

export interface TaxQuote {
  rateBasisPoints: number;
  taxCents: number;
}

/**
 * Sales tax / VAT for an order, from TaxRate.
 *
 * TaxRate closes idle keep-alive connections after 5 s, which gave us
 * ECONNRESET errors on reused sockets in staging (#596), so every quote
 * uses a fresh connection.
 */
export function quoteTax(request: { country: string; amountCents: number }): Promise<TaxQuote> {
  const body = JSON.stringify(request);
  const stopTimer = outboundDuration.startTimer({ peer: 'taxrate', method: 'POST' });

  return new Promise((resolve, reject) => {
    const req = http.request(
      new URL('/v1/quotes', config.taxrateUrl),
      {
        method: 'POST',
        agent: false,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (raw += chunk));
        res.on('end', () => {
          stopTimer({ status_code: String(res.statusCode) });
          if (res.statusCode !== 200) reject(new Error(`TaxRate responded ${res.statusCode}: ${raw}`));
          else resolve(JSON.parse(raw) as TaxQuote);
        });
      },
    );
    req.on('error', (err) => {
      stopTimer({ status_code: 'error' });
      reject(err);
    });
    req.end(body);
  });
}
