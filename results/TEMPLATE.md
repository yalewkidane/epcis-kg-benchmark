# Evaluation run: <name> (<date>)

## Environment

| Component | Version / image | Host | CPU / memory limits |
|---|---|---|---|
| EPCIS repository | | | |
| Knowledge graph service | | | |
| Graph store | | | |
| Load generator | k6 x.y / nGrinder x.y | | |

Dataset: `generated/<kind>-depth<d>` × products, seed, events per product.
Load profile: model (open / closed), rate or VUs, duration, warm-up, repetitions.

## Table I extended: query performance by lineage depth

| Scenario | System | Model | TPS | MTT (ms) | p50 | p95 | p99 | Error % | Req/test |
|---|---|---|---|---|---|---|---|---|---|
| Simple | EPCIS | | | | | | | | 1 |
| Simple | Graph | | | | | | | | 1 |
| One level | EPCIS chain | | | | | | | | 2 |
| One level | Graph | | | | | | | | 1 |
| Two levels | EPCIS chain | | | | | | | | 3 |
| Two levels | Graph | | | | | | | | 1 |

## Capture: EPCIS (E1) vs knowledge graph (E4)

| System | Path | Model | TPS | MTT (ms) | p95 | Error % |
|---|---|---|---|---|---|---|
| EPCIS | POST /capture | | | | | |
| EPCIS | POST /events | | | | | |
| Graph | POST /traceability/ingest | | | | | |
| Graph | POST /traceability/ingest?mode=queue | | | | | |

## Capture throughput by subscription strategy (E6)

| Strategy | TPS | MTT (ms) | p95 | Error % |
|---|---|---|---|---|
| No subscription | | | | |
| MQTT | | | | |
| Webhook | | | | |
| WebSocket | | | | |

## Capture-to-graph lag

| Strategy | Events | mean (ms) | p95 (ms) | max (ms) |
|---|---|---|---|---|
| MQTT | | | | |
| Webhook | | | | |

## Observations

- 
