# nGrinder experiments

Groovy scripts for the same experiments as the k6 folder, for the closed load model
(virtual users) and distributed agents. nGrinder reports TPS, mean test time and errors;
percentiles and requests-per-test are logged, not charted.

## Setup

```sh
docker run -d --name ngrinder-controller -p 8080:80 -p 16001:16001 -p 12000-12009:12000-12009 ngrinder/controller
# the agent downloads itself from the controller's WEB port as published on the host (8080 here)
docker run -d --name ngrinder-agent --network host ngrinder/agent 127.0.0.1:8080
```

Open http://localhost:8080 (admin / admin). Under *admin → Agent Management* the agent must
be listed and approved (approve it there if its state is "Inactive/Not approved"); only then
does the performance-test form show `Agent Max: 1`. Then create a
script per experiment: *Script → Create a script → Groovy* (not *Groovy (Legacy)*: the
scripts use the 3.5 HTTP client), paste the file from `scripts/` and edit the constants at
the top (`EPCIS_URL`, `KG_URL` are as seen **from the agent**, not from your laptop).

| Experiment | Script | Optional resource | Constants |
|---|---|---|---|
| E1 simple push / E6 | `EpcisCapture.groovy` | `documents.json` | `EPCIS_URL`, `SYNC`, `UNIQUE`, `DOCUMENTS_URL` |
| E2 simple get | `EpcisGet.groovy` | `ids.json` (for `byEpc`) | `EPCIS_URL`, `QUERY` |
| E3 EPCIS traceability chain | `EpcisTrace.groovy` | `ids.json` | `EPCIS_URL`, `MATCH_PARAMS`, `MAX_DEPTH` |
| E4 KG capture | `KgCapture.groovy` | `documents.json` | `KG_URL`, `QUEUE`, `UNIQUE`, `DOCUMENTS_URL` |
| E5 KG query | `KgTrace.groovy` | `ids.json` | `KG_URL`, `DIRECTION`, `DEPTH`, `IDS_URL` |

**Resources.** The scripts look for `./resources/ids.json` / `./resources/documents.json`.
To provide them: in the script list open the folder that holds the script, *Create a
folder* named `resources`, open it and *Upload* the file from
`../data/generated/<kind>-depth<d>/`. nGrinder distributes that folder to the agents with
the script.

When the browser runs on another machine than the data (port forwarding), skip the upload
and serve the generated folder over HTTP on the server instead, then set `IDS_URL` in the
script:

```sh
cd epcis-kg-benchmark/data/generated && python3 -m http.server 8000      # on the server
# in the script: static final String IDS_URL = "http://localhost:8000/aggregation-depth2/ids.json"
```

If neither the file nor `IDS_URL` is present the scripts still run: E2/E3 fetch identifiers from the repository's
`/epcs` list, E5 from the graph's `/traceability/objects`, and E1 / E4 generate one unique
ObjectEvent per test. Use the uploaded `ids.json` whenever the lineage depth must be
controlled (Table I), because `/epcs` mixes items, cases and pallets.

**Validate** on the script page compiles the script and runs one iteration from the
controller; the targets must therefore be reachable from the controller as well. Validation
runs without the `resources` folder, so the capture scripts log `no documents.json` there
and fall back to one synthetic event; the real run distributes the resources. Check the first
lines of the run log for `loaded 30 documents`.

**Capture means new data (`UNIQUE = true`, the default).** `EpcisCapture.groovy` and
`KgCapture.groovy` rewrite every document before sending it: the serial of each SGTIN and
each SSCC gets a token appended that is unique per test and per run, and every eventID
becomes a new UUID. Each test therefore stores new events about new objects, with their
packing relationships, exactly as production captures do. With `UNIQUE = false` the
documents are replayed unchanged: EPCIS stores another copy of the same events, while the
graph only re-merges known events (idempotent MERGE, properties rewritten, nothing created).
That number is re-ingest throughput, not capture, and must be labelled as such.

**Capture grows the stores.** With `UNIQUE = true` a 3-minute run at 1,000 tests/s adds
roughly 1.3 M events (7 per depth-2 document). Reset to the known state between repetitions
and before any query run:

```sh
cd epcis-kg-benchmark/scripts && ./reset-graph.sh      # wipes the graph, reloads the demo scenarios and ../data/generated/*
```

The same applies to `EpcisCapture.groovy` on the EPCIS side: the repository keeps every
captured event; drop the database (`./deploy.sh stop`, delete `DATA_DIR`, `./deploy.sh deploy`)
between repetitions.

## Running a test

Performance Test → Create: pick the script, set agents, virtual users (VUs), duration,
ramp-up. Suggested profile for Table I: 1 agent, 20 → 50 → 100 VUs, 3 minutes each,
30 s ramp-up ignored in the report. Run every cell three times and report the median.

After the run, export the report (*Detailed Report → CSV*) into
`../results/<RUN>/ngrinder-<experiment>-<label>.csv`, and copy the per-test numbers printed
in the agent log (`grinder.logger.info`, requests per test and events per test) into the
result table so the EPCIS chain and the graph can be checked to return the same answer.

## Notes

- A *test* in these scripts is one complete unit of work: for E3 the whole chain of
  `GET /events` calls is wrapped in one `test.record` so TPS and MTT are per chain, not per
  HTTP request.
- Keep the agent on a different machine (or at least different cores) from the systems under
  test when measuring TPS.
- nGrinder's HTTP client is `org.ngrinder.http.HTTPRequest` (nGrinder 3.5). On 3.4 replace it
  with `net.grinder.plugin.http.HTTPRequest` and `NVPair` headers.
