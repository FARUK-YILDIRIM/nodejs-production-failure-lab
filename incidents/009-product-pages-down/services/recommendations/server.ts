// Recommendations: the data team's "Customers also bought" service. Students don't own it.
//
// Like most model servers, it runs a fixed number of workers, and requests beyond
// that wait in a queue for one. Products with a precomputed vector are answered in
// milliseconds. Since model v7, products the nightly batch couldn't compute a
// vector for are computed on the fly, which takes seconds. A request stops using
// its worker as soon as its client goes away.
import http from 'node:http';

const PORT = Number(process.env.PORT ?? 8100);
const METRICS_PORT = Number(process.env.METRICS_PORT ?? 9464);
const MODEL = process.env.MODEL ?? 'v7';
const WORKERS = Number(process.env.WORKERS ?? 8);
const PRODUCTS = Number(process.env.PRODUCTS ?? 20_000);
/** Share of products without a precomputed vector. */
const MISSING_VECTORS = Number(process.env.MISSING_VECTORS ?? 0.1);
const WARM_MS = { min: 5, max: 30 };
const COLD_MS = { min: Number(process.env.COLD_MIN_MS ?? 8_000), max: Number(process.env.COLD_MAX_MS ?? 20_000) };

const between = ({ min, max }: { min: number; max: number }) => min + Math.random() * (max - min);
const log = (msg: string, fields: Record<string, unknown>) =>
  console.log(JSON.stringify({ level: 'info', time: new Date().toISOString(), service: 'recommendations', model: MODEL, msg, ...fields }));

/** Products whose vector the batch job failed to compute: a stable pseudo-random subset. */
const hasVector = (productId: number) => (Math.imul(productId, 2654435761) >>> 0) / 2 ** 32 >= MISSING_VECTORS;

function recommend(productId: number, limit: number): { productId: number; score: number }[] {
  const items: { productId: number; score: number }[] = [];
  for (let k = 1; items.length < limit && k <= 2 * limit; k++) {
    const candidate = ((productId * 7919 + k * 104_729) % PRODUCTS) + 1;
    if (candidate === productId || items.some((item) => item.productId === candidate)) continue;
    items.push({ productId: candidate, score: Number((0.97 - items.length * 0.04).toFixed(2)) });
  }
  return items;
}

// --- Workers ---------------------------------------------------------------

let busy = 0;
const queue: (() => void)[] = [];

/** Waits for a free worker; resolves with the function that frees it. */
function acquireWorker(signal: AbortSignal): Promise<() => void> {
  return new Promise((resolve, reject) => {
    const take = () => {
      busy += 1;
      let released = false;
      resolve(() => {
        if (released) return;
        released = true;
        busy -= 1;
        queue.shift()?.();
      });
    };
    if (busy < WORKERS) return take();

    const turn = () => {
      signal.removeEventListener('abort', leave);
      take();
    };
    const leave = () => {
      const index = queue.indexOf(turn);
      if (index >= 0) queue.splice(index, 1);
      reject(new Error('client went away while waiting for a worker'));
    };
    queue.push(turn);
    signal.addEventListener('abort', leave, { once: true });
  });
}

function compute(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new Error('client went away while computing'));
      },
      { once: true },
    );
  });
}

// --- Metrics ---------------------------------------------------------------

const BUCKETS = [0.005, 0.01, 0.025, 0.04, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30];
const outcomes = new Map<string, number>();

function histogram() {
  return { buckets: BUCKETS.map(() => 0), count: 0, sum: 0 };
}
const requestDuration = histogram();
const inferenceDuration = histogram();

function observe(target: ReturnType<typeof histogram>, seconds: number): void {
  target.count += 1;
  target.sum += seconds;
  BUCKETS.forEach((bound, index) => {
    if (seconds <= bound) target.buckets[index] = (target.buckets[index] ?? 0) + 1;
  });
}

function histogramLines(name: string, help: string, target: ReturnType<typeof histogram>): string[] {
  return [
    `# HELP ${name} ${help}`,
    `# TYPE ${name} histogram`,
    ...BUCKETS.map((bound, index) => `${name}_bucket{le="${bound}"} ${target.buckets[index]}`),
    `${name}_bucket{le="+Inf"} ${target.count}`,
    `${name}_sum ${target.sum}`,
    `${name}_count ${target.count}`,
  ];
}

// --- HTTP --------------------------------------------------------------------

const json = (res: http.ServerResponse, status: number, body: unknown) =>
  res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));

http
  .createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://recommendations');
    if (url.pathname === '/health') return json(res, 200, { status: 'ok', model: MODEL });

    // GET /v1/products/:id/recommendations?limit=4
    const match = /^\/v1\/products\/(\d+)\/recommendations$/.exec(url.pathname);
    if (req.method !== 'GET' || !match) return json(res, 404, { error: 'not_found' });
    const productId = Number(match[1]);
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 4) || 4, 1), 20);
    if (productId < 1 || productId > PRODUCTS) return json(res, 404, { error: 'unknown_product' });

    const startedAt = performance.now();
    const clientGone = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) clientGone.abort();
    });

    let stage = 'waiting';
    let release: (() => void) | undefined;
    try {
      release = await acquireWorker(clientGone.signal);
      stage = 'computing';
      const inferenceStartedAt = performance.now();
      if (hasVector(productId)) {
        await compute(between(WARM_MS), clientGone.signal);
      } else {
        log('no precomputed vector for this product, computing it now', { productId });
        await compute(between(COLD_MS), clientGone.signal);
      }
      observe(inferenceDuration, (performance.now() - inferenceStartedAt) / 1000);
      observe(requestDuration, (performance.now() - startedAt) / 1000);
      outcomes.set('ok', (outcomes.get('ok') ?? 0) + 1);
      json(res, 200, { productId, model: MODEL, items: recommend(productId, limit) });
    } catch {
      const outcome = `cancelled_while_${stage}`;
      outcomes.set(outcome, (outcomes.get(outcome) ?? 0) + 1);
      if (stage === 'computing') {
        log('client went away, stopped computing', { productId, afterMs: Math.round(performance.now() - startedAt) });
      }
    } finally {
      release?.();
    }
  })
  .listen(PORT);

http
  .createServer((req, res) => {
    if (req.url !== '/metrics') return res.writeHead(404).end();
    const lines = [
      '# HELP recs_requests_total Recommendation requests, by outcome (ok, or cancelled because the client went away).',
      '# TYPE recs_requests_total counter',
      ...[...outcomes].map(([outcome, count]) => `recs_requests_total{outcome="${outcome}"} ${count}`),
      ...histogramLines(
        'recs_request_duration_seconds',
        'Time to answer a recommendation request, from arrival to response (answered requests only).',
        requestDuration,
      ),
      ...histogramLines('recs_inference_duration_seconds', 'Model inference time per answered request.', inferenceDuration),
      '# HELP recs_workers Inference workers.',
      '# TYPE recs_workers gauge',
      `recs_workers ${WORKERS}`,
      '# HELP recs_workers_busy Workers currently computing a recommendation.',
      '# TYPE recs_workers_busy gauge',
      `recs_workers_busy ${busy}`,
      '# HELP recs_queue_length Requests waiting for a free worker.',
      '# TYPE recs_queue_length gauge',
      `recs_queue_length ${queue.length}`,
    ];
    res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' }).end(`${lines.join('\n')}\n`);
  })
  .listen(METRICS_PORT);
