/**
 * E4 – KG capture (knowledge graph alone).
 *
 * Each test posts one EPCIS document from the dataset to POST /traceability/ingest, the
 * synchronous write path of the graph (success = 201 with {ingested}). With QUEUE=true the
 * document goes through the ingest queue instead (?mode=queue, success = 202), which is
 * the path subscriptions use; measure the resulting backlog with ../scripts/lag.sh.
 *
 *   k6 run -e DATA=../data/generated/aggregation-depth0/documents.json kg-capture.js
 *   k6 run -e UNIQUE=true -e MODE=closed -e VUS=50 kg-capture.js
 *
 * UNIQUE=true rewrites identifiers and eventIDs per iteration so every capture creates new
 * nodes; without it, repeated documents are merged (idempotent) and measure re-ingest.
 */
import http from 'k6/http';
import { check } from 'k6';
import { KG_URL, baseOptions, sharedJson, record, makeSummary, uniquify } from './lib/common.js';

const DATA = __ENV.DATA || '../data/generated/aggregation-depth0/documents.json';
const QUEUE = (__ENV.QUEUE || 'false').toLowerCase() === 'true';
const UNIQUE = (__ENV.UNIQUE || 'false').toLowerCase() === 'true';
const docs = sharedJson('documents', () => JSON.parse(open(DATA)));

export const options = baseOptions(QUEUE ? 'kg_capture_queue' : 'kg_capture_direct');

let counter = 0;

export default function () {
  const index = (__VU * 1000003 + counter++) % docs.length;
  let doc = docs[index];
  if (UNIQUE) doc = uniquify(doc, __VU, counter);

  const started = Date.now();
  const res = http.post(`${KG_URL}/traceability/ingest${QUEUE ? '?mode=queue' : ''}`, JSON.stringify(doc), { headers: { 'Content-Type': 'application/json' }, tags: { name: QUEUE ? 'POST /ingest?mode=queue' : 'POST /ingest' }, timeout: '60s' });
  const ok = check(res, { 'ingest accepted': (r) => (QUEUE ? r.status === 202 : r.status === 201) });
  record(ok, Date.now() - started, 1, doc.epcisBody.eventList.length);
}

export const handleSummary = makeSummary(QUEUE ? 'E4-kg-capture-queue' : 'E4-kg-capture-direct', { dataset: DATA, queue: QUEUE, unique: UNIQUE });
