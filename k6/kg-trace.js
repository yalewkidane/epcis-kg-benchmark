/**
 * E5 – KG query: traceability query on the knowledge graph (graph alone).
 *
 * One test = one GET /traceability?id=<item>&direction=<forward|backward|both>&depth=<n>.
 *
 *   k6 run -e IDS=../data/generated/aggregation-depth2/ids.json -e LABEL=depth2 kg-trace.js
 *
 *   DIRECTION   forward (default; matches the EPCIS chain of E3), backward, both
 *   DEPTH       traversal bound (default 10)
 *   ENDPOINT    traceability (events, default) | graph (nodes+links) | timeline
 */
import http from 'k6/http';
import { check } from 'k6';
import { KG_URL, baseOptions, sharedJson, pick, record, makeSummary } from './lib/common.js';

const IDS = __ENV.IDS || '../data/generated/aggregation-depth2/ids.json';
const DIRECTION = __ENV.DIRECTION || 'forward';
const DEPTH = Number(__ENV.DEPTH || 10);
const ENDPOINT = __ENV.ENDPOINT || 'traceability';
const ids = sharedJson('ids', () => JSON.parse(open(IDS)));

export const options = baseOptions(`kg_trace_${ENDPOINT}`);

const path = ENDPOINT === 'traceability' ? '/traceability' : `/traceability/${ENDPOINT}`;

export default function () {
  const id = pick(ids);
  const started = Date.now();
  const res = http.get(`${KG_URL}${path}?id=${encodeURIComponent(id)}&direction=${DIRECTION}&depth=${DEPTH}`, { headers: { Accept: 'application/json' }, tags: { name: `GET ${path}` }, timeout: '60s' });
  let events = 0;
  const ok = check(res, {
    'status 200': (r) => r.status === 200,
    'has summary': (r) => {
      try {
        const j = r.json();
        events = j.summary ? j.summary.eventCount : Array.isArray(j.events) ? j.events.length : 0;
        return !!j.summary;
      } catch (e) {
        return false;
      }
    },
  });
  record(ok, Date.now() - started, 1, events);
}

export const handleSummary = makeSummary(`E5-kg-trace-${ENDPOINT}`, { ids: IDS, direction: DIRECTION, depth: DEPTH });
