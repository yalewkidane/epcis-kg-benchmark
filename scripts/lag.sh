#!/usr/bin/env bash
# E6 – capture-to-graph lag: asks the knowledge graph for the distribution of
# (ingestedAt - recordTime) over its events. recordTime is set by the EPCIS repository at
# capture, ingestedAt by the graph service, so the lag covers queue, subscription channel
# (MQTT / webhook / websocket) and graph write. Both are kept from the FIRST time an event
# was seen, so re-capturing the same eventID does not distort the figure.
#
#   ./lag.sh                              # all events
#   ./lag.sh 2026-10-29T10:00:00Z         # events ingested since that time
#   KG_URL=http://host:7087 ./lag.sh
set -euo pipefail
KG_URL="${KG_URL:-http://localhost:7087}"
SINCE="${1:-}"
URL="$KG_URL/traceability/stats/lag"
if [[ -n "$SINCE" ]]; then
  ENC=$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=""))' "$SINCE")
  URL="$URL?since=$ENC"
fi
curl -sf "$URL" | python3 -c '
import json, sys
d = json.load(sys.stdin)
count = d["count"]; missing = d["withoutRecordTime"]
print("events with lag: %s  (without recordTime, not measurable: %s)" % (count, missing))
for k in ("mean", "p50", "p95", "p99", "max", "min"):
    v = d.get(k)
    print("  %5s: %s ms" % (k, "-" if v is None else round(v, 1)))
print("queue:", d.get("queue"))
'
