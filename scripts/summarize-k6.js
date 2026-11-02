#!/usr/bin/env node
'use strict';
/**
 * Turn the JSON summaries of one run (results/<RUN>/*.json, written by the k6 scripts)
 * into a Markdown table.
 *
 *   node summarize-k6.js ../results/<RUN> [--csv]
 */
const fs = require('fs');
const path = require('path');

const dir = process.argv[2];
if (!dir || !fs.existsSync(dir)) {
  console.error('usage: node summarize-k6.js <results/RUN> [--csv]');
  process.exit(1);
}
const csv = process.argv.includes('--csv');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
const rows = files.map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));

const f = (x, d = 1) => (x === null || x === undefined || Number.isNaN(Number(x)) ? '-' : Number(x).toFixed(d));
const load = (r) => (r.mode === 'closed' ? `closed, ${r.load.vus} VUs` : `open, ${r.load.rate}/s`);
const header = ['Experiment', 'Label', 'Load', 'Tests', 'TPS', 'MTT ms', 'p50', 'p95', 'p99', 'Error %', 'Req/test', 'Events/test', 'Dropped'];
const line = (r) => [r.name, r.label || '', load(r), r.metrics.tests, f(r.metrics.tps), f(r.metrics.mtt), f(r.metrics.p50), f(r.metrics.p95), f(r.metrics.p99), f((r.metrics.errorRate || 0) * 100, 2), f(r.metrics.requestsPerTest, 2), f(r.metrics.eventsPerTest, 1), r.metrics.droppedIterations || 0];

if (csv) {
  console.log(header.join(','));
  rows.forEach((r) => console.log(line(r).join(',')));
} else {
  console.log(`| ${header.join(' | ')} |`);
  console.log(`|${header.map(() => '---').join('|')}|`);
  rows.forEach((r) => console.log(`| ${line(r).join(' | ')} |`));
  const targets = rows[0] ? rows[0].targets : null;
  if (targets) console.log(`\nTargets: EPCIS ${targets.epcis} · graph ${targets.kg} · duration ${rows[0].duration}`);
}
