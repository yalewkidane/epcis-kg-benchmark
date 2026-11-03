# Test data

`generate-dataset.js` produces independent synthetic products at lineage depth 0 to 3,
either as aggregation chains (item → case → pallet → container) or transformation chains
(item → item' → item'' → item'''). See the main README, section 5.

| Depth | Events per product | Chain |
|---|---|---|
| 0 | 3 | commissioning, inspecting, shipping of the item (factory) |
| 1 | 5 | + packing into a case, shipping of the case (distribution centre) |
| 2 | 7 | + packing the case onto a pallet, shipping of the pallet (hub) |
| 3 | 9 | + loading the pallet into a container, shipping of the container (port) |

```sh
node generate-dataset.js --products 2000 --depth 0
node generate-dataset.js --products 2000 --depth 1
node generate-dataset.js --products 2000 --depth 2
node generate-dataset.js --products 2000 --depth 3
node generate-dataset.js --products 2000 --depth 2 --kind transformation
```

Output goes to `generated/<kind>-depth<d>/` (the depth-0, depth-2 and depth-3 reference sets
are committed: 30 products, seed 7):

- `documents.json` — one EPCISDocument per product, ready for `POST /capture`
- `ids.json` — the root item identifier of every product; load scripts sample from it
- `manifest.json` — parameters and counts

Load the data through the repositories with the k6 capture test (`k6/capture.js`) or, to
populate the graph directly without measuring, with the traceability loader:

```sh
# from traceability/src
node -e '
const docs = require("../../epcis-kg-benchmark/data/generated/aggregation-depth2/documents.json");
const { ingestEvents } = require("./graph/ingest");
(async () => { for (const d of docs) await ingestEvents(d, { source: "evaluation", log: { log() {} } }); process.exit(0); })();'
```

Use a different `--seed` for each population run so identifiers never collide with a
previous dataset in the same repository.

A capture test (E1, E4) sends one document per test, so its TPS counts documents of the
chosen depth: a depth-3 document carries 9 events against 7 at depth 2, and the work per
request grows accordingly (about 30 % more events, nodes and relationships). State the depth
next to any capture number, or report events per second as well.
