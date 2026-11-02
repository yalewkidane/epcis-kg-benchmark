# Performance evaluation

A reusable harness for measuring traceability systems. It is organised as **independent
experiments**: the EPCIS 2.0 repository is evaluated on its own (capture, simple queries,
traceability queries), the knowledge graph is evaluated on its own, and only then are the
two compared. Any other system that exposes an EPCIS-style capture/query interface can be
measured with the same scripts by changing a URL.

It reproduces and extends the evaluation in *Building Digital Product Passports: EPCIS 2.0
Meets Knowledge Graphs* (Section IV, Table I, Figs. 6–7).

```
evaluation/
  README.md            methodology, metrics, experiments, procedure
  data/                synthetic dataset generator (products at lineage depth 0, 1, 2)
  k6/                  k6 scripts, one per experiment (open or closed load model)
  ngrinder/            nGrinder scripts, one per experiment (closed model, distributed agents)
  scripts/             helpers: result tables, capture-to-graph lag probe
  results/             raw outputs per run + report template (not versioned)
```

## 1. Experiments

| ID | Name | System | What is exercised | Script (k6 / nGrinder) |
|---|---|---|---|---|
| **E1** | Simple push | EPCIS alone | `POST /capture` with one document per request (`SYNC=true`: `POST /events` with one event) | `epcis-capture.js` / `EpcisCapture.groovy` |
| **E1-max** | Maximal event push | EPCIS alone | `POST /capture` of one generated ObjectEvent with every standard field populated (quantities, business transactions, sources/destinations, two sensor elements with all report forms, ILMD, persistent disposition, certification, extensions; about 5 KB), identifiers never repeat; the worst-case capture cost | `EpcisCaptureMax.groovy` |
| **E2** | Simple get | EPCIS alone | `GET /events` with one parameter: by identifier (`QUERY=byEpc`), latest events (`latest`), by event type (`byType`) | `epcis-get.js` / `EpcisGet.groovy` |
| **E3** | Traceability query | EPCIS alone | the *chain* of `GET /events` calls needed to collect everything about an item through its re-identifications (packing, transformation), at depth 0 / 1 / 2 | `epcis-trace.js` / `EpcisTrace.groovy` |
| **E4** | KG capture | Knowledge graph alone | `POST /traceability/ingest` with one document per request (synchronous graph write; `QUEUE=true` for the queued path) | `kg-capture.js` / `KgCapture.groovy` |
| **E5** | KG query | Knowledge graph alone | one `GET /traceability?id=…` at depth 0 / 1 / 2 | `kg-trace.js` / `KgTrace.groovy` |
| **E6** | Capture under subscription load | EPCIS + graph | E1 repeated with no subscription, MQTT, webhook, websocket | `epcis-capture.js` with `STRATEGY=…` |
| **E7** | Capture-to-graph lag | graph | time from `recordTime` (set by the repository) to ingestion in the graph | `scripts/lag.sh` |

E1–E3 give a complete picture of an EPCIS repository by itself, E4–E5 of the knowledge
graph by itself (E1 vs E4 = capture, E3 vs E5 = traceability query, the paper's Table I).
E6 and E7 are Figs. 6–7 plus the end-to-end delay the paper did not measure.

## 2. Metrics

| Metric | Definition | k6 | nGrinder |
|---|---|---|---|
| **TPS** | successful *tests* per second over the measurement window | `tests` counter rate | TPS |
| **MTT** | mean wall-clock time of one test | `test_duration` avg | Mean Test Time |
| **p50 / p95 / p99** | latency percentiles of a test | `test_duration` | not reported (means only) |
| **Error rate** | failed tests ÷ tests (HTTP ≥ 400, timeout, malformed body, incomplete chain) | `test_failed` | Errors |
| **Requests per test** | HTTP calls one test needed | `requests_per_test` | log |
| **Events per test** | events returned by one test (sanity check that systems return the same answer) | `events_per_test` | log |
| **Capture-to-graph lag** | `ingestedAt − recordTime` per event: count, mean, p50, p95, p99, max | `GET /traceability/stats/lag` | |

A *test* is one complete unit of work from the client's point of view: one capture request
in E1, one query in E2 and E4, the **whole query chain** in E3. Reporting per-request
numbers for E3 would hide the cost of re-identification.

## 3. Load models

- **Closed model** (nGrinder; k6 `MODE=closed`): *N* virtual users loop "send, wait, send".
  Measures the throughput the system sustains for *N* users (the paper's numbers). Latency
  under saturation is biased by coordinated omission.
- **Open model** (k6 `MODE=open`, default): requests arrive at a fixed rate whatever the
  response time, like real clients. Use it to compare *latencies* of two systems at equal
  load, and to find the rate at which each one starts queuing.

Always state the model next to a number. For the EPCIS-vs-graph comparison run both:
closed to extend the published table, open at the same rate for a fair latency comparison.

## 4. The EPCIS traceability baseline (E3)

With standard EPCIS queries, "everything that happened to item X" is a breadth-first chain:

1. `GET /events?MATCH_anyEPC=["X"]`
2. from the results collect the identifiers X was packed into (`parentID`) or transformed
   into (`outputEPCList`) that have not been seen yet
3. query each of them, repeat until no new identifier appears (bounded by `MAX_DEPTH`)

The script counts distinct events across all hops, so E3 and E5 can be checked to return
the same answer. A test fails if any hop fails. Which `MATCH_*` parameter finds the child
side of an aggregation differs between implementations; for `epcisV2` `MATCH_anyEPC`
matches `epcList`, `childEPCs` and `parentID`. Transformation outputs are found with
`MATCH_outputEPC` (set `EPCIS_MATCH=MATCH_anyEPC,MATCH_inputEPC` for transformation chains).

## 5. Test data

`data/generate-dataset.js` creates *N* independent products at depth 0, 1 or 2
(aggregation or transformation chains). Products never share identifiers, so each query
has a constant answer size. See `data/README.md`.

## 6. Procedure

1. **Environment** – record hardware, OS, container limits and component versions in
   `results/<run>/environment.md`. Put the load generator on different cores or a
   different host from the systems under test.
2. **Reset** – fresh MongoDB volume for the repository; `DELETE /traceability/graph`
   (`DEMO_MODE=true`) for the graph; restart services.
3. **Populate** – generate a dataset and capture it (E1 doubles as population). Wait until
   the graph's ingest queue is empty and `stats/lag` counts every event.
4. **Warm up** – 30 s at low rate on every endpoint.
5. **Measure** – each cell 3 × 3 min, same profile for both systems; report the median.
   Capture runs (E1, E4, E6) send *new* data on every test: the scripts rewrite the
   identifiers and eventIDs of each document (`UNIQUE`, on by default in nGrinder, `-e
   UNIQUE=true` in k6), so a test creates new events and objects in both systems. Replaying
   the documents unchanged makes EPCIS store duplicates and makes the graph re-merge known
   events without creating anything; such a number is re-ingest throughput and must be
   labelled so.
6. **Reset between repetitions and between capture and query runs** – E1/E4/E6 grow the
   stores on purpose; `scripts/reset-graph.sh` restores the graph, a fresh `DATA_DIR`
   restores EPCIS.
7. **Collect** – k6 writes one JSON per run into `results/<run>/`; export nGrinder reports;
   `node scripts/summarize-k6.js results/<run>` builds the table.
8. **Report** – fill `results/TEMPLATE.md`.

## 7. Pitfalls observed on the reference setup

Found while validating the harness against `epcisV2` 2.0; check them on any system under
test before trusting a number. (Image 2.1 addresses the first, third and fourth points:
`NO_OF_PROCESSES`, `MONGODB_EVENT_INDEXES` and `ENABLE_LOGS=false` in `.env`. Measured on the
same host with 50 users: `MATCH_anyEPC` went from 720 req/s (1 process, no index) to
1430 (4 processes) to 2170 req/s (4 processes + indexes), Mongo CPU from 4.4 to 1.6 cores.)

- **Process count.** Both servers read `NO_OF_PROCESSES`. With `NO_OF_PROCESSES=1` the EPCIS server is one Node process; every
  DB-backed query capped at about 720–750 req/s on a 12-core host with the process at
  140 % CPU, independent of the query. A trivial `/health` reached 4100 req/s. Scale the
  worker count before measuring and report it.
- **Load generator on the same host.** The nGrinder agent (a JVM with one thread per
  virtual user) measured 480 TPS on the endpoint that k6 measured at 720 TPS from the same
  machine, because it competed for the same CPU. Put the generator elsewhere or pin cores.
- **Missing indexes.** `epcisV2` has no index on `epcList`, `childEPCs`, `parentID` and the
  other identifier fields; `MATCH_anyEPC` scans the collection. Negligible at a few hundred
  events (1 ms), but it grows linearly with the dataset and already cost 1.7 Mongo cores
  at 720 req/s. Decide whether the *implementation as shipped* or an indexed variant is the
  system under test, and say which.
- **Per-request logging.** The query path writes several `console.log` lines per request
  (not controlled by `ENABLE_LOGS`) and re-validates the query schema each time. Both are
  CPU on the measured path.
- **One hot node.** The graph ingest used to end every transaction by updating a single
  bookkeeping node; 50 concurrent writers then serialised on that node's lock
  (113 documents/s). Removing it tripled throughput. Never put a shared counter node in
  the write path of a concurrent ingest.
- **Nagle + delayed ACK.** The Neo4j JavaScript driver does not set `TCP_NODELAY`; every
  Bolt message larger than one MTU (our statements carry the raw event JSON) waited ~40 ms
  for the server's delayed ACK, so a 3-event document took 140 ms regardless of load.
  Setting `TCP_NODELAY` cut it to 9 ms and raised KG capture from 305 to 1,595 documents/s
  at 50 users. Check this on any client library you benchmark with.
- **Compose project drift.** A stack started from one directory and `.env` cannot be
  reconfigured from another copy; find the live project with
  `docker inspect <container> --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}'`.

## 8. Tool choice

| | nGrinder | k6 |
|---|---|---|
| Load model | closed | open and closed |
| Scripting | Groovy / Jython | JavaScript |
| Latency output | mean, TPS graphs | mean, percentiles, thresholds, JSON |
| Multi-step test (E3) | possible, verbose | natural |
| WebSocket / MQTT | no | WebSocket yes, MQTT no |
| Distributed agents | built in | k6 Cloud or manual |

Use nGrinder for continuity with the published tables and distributed load; use k6 for
percentiles, the open model, E3 chains and automation.

## Repository contents and license

The generated reference datasets (`data/generated/aggregation-depth0`, `-depth2`: 30
products each, seed 7) are committed so that published numbers can be reproduced on the
exact same input; `data/generate-dataset.js` recreates or extends them. Results of your own
runs go to `results/<run>/` and are not committed, except the report template.

Licensed under the Apache License 2.0, see [LICENSE](LICENSE). Source of the systems
measured in the reference runs: https://github.com/yalewkidane/epcisV2 (EPCIS 2.0
repository) and the traceability knowledge graph of the same workbench.
