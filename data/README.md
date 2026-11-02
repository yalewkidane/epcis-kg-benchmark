# Test data

`generate-dataset.js` produces independent synthetic products at lineage depth 0, 1 or 2,
either as aggregation chains (item → case → pallet) or transformation chains
(item → item' → item''). See the main README, section 3.

```sh
node generate-dataset.js --products 2000 --depth 0
node generate-dataset.js --products 2000 --depth 1
node generate-dataset.js --products 2000 --depth 2
node generate-dataset.js --products 2000 --depth 2 --kind transformation
```

Output goes to `generated/<kind>-depth<d>/` (git-ignored):

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
