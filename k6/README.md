# k6 experiments

One script per experiment (see `../README.md`, section 1). All scripts share
`lib/common.js`, read their targets and load profile from environment variables, and write a
JSON summary to `../results/<RUN>/`.

## Install

```sh
# Debian/Ubuntu
sudo gpg -k && sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
  --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6

# or without installing (host network so localhost targets work)
docker run --rm -i --network host -v "$PWD/..:/eval" -w /eval/k6 grafana/k6 run epcis-get.js
```

## Common variables

| Variable | Default | Meaning |
|---|---|---|
| `EPCIS_URL` | `http://localhost:7080/epcis/v2` | repository under test |
| `KG_URL` | `http://localhost:7087` | knowledge graph under test |
| `MODE` | `open` | `open` = constant arrival rate, `closed` = constant virtual users |
| `RATE` | `50` | tests/s in open mode |
| `VUS` | `50` / `20` | pre-allocated VUs (open) / virtual users (closed) |
| `MAX_VUS` | `500` | open mode may grow to this many VUs when the system slows down |
| `DURATION` | `60s` | measurement window |
| `RUN` | timestamp | results sub-folder |
| `LABEL` | – | free tag written into the summary and file name (depth, strategy, …) |

If the summary reports `DROPPED=…`, the open model could not keep the arrival rate: raise
`VUS`/`MAX_VUS` or lower `RATE`. Dropped iterations mean the latency numbers are optimistic.

## Scripts

| Experiment | Script | Specific variables |
|---|---|---|
| E1 simple push / E6 strategies | `epcis-capture.js` | `DATA` (documents.json), `SYNC=true` for `POST /events`, `UNIQUE=true` to never repeat an identifier, `LABEL=<strategy>` |
| E2 simple get | `epcis-get.js` | `QUERY=byEpc|latest|byType|byStep`, `IDS`, `PER_PAGE` |
| E3 EPCIS traceability chain | `epcis-trace.js` | `IDS`, `EPCIS_MATCH` (default `MATCH_anyEPC`), `MAX_DEPTH`, `PER_PAGE` |
| E4 KG capture | `kg-capture.js` | `DATA`, `UNIQUE=true`, `QUEUE=true` for the queued path |
| E5 KG query | `kg-trace.js` | `IDS`, `DIRECTION`, `DEPTH`, `ENDPOINT=traceability|graph|timeline` |

Examples:

```sh
cd epcis-kg-benchmark/data && node generate-dataset.js --products 3000 --depth 2 && cd ../k6

# populate both systems through the repository (also E1); wait for the graph to catch up
k6 run -e DATA=../data/generated/aggregation-depth2/documents.json -e MODE=closed -e VUS=10 -e DURATION=5m epcis-capture.js
../scripts/lag.sh

# E3 vs E5 at the same open-model rate
k6 run -e IDS=../data/generated/aggregation-depth2/ids.json -e RATE=100 -e LABEL=depth2 epcis-trace.js
k6 run -e IDS=../data/generated/aggregation-depth2/ids.json -e RATE=100 -e LABEL=depth2 kg-trace.js

# whole matrix
./run-all.sh
node ../scripts/summarize-k6.js ../results/<RUN>
```

## Graph growth

`kg-capture.js` and `epcis-capture.js` with `UNIQUE=true` rewrite every document before
sending it (SGTIN serials and SSCCs get a per-iteration, per-run token; eventIDs become new
UUIDs; same rule as the nGrinder scripts), so every iteration creates new events, objects
and packing relationships. Use it for capture numbers and reset before query experiments:
`../scripts/reset-graph.sh` (wipe + reload scenarios and datasets). Without `UNIQUE` the
same documents are merged again and again, which measures re-ingest, not capture.

## Reading the summary

```
E3-epcis-trace [depth2]  mode=open  tests=5988  TPS=99.8  MTT=41.2ms  p95=88.0ms  p99=140.3ms  err=0.00%  req/test=3.00  events/test=7.0
```

`req/test` and `events/test` are the sanity checks: E3 at depth 2 must need 3 requests and
return the same 7 events E5 returns with 1 request. If `events/test` differs between the
systems, the chain parameters (`EPCIS_MATCH`) or the graph population are wrong; fix that
before reading the latencies.
