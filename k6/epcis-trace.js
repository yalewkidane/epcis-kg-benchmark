/**
 * E3 – Traceability query with standard EPCIS queries (EPCIS alone).
 *
 * One test = the breadth-first chain of GET /events calls needed to collect everything
 * about an item through its re-identifications:
 *   1. query the item
 *   2. collect new identifiers it was packed into (parentID) or transformed into
 *      (outputEPCList)
 *   3. query each, repeat until nothing new (bounded by MAX_DEPTH)
 * The test succeeds only if every hop returned 200 and parsed. Distinct events are counted
 * across hops so the answer can be compared with the graph (E4).
 *
 *   k6 run -e IDS=../data/generated/aggregation-depth2/ids.json -e LABEL=depth2 epcis-trace.js
 *
 *   EPCIS_MATCH  comma-separated MATCH_* parameters queried per identifier
 *                (default MATCH_anyEPC; for transformation chains on epcisV2 use
 *                 MATCH_anyEPC,MATCH_inputEPC so events consuming the item are found)
 *   MAX_DEPTH    hop bound (default 6)
 *   PER_PAGE     page size per request (default 100; results beyond it are not fetched)
 */
import { check } from 'k6';
import { baseOptions, sharedJson, pick, eventsOf, epcisGet, record, makeSummary } from './lib/common.js';

const IDS = __ENV.IDS || '../data/generated/aggregation-depth2/ids.json';
const MATCH = (__ENV.EPCIS_MATCH || 'MATCH_anyEPC').split(',').map((s) => s.trim()).filter(Boolean);
const MAX_DEPTH = Number(__ENV.MAX_DEPTH || 6);
const PER_PAGE = Number(__ENV.PER_PAGE || 100);
const ids = sharedJson('ids', () => JSON.parse(open(IDS)));

export const options = baseOptions('epcis_trace_chain');

function newIdentifiers(ev) {
  const out = [];
  if (ev.parentID) out.push(ev.parentID);
  if (Array.isArray(ev.outputEPCList)) out.push(...ev.outputEPCList);
  if (Array.isArray(ev.outputQuantityList)) out.push(...ev.outputQuantityList.map((q) => q.epcClass));
  return out.filter(Boolean);
}

export default function () {
  const root = pick(ids);
  const started = Date.now();
  const visited = new Set([root]);
  const seenEvents = new Set();
  let frontier = [root];
  let hops = 0;
  let requests = 0;
  let ok = true;

  while (frontier.length && hops <= MAX_DEPTH && ok) {
    const next = [];
    for (const id of frontier) {
      for (const param of MATCH) {
        const res = epcisGet({ [param]: JSON.stringify([id]), perPage: PER_PAGE }, { name: `GET /events ${param} hop${hops}` });
        requests++;
        let events = [];
        const good = check(res, {
          'hop status 200': (r) => r.status === 200,
          'hop parsed': (r) => {
            try {
              events = eventsOf(r.json());
              return true;
            } catch (e) {
              return false;
            }
          },
        });
        if (!good) {
          ok = false;
          break;
        }
        for (const ev of events) {
          seenEvents.add(ev.eventID || JSON.stringify(ev));
          for (const nid of newIdentifiers(ev)) {
            if (!visited.has(nid)) {
              visited.add(nid);
              next.push(nid);
            }
          }
        }
      }
      if (!ok) break;
    }
    frontier = next;
    hops++;
  }
  record(ok, Date.now() - started, requests, seenEvents.size);
}

export const handleSummary = makeSummary('E3-epcis-trace', { ids: IDS, match: MATCH, maxDepth: MAX_DEPTH, perPage: PER_PAGE });
