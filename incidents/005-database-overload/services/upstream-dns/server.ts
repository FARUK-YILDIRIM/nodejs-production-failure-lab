// The upstream DNS resolver the API's container uses for names outside the
// cluster (Docker's embedded DNS forwards them here). It answers for TaxRate's
// domain the way an overloaded authoritative server would: correctly, but slowly.
// Students don't own it; it stands for "the internet".
import dgram from 'node:dgram';
import { lookup } from 'node:dns/promises';

const ZONE = 'taxrate.example';
const DELAY_MS = Number(process.env.DELAY_MS ?? 1200);
const JITTER_MS = Number(process.env.JITTER_MS ?? 300);
const TTL_SECONDS = 30;

const TYPE_A = 1;
const TYPE_AAAA = 28;

interface Question {
  name: string;
  type: number;
  /** The raw question section, echoed back in the response. */
  raw: Buffer;
}

function parseQuestion(message: Buffer): Question | undefined {
  const labels: string[] = [];
  let offset = 12;
  while (offset < message.length) {
    const length = message[offset] ?? 0;
    if (length === 0) break;
    labels.push(message.subarray(offset + 1, offset + 1 + length).toString('ascii'));
    offset += 1 + length;
  }
  if (offset + 5 > message.length) return undefined;
  const end = offset + 5; // zero byte + QTYPE (2) + QCLASS (2)
  return { name: labels.join('.').toLowerCase(), type: message.readUInt16BE(offset + 1), raw: message.subarray(12, end) };
}

function response(query: Buffer, question: Question, { rcode, address }: { rcode: number; address?: string }): Buffer {
  const header = Buffer.alloc(12);
  query.copy(header, 0, 0, 2); // transaction id
  header.writeUInt16BE(0x8180 | rcode, 2); // response, recursion desired + available
  header.writeUInt16BE(1, 4); // one question
  header.writeUInt16BE(address ? 1 : 0, 6); // answers

  if (!address) return Buffer.concat([header, question.raw]);
  const answer = Buffer.alloc(16);
  answer.writeUInt16BE(0xc00c, 0); // pointer to the name in the question
  answer.writeUInt16BE(TYPE_A, 2);
  answer.writeUInt16BE(1, 4); // class IN
  answer.writeUInt32BE(TTL_SECONDS, 6);
  answer.writeUInt16BE(4, 10);
  address.split('.').forEach((octet, index) => answer.writeUInt8(Number(octet), 12 + index));
  return Buffer.concat([header, question.raw, answer]);
}

const socket = dgram.createSocket('udp4');

socket.on('message', async (query, peer) => {
  const question = parseQuestion(query);
  if (!question) return;
  const reply = (buffer: Buffer) => socket.send(buffer, peer.port, peer.address);

  if (question.name !== ZONE && !question.name.endsWith(`.${ZONE}`)) {
    reply(response(query, question, { rcode: 3 })); // NXDOMAIN
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, DELAY_MS + (Math.random() * 2 - 1) * JITTER_MS));
  if (question.type !== TYPE_A) {
    reply(response(query, question, { rcode: 0 })); // no AAAA record
    return;
  }
  // Every name in the zone points at the TaxRate service.
  const { address } = await lookup('taxrate', { family: 4 });
  reply(response(query, question, { rcode: 0, address }));
});

socket.bind(53);
