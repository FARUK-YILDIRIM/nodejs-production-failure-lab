// The network between the API and its database. In production the database is
// a managed instance in another availability zone: every packet takes about
// DELAY_MS each way, so every query costs at least one round trip (~2 × DELAY_MS).
// This TCP relay reproduces that; it's infrastructure, not something you fix.
import net from 'node:net';

const LISTEN_PORT = Number(process.env.LISTEN_PORT ?? 5432);
const UPSTREAM_HOST = process.env.UPSTREAM_HOST ?? 'postgres';
const UPSTREAM_PORT = Number(process.env.UPSTREAM_PORT ?? 5432);
const DELAY_MS = Number(process.env.DELAY_MS ?? 2);

/** Forwards every chunk after DELAY_MS. Timers with equal delays fire in order, so the stream stays ordered. */
function relay(from: net.Socket, to: net.Socket): void {
  from.on('data', (chunk) => setTimeout(() => to.write(chunk), DELAY_MS));
  from.on('end', () => setTimeout(() => to.end(), DELAY_MS));
  from.on('error', () => to.destroy());
  from.on('close', () => setTimeout(() => to.destroy(), DELAY_MS));
}

net
  .createServer((client) => {
    client.setNoDelay(true);
    const upstream = net.connect({ host: UPSTREAM_HOST, port: UPSTREAM_PORT, noDelay: true });
    relay(client, upstream);
    relay(upstream, client);
  })
  .listen(LISTEN_PORT);
