// Generates platform/grafana/dashboards/service-overview.json. Edit here, then run: node scripts/build-dashboard.mjs
import fs from 'node:fs';
const out = new URL('../platform/grafana/dashboards/service-overview.json', import.meta.url);
const PROM = { type: 'prometheus', uid: 'prometheus' };
const PG = { type: 'grafana-postgresql-datasource', uid: 'postgres' };
const EDGE = 'service="api@file"';
let id = 0, y = 0;
const panels = [];
const row = (title) => { panels.push({ type: 'row', title, id: ++id, collapsed: false, gridPos: { h: 1, w: 24, x: 0, y }, panels: [] }); y += 1; };
const ts = (title, description, targets, { w = 12, x = 0, h = 8, unit = 'short', max, min = 0, stack = false, newRow = true } = {}) => {
  panels.push({
    type: 'timeseries', id: ++id, title, description, datasource: PROM,
    gridPos: { h, w, x, y },
    fieldConfig: { defaults: { unit, min, ...(max !== undefined ? { max } : {}), custom: { lineWidth: 1, fillOpacity: stack ? 30 : 8, showPoints: 'never', stacking: { mode: stack ? 'normal' : 'none' } } }, overrides: [] },
    options: { legend: { displayMode: 'list', placement: 'bottom', showLegend: true }, tooltip: { mode: 'multi', sort: 'desc' } },
    targets: targets.map(([expr, legendFormat], i) => ({ datasource: PROM, expr, legendFormat, refId: String.fromCharCode(65 + i) })),
  });
  if (newRow) y += h;
};
const stat = (title, description, expr, { w = 6, x = 0, h = 4, unit = 'short', thresholds } = {}) => {
  panels.push({
    type: 'stat', id: ++id, title, description, datasource: PROM, gridPos: { h, w, x, y },
    fieldConfig: { defaults: { unit, thresholds: { mode: 'absolute', steps: thresholds }, color: { mode: 'thresholds' } }, overrides: [] },
    options: { reduceOptions: { calcs: ['lastNotNull'], fields: '', values: false }, colorMode: 'background', graphMode: 'area', textMode: 'auto' },
    targets: [{ datasource: PROM, expr, refId: 'A' }],
  });
};

row('Customer experience (measured at the edge proxy)');
stat('p95 latency (5m)', 'What 95% of customers experience, measured by Traefik in front of the API.', `histogram_quantile(0.95, sum by (le) (rate(traefik_service_request_duration_seconds_bucket{${EDGE}}[5m])))`, { x: 0, w: 5, unit: 's', thresholds: [{ color: 'green', value: null }, { color: 'orange', value: 0.25 }, { color: 'red', value: 0.5 }] });
stat('Requests per second', 'Traffic reaching the API through the edge proxy.', `sum(rate(traefik_service_requests_total{${EDGE}}[1m]))`, { x: 5, w: 5, unit: 'reqps', thresholds: [{ color: 'blue', value: null }] });
stat('Error rate (5xx, 5m)', 'Share of requests answered with a 5xx status.', `(sum(rate(traefik_service_requests_total{${EDGE},code=~"5.."}[5m])) or vector(0)) / sum(rate(traefik_service_requests_total{${EDGE}}[5m]))`, { x: 10, w: 5, unit: 'percentunit', thresholds: [{ color: 'green', value: null }, { color: 'red', value: 0.01 }] });
stat('API restarts (1h)', 'How many times the API process started in the last hour (deploys included).', 'max(changes(process_start_time_seconds{job="api"}[1h])) or vector(0)', { x: 15, w: 5, thresholds: [{ color: 'green', value: null }, { color: 'orange', value: 2 }, { color: 'red', value: 4 }] });
stat('Firing alerts', 'Prometheus alerts currently firing (see Prometheus → Alerts).', 'count(ALERTS{alertstate="firing"}) or vector(0)', { x: 20, w: 4, thresholds: [{ color: 'green', value: null }, { color: 'red', value: 1 }] });
y += 4;
ts('Latency at the edge', 'Request duration percentiles as seen by Traefik, i.e. by customers.', [
  [`histogram_quantile(0.50, sum by (le) (rate(traefik_service_request_duration_seconds_bucket{${EDGE}}[$__rate_interval])))`, 'p50'],
  [`histogram_quantile(0.95, sum by (le) (rate(traefik_service_request_duration_seconds_bucket{${EDGE}}[$__rate_interval])))`, 'p95'],
  [`histogram_quantile(0.99, sum by (le) (rate(traefik_service_request_duration_seconds_bucket{${EDGE}}[$__rate_interval])))`, 'p99'],
], { unit: 's', newRow: false });
ts('Requests per second by status', 'Traffic at the edge, split by HTTP status code.', [
  [`sum by (code) (rate(traefik_service_requests_total{${EDGE}}[$__rate_interval]))`, '{{code}}'],
], { x: 12, unit: 'reqps', stack: true });

row('Inside the API (measured by the service itself)');
ts('Latency measured by the API (p95 by route)', 'From the moment Express starts handling a request until the response is sent.', [
  ['histogram_quantile(0.95, sum by (le, route) (rate(http_server_request_duration_seconds_bucket{job="api"}[$__rate_interval])))', '{{route}}'],
], { unit: 's', newRow: false });
ts('Requests per second by route', 'Requests handled by the API, by route template.', [
  ['sum by (route) (rate(http_server_request_duration_seconds_count{job="api"}[$__rate_interval]))', '{{route}}'],
], { x: 12, unit: 'reqps', stack: true });
ts('Database query time seen by the API (p95 by query)', 'Measured in the API around each query: from sending it to getting the rows back.', [
  ['histogram_quantile(0.95, sum by (le, query) (rate(db_client_query_duration_seconds_bucket{job="api"}[$__rate_interval])))', '{{query}}'],
], { unit: 's', newRow: false });
ts('Database connection pool', 'Connections held by the pg pool (max 10) and requests waiting for one.', [
  ['db_pool_connections{job="api",state="total"}', 'open'],
  ['db_pool_connections{job="api",state="idle"}', 'idle'],
  ['db_pool_connections{job="api",state="waiting"}', 'waiting'],
], { x: 12 });

row('Node.js runtime');
ts('CPU', 'CPU time used by the API process, in cores. The container is limited to 1 core.', [
  ['rate(process_cpu_seconds_total{job="api"}[$__rate_interval])', 'cpu'],
], { w: 8, unit: 'short', max: 1, newRow: false });
ts('Event loop delay', 'How late the event loop runs scheduled work (perf_hooks.monitorEventLoopDelay), per scrape interval.', [
  ['nodejs_eventloop_lag_max_seconds{job="api"}', 'max'],
  ['nodejs_eventloop_lag_p99_seconds{job="api"}', 'p99'],
  ['nodejs_eventloop_lag_p50_seconds{job="api"}', 'p50'],
], { w: 8, x: 8, unit: 's', newRow: false });
ts('Event loop utilization', 'Share of time the event loop was busy (not idle) between scrapes.', [
  ['nodejs_eventloop_utilization{job="api"}', 'utilization'],
], { w: 8, x: 16, unit: 'percentunit', max: 1 });
ts('Memory', 'V8 heap and process resident memory. The container is limited to 512 MB; the heap limit is where the process crashes.', [
  ['nodejs_heap_size_used_bytes{job="api"}', 'heap used'],
  ['nodejs_heap_used_after_gc_bytes{job="api"}', 'live heap (after full GC)'],
  ['nodejs_heap_size_limit_bytes{job="api"}', 'heap limit'],
  ['process_resident_memory_bytes{job="api"}', 'rss'],
], { unit: 'bytes', newRow: false });
ts('Garbage collection', 'Share of time spent in GC, by kind.', [
  ['sum by (kind) (rate(nodejs_gc_duration_seconds_sum{job="api"}[$__rate_interval]))', '{{kind}}'],
], { x: 12, unit: 'percentunit', stack: true });

row('Database (PostgreSQL)');
panels.push({
  type: 'table', id: ++id, title: 'Top queries by total time (pg_stat_statements)', description: 'Measured inside PostgreSQL, cumulative since the statistics were last reset.', datasource: PG, gridPos: { h: 9, w: 24, x: 0, y },
  targets: [{ datasource: PG, refId: 'A', format: 'table', rawQuery: true, editorMode: 'code', rawSql: "SELECT left(regexp_replace(query, '\\s+', ' ', 'g'), 140) AS query, calls, round(mean_exec_time::numeric, 2) AS \"mean ms\", round(max_exec_time::numeric, 2) AS \"max ms\", round(total_exec_time::numeric) AS \"total ms\", rows FROM pg_stat_statements WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database()) AND query NOT ILIKE '%pg_stat_statements%' ORDER BY total_exec_time DESC LIMIT 10" }],
  options: { showHeader: true, cellHeight: 'sm' }, fieldConfig: { defaults: {}, overrides: [{ matcher: { id: 'byName', options: 'query' }, properties: [{ id: 'custom.width', value: 640 }] }] },
});
y += 9;

row('Dig deeper');
panels.push({
  type: 'text', id: ++id, title: 'Tools', gridPos: { h: 6, w: 24, x: 0, y },
  options: { mode: 'markdown', content: [
    '- **Traces**: [Jaeger](http://localhost:16686/search) (services `traefik` and `shopflow-api`).',
    '- **Profiles**: Drilldown → Profiles, service `shopflow-api` (CPU and wall-clock flame graphs, heap).',
    '- **Logs**: `./lab logs api` (JSON, with `trace_id` on request logs).',
    '- **Database**: `./lab psql`, e.g. `SELECT query, calls, mean_exec_time FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 10;`',
    '- **Node.js inspector**: chrome://inspect → Configure → `127.0.0.1:9229`, then take a CPU profile or heap snapshot.',
  ].join('\n') },
});

const dashboard = {
  uid: 'shopflow-overview', title: 'ShopFlow · Service overview', tags: ['lab', 'shopflow'], timezone: 'browser', editable: true,
  schemaVersion: 41, version: 1, refresh: '10s', time: { from: 'now-15m', to: 'now' }, graphTooltip: 1, liveNow: false,
  annotations: { list: [
    { builtIn: 1, datasource: { type: 'grafana', uid: '-- Grafana --' }, enable: true, hide: true, iconColor: 'rgba(0, 211, 255, 1)', name: 'Annotations & Alerts', type: 'dashboard' },
    { datasource: { type: 'grafana', uid: '-- Grafana --' }, enable: true, hide: false, iconColor: 'orange', name: 'Deploys', target: { limit: 100, matchAny: true, tags: ['deploy', 'lab'], type: 'tags' } },
  ] },
  panels,
};
fs.writeFileSync(out, JSON.stringify(dashboard, null, 2) + '\n');
console.log('panels:', panels.length);
