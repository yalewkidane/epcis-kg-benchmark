/**
 * E2 – Simple get (EPCIS alone): one GET /events per test.
 *
 *   QUERY=byEpc   (default)  GET /events?MATCH_anyEPC=["<id from ids.json>"]
 *   QUERY=latest             GET /events?perPage=10&orderBy=recordTime&orderDirection=DESC
 *   QUERY=byType             GET /events?eventType=["ObjectEvent"]&perPage=10
 *   QUERY=byStep             GET /events?EQ_bizStep=["shipping"]&perPage=10
 *
 *   k6 run -e QUERY=byEpc -e IDS=../data/generated/aggregation-depth0/ids.json epcis-get.js
 */
import { check } from 'k6';
import { baseOptions, sharedJson, pick, eventsOf, epcisGet, record, makeSummary } from './lib/common.js';

const QUERY = __ENV.QUERY || 'byEpc';
const IDS = __ENV.IDS || '../data/generated/aggregation-depth0/ids.json';
const PER_PAGE = Number(__ENV.PER_PAGE || 10);
const ids = QUERY === 'byEpc' ? sharedJson('ids', () => JSON.parse(open(IDS))) : null;

export const options = baseOptions(`epcis_get_${QUERY}`);

function params() {
  switch (QUERY) {
    case 'latest':
      return { perPage: PER_PAGE, orderBy: 'recordTime', orderDirection: 'DESC' };
    case 'byType':
      return { eventType: JSON.stringify([__ENV.EVENT_TYPE || 'ObjectEvent']), perPage: PER_PAGE };
    case 'byStep':
      return { EQ_bizStep: JSON.stringify([__ENV.BIZ_STEP || 'shipping']), perPage: PER_PAGE };
    case 'byEpc':
    default:
      return { MATCH_anyEPC: JSON.stringify([pick(ids)]), perPage: PER_PAGE };
  }
}

export default function () {
  const started = Date.now();
  const res = epcisGet(params(), { name: `GET /events ${QUERY}` });
  let events = [];
  const ok = check(res, {
    'status 200': (r) => r.status === 200,
    'valid EPCISQueryDocument': (r) => {
      try {
        events = eventsOf(r.json());
        return true;
      } catch (e) {
        return false;
      }
    },
  });
  record(ok, Date.now() - started, 1, events.length);
}

export const handleSummary = makeSummary(`E2-epcis-get-${QUERY}`, { query: QUERY, perPage: PER_PAGE, ids: QUERY === 'byEpc' ? IDS : null });
