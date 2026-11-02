/**
 * Shared helpers for the k6 experiments. Everything is driven by environment variables so
 * the same script measures any system:
 *
 *   EPCIS_URL   base URL of the EPCIS repository      (default http://localhost:7080/epcis/v2)
 *   KG_URL      base URL of the knowledge graph       (default http://localhost:7087)
 *   MODE        open (constant arrival rate, default) | closed (constant virtual users)
 *   RATE        tests per second in open mode         (default 50)
 *   VUS         virtual users in closed mode / pre-allocated VUs in open mode (default 20 / 50)
 *   MAX_VUS     upper bound of VUs k6 may spawn in open mode (default 500)
 *   DURATION    measurement window                    (default 60s)
 *   RUN         results sub-folder name               (default: timestamp)
 *   LABEL       free text added to the summary (e.g. STRATEGY=mqtt, depth)
 */
import http from 'k6/http';
import { SharedArray } from 'k6/data';
import { Counter, Rate, Trend } from 'k6/metrics';

export const EPCIS_URL = (__ENV.EPCIS_URL || 'http://localhost:7080/epcis/v2').replace(/\/+$/, '');
export const KG_URL = (__ENV.KG_URL || 'http://localhost:7087').replace(/\/+$/, '');
export const MODE = (__ENV.MODE || 'open').toLowerCase();
export const DURATION = __ENV.DURATION || '60s';
export const RUN = __ENV.RUN || new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

export const EPCIS_HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json',
  'GS1-EPCIS-Version': '2.0.0',
  'GS1-EPCIS-Max': '2.0.0',
  'GS1-EPCIS-Min': '2.0.0',
  'GS1-CBV-Version': '2.0.0',
  'GS1-CBV-Max': '2.0.0',
  'GS1-CBV-Min': '2.0.0',
};

// One "test" = one complete unit of client work (a capture, a query, a whole query chain).
export const tests = new Counter('tests');
export const testFailed = new Rate('test_failed');
export const testDuration = new Trend('test_duration', true);
export const requestsPerTest = new Trend('requests_per_test');
export const eventsPerTest = new Trend('events_per_test');

/** k6 `options.scenarios` for the chosen load model. */
export function scenario(name) {
  if (MODE === 'closed') {
    return { [name]: { executor: 'constant-vus', vus: Number(__ENV.VUS || 20), duration: DURATION, gracefulStop: '10s' } };
  }
  return {
    [name]: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.RATE || 50),
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: Number(__ENV.VUS || 50),
      maxVUs: Number(__ENV.MAX_VUS || 500),
      gracefulStop: '10s',
    },
  };
}

export const baseOptions = (name) => ({
  scenarios: scenario(name),
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  thresholds: { test_failed: ['rate<0.01'] },
  discardResponseBodies: false,
});

/**
 * Share a JSON array between VUs (loaded once per test run). The caller passes the loader
 * so that `open()` runs in the main script, whose folder is the base for relative paths.
 */
export function sharedJson(name, loader) {
  return new SharedArray(name, loader);
}

export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/** Distinguishes the identifiers of this k6 run from those of earlier runs. */
const RUN_SALT = String(Math.floor(Date.now() / 1000));

/**
 * Deep copy of an EPCIS document with new identifiers, so a capture creates new objects
 * and events instead of repeating known ones: the serial of every SGTIN (…/21/serial) and
 * every SSCC (…/00/digits) gets a token appended that is unique per iteration and per run,
 * and every eventID becomes a fresh UUID. Locations (…/414/…) stay as they are.
 * Same rule as uniquify() in the nGrinder scripts.
 */
export function uniquify(doc, vu, iteration) {
  const token = `${RUN_SALT}${vu}x${iteration}`;
  const walk = (node) => {
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      const copy = {};
      for (const [k, v] of Object.entries(node)) copy[k] = k === 'eventID' ? `urn:uuid:${uuid()}` : walk(v);
      return copy;
    }
    if (typeof node === 'string') {
      if (node.includes('/21/')) return `${node}-${token}`;
      if (node.includes('/00/')) return `${node}${token}`;
    }
    return node;
  };
  return walk(doc);
}

function uuid() {
  const h = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `${h()}${h()}-${h()}-4${h().slice(1)}-${h()}-${h()}${h()}${h()}`;
}

export function eventsOf(json) {
  const list = json && json.epcisBody && json.epcisBody.queryResults && json.epcisBody.queryResults.resultsBody && json.epcisBody.queryResults.resultsBody.eventList;
  return Array.isArray(list) ? list : [];
}

export function epcisGet(params, tags = {}) {
  const qs = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return http.get(`${EPCIS_URL}/events?${qs}`, { headers: EPCIS_HEADERS, tags, timeout: '60s' });
}

/** Record one finished test. */
export function record(ok, ms, requests, events) {
  tests.add(1);
  testFailed.add(!ok);
  testDuration.add(ms);
  if (requests !== undefined) requestsPerTest.add(requests);
  if (events !== undefined) eventsPerTest.add(events);
}

/** handleSummary factory: writes results/<RUN>/<name>.json and prints a one-line digest. */
export function makeSummary(name, extra = {}) {
  return function handleSummary(data) {
    const m = data.metrics;
    const v = (k, s) => (m[k] && m[k].values && m[k].values[s] !== undefined ? m[k].values[s] : null);
    const summary = {
      name,
      run: RUN,
      at: new Date().toISOString(),
      label: __ENV.LABEL || null,
      mode: MODE,
      load: MODE === 'closed' ? { vus: Number(__ENV.VUS || 20) } : { rate: Number(__ENV.RATE || 50) },
      duration: DURATION,
      targets: { epcis: EPCIS_URL, kg: KG_URL },
      ...extra,
      metrics: {
        tests: v('tests', 'count'),
        tps: v('tests', 'rate'),
        errorRate: v('test_failed', 'rate'),
        mtt: v('test_duration', 'avg'),
        p50: v('test_duration', 'med'),
        p90: v('test_duration', 'p(90)'),
        p95: v('test_duration', 'p(95)'),
        p99: v('test_duration', 'p(99)'),
        max: v('test_duration', 'max'),
        requestsPerTest: v('requests_per_test', 'avg'),
        eventsPerTest: v('events_per_test', 'avg'),
        httpRequests: v('http_reqs', 'count'),
        httpFailedRate: v('http_req_failed', 'rate'),
        droppedIterations: v('dropped_iterations', 'count'),
      },
    };
    const f = (x, d = 1) => (x === null || x === undefined ? '-' : Number(x).toFixed(d));
    const line = `\n${name}${summary.label ? ` [${summary.label}]` : ''}  mode=${MODE}  tests=${summary.metrics.tests}  TPS=${f(summary.metrics.tps)}  MTT=${f(summary.metrics.mtt)}ms  p95=${f(summary.metrics.p95)}ms  p99=${f(summary.metrics.p99)}ms  err=${f((summary.metrics.errorRate || 0) * 100, 2)}%  req/test=${f(summary.metrics.requestsPerTest, 2)}  events/test=${f(summary.metrics.eventsPerTest, 1)}${summary.metrics.droppedIterations ? `  DROPPED=${summary.metrics.droppedIterations} (raise VUS/MAX_VUS or lower RATE)` : ''}\n`;
    const file = `${__ENV.RESULTS || '../results'}/${RUN}/${name}${summary.label ? '-' + String(summary.label).replace(/[^a-z0-9_-]+/gi, '_') : ''}.json`;
    return { stdout: line, [file]: JSON.stringify(summary, null, 2) };
  };
}
