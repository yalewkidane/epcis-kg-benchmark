#!/usr/bin/env node
'use strict';
/**
 * Synthetic EPCIS 2.0 dataset generator for the experiments.
 *
 *   node generate-dataset.js --products 1000 --depth 0|1|2|3 [--kind aggregation|transformation]
 *                            [--out generated] [--prefix 0880002694] [--seed 1]
 *
 * Writes <out>/<kind>-depth<d>/{documents.json, ids.json, manifest.json}:
 *   documents.json  one EPCISDocument per product (for POST /capture, experiment E1)
 *   ids.json        the root item identifier of every product (sampled by E2, E3, E4)
 *
 * Every product is independent (own item, case, pallet, container), so the answer size per depth is
 * constant:
 *   depth 0: commissioning, inspecting, shipping of the item                 (3 events)
 *   depth 1: + packing into a case, shipping of the case                     (5 events)
 *   depth 2: + packing the case onto a pallet, shipping of the pallet        (7 events)
 *   depth 3: + loading the pallet into a container, shipping of the container (9 events)
 * Each level happens at its own location (factory, distribution centre, hub, port).
 * --kind transformation replaces each packing step by a TransformationEvent that creates
 * a new item identifier.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function parseArgs(argv) {
  const a = { products: 100, depth: 2, kind: 'aggregation', out: path.join(__dirname, 'generated'), prefix: '0880002694', seed: 1, start: '2026-01-01T08:00:00Z' };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k.startsWith('--')) a[k.slice(2)] = argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  a.products = Number(a.products);
  a.depth = Number(a.depth);
  a.seed = Number(a.seed);
  if (!['aggregation', 'transformation'].includes(a.kind)) throw new Error('--kind must be aggregation or transformation');
  if (![0, 1, 2, 3].includes(a.depth)) throw new Error('--depth must be 0, 1, 2 or 3');
  return a;
}

const DL = 'https://id.oliot.org';
const CTX = ['https://ref.gs1.org/standards/epcis/2.0.0/epcis-context.jsonld'];
const uuid = (seed) => 'urn:uuid:' + crypto.createHash('sha256').update(seed).digest('hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, '$1-$2-$3-$4-$5');
const pad = (n, w) => String(n).padStart(w, '0');

function build(a) {
  // one location per level: the item is made at the factory, cased at the distribution
  // centre, palletised at the hub, containerised at the port
  const loc = { factory: `${DL}/414/${a.prefix}001`, dc: `${DL}/414/${a.prefix}002`, hub: `${DL}/414/${a.prefix}003`, port: `${DL}/414/${a.prefix}004` };
  const levelLoc = [loc.dc, loc.hub, loc.port];
  const docs = [];
  const ids = [];
  const base = new Date(a.start).getTime();

  for (let i = 0; i < a.products; i++) {
    const n = a.seed * 1000000 + i;
    const item = `${DL}/01/0${a.prefix}100/21/EVAL-${pad(n, 7)}`;
    // level 1 = case, 2 = pallet, 3 = container (SSCC with extension digit 2, 3, 4) or, for
    // transformation chains, a new item identifier per level (GTIN ...200, ...300, ...400)
    const levelId = (l) => a.kind === 'aggregation'
      ? `${DL}/00/0${a.prefix}${l + 1}${pad(n, 7)}`
      : `${DL}/01/0${a.prefix}${l + 1}00/21/EVAL-${pad(n, 7)}-T${l}`;
    let t = base + i * 1000;
    const at = () => {
      t += 3600 * 1000;
      return { eventTime: new Date(t).toISOString(), eventTimeZoneOffset: '+00:00' };
    };
    const ev = (seed, body) => ({ eventID: uuid(`${a.seed}-${i}-${seed}`), ...body, ...at() });
    const observe = (seed, id, step, disp, where) => ev(seed, { type: 'ObjectEvent', action: 'OBSERVE', bizStep: step, disposition: disp, epcList: [id], readPoint: { id: where }, bizLocation: { id: where } });
    const link = (seed, parent, child, where) =>
      a.kind === 'aggregation'
        ? ev(seed, { type: 'AggregationEvent', action: 'ADD', bizStep: 'packing', disposition: 'in_progress', parentID: parent, childEPCs: [child], readPoint: { id: where }, bizLocation: { id: where } })
        : ev(seed, { type: 'TransformationEvent', bizStep: 'commissioning', disposition: 'active', inputEPCList: [child], outputEPCList: [parent], readPoint: { id: where }, bizLocation: { id: where } });

    const events = [
      ev('c', { type: 'ObjectEvent', action: 'ADD', bizStep: 'commissioning', disposition: 'active', epcList: [item], readPoint: { id: loc.factory }, bizLocation: { id: loc.factory } }),
      observe('i', item, 'inspecting', 'active', loc.factory),
      observe('s0', item, 'shipping', 'in_transit', loc.factory),
    ];
    let child = item;
    for (let l = 1; l <= a.depth; l++) {
      const parent = levelId(l);
      events.push(link(`l${l}`, parent, child, levelLoc[l - 1]));
      events.push(observe(`s${l}`, parent, 'shipping', 'in_transit', levelLoc[l - 1]));
      child = parent;
    }
    docs.push({ '@context': CTX, type: 'EPCISDocument', schemaVersion: '2.0', creationDate: events[0].eventTime, epcisBody: { eventList: events } });
    ids.push(item);
  }
  return { docs, ids };
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  const { docs, ids } = build(a);
  const dir = path.join(a.out, `${a.kind}-depth${a.depth}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'documents.json'), JSON.stringify(docs));
  fs.writeFileSync(path.join(dir, 'ids.json'), JSON.stringify(ids));
  const perProduct = docs[0].epcisBody.eventList.length;
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ ...a, eventsPerProduct: perProduct, totalEvents: docs.length * perProduct, generatedAt: new Date().toISOString() }, null, 2));
  console.log(`${dir}: ${docs.length} products × ${perProduct} events = ${docs.length * perProduct} events`);
}

if (require.main === module) main();
module.exports = { build };
