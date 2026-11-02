/**
 * E1 – Simple push (EPCIS alone) and E5 – capture under subscription load.
 *
 * Each test posts one EPCIS document from the dataset to POST /capture (asynchronous
 * capture interface, success = 202). With SYNC=true the first event of the document is
 * posted to POST /events instead (synchronous single-event capture, success = 2xx).
 *
 *   k6 run -e DATA=../data/generated/aggregation-depth0/documents.json epcis-capture.js
 *   k6 run -e SYNC=true -e MODE=closed -e VUS=50 epcis-capture.js
 *   k6 run -e LABEL=mqtt ... epcis-capture.js          # E5: tag the subscription strategy
 *
 * Identifier collisions: a document is captured once per iteration index; after the
 * dataset is exhausted documents repeat (the repository stores duplicates as new events
 * unless it de-duplicates on eventID). Use a dataset larger than RATE × DURATION, or set
 * UNIQUE=true to rewrite eventIDs and serials per iteration so every capture is new.
 */
import http from 'k6/http';
import { check } from 'k6';
import { EPCIS_URL, EPCIS_HEADERS, baseOptions, sharedJson, record, makeSummary, uniquify } from './lib/common.js';

const DATA = __ENV.DATA || '../data/generated/aggregation-depth0/documents.json';
const SYNC = (__ENV.SYNC || 'false').toLowerCase() === 'true';
const UNIQUE = (__ENV.UNIQUE || 'false').toLowerCase() === 'true';
const docs = sharedJson('documents', () => JSON.parse(open(DATA)));

export const options = baseOptions(SYNC ? 'epcis_capture_event' : 'epcis_capture_document');

let counter = 0;

export default function () {
  const index = (__VU * 1000003 + counter++) % docs.length;
  let doc = docs[index];
  if (UNIQUE) doc = uniquify(doc, __VU, counter);

  const started = Date.now();
  let res;
  if (SYNC) {
    // POST /events takes one event; the validator requires the document's @context on it
    const event = { '@context': doc['@context'], ...doc.epcisBody.eventList[0] };
    res = http.post(`${EPCIS_URL}/events`, JSON.stringify(event), { headers: EPCIS_HEADERS, tags: { name: 'POST /events' }, timeout: '60s' });
  } else {
    res = http.post(`${EPCIS_URL}/capture`, JSON.stringify(doc), { headers: EPCIS_HEADERS, tags: { name: 'POST /capture' }, timeout: '60s' });
  }
  const ok = check(res, { 'capture accepted': (r) => r.status >= 200 && r.status < 300 });
  record(ok, Date.now() - started, 1, doc.epcisBody.eventList.length);
}

export const handleSummary = makeSummary(SYNC ? 'E1-epcis-capture-event' : 'E1-epcis-capture-document', { dataset: DATA, sync: SYNC, unique: UNIQUE });
