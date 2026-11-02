#!/usr/bin/env bash
# Runs the experiment matrix with k6 and writes results/<RUN>/*.json.
#
#   ./run-all.sh                       # open model, RATE=50, 60 s per cell
#   MODE=closed VUS=50 ./run-all.sh    # closed model like nGrinder
#   ONLY=E3,E5 DEPTHS="0 2" ./run-all.sh
#
# Requires the datasets in ../data/generated (see ../data/README.md) and both systems
# populated with them (run E1 first, or the direct loader for the graph).
set -euo pipefail
cd "$(dirname "$0")"

export RUN="${RUN:-$(date +%Y%m%d-%H%M%S)}"
export MODE="${MODE:-open}" RATE="${RATE:-50}" VUS="${VUS:-50}" DURATION="${DURATION:-60s}"
KIND="${KIND:-aggregation}"
DEPTHS="${DEPTHS:-0 1 2}"
ONLY="${ONLY:-E1,E2,E3,E4,E5}"
K6="${K6:-k6}"            # or: K6="docker run --rm -i --network host -v $PWD/..:/eval -w /eval/k6 grafana/k6"

want() { [[ ",$ONLY," == *",$1,"* ]]; }
mkdir -p "../results/$RUN"
echo "run=$RUN mode=$MODE rate=$RATE vus=$VUS duration=$DURATION kind=$KIND depths=[$DEPTHS]"

if want E1; then
  $K6 run --quiet -e DATA="../data/generated/${KIND}-depth0/documents.json" -e LABEL="${STRATEGY:-nosub}" epcis-capture.js
  $K6 run --quiet -e DATA="../data/generated/${KIND}-depth0/documents.json" -e SYNC=true -e LABEL="${STRATEGY:-nosub}" epcis-capture.js
fi
if want E2; then
  for q in byEpc latest byType; do
    $K6 run --quiet -e QUERY=$q -e IDS="../data/generated/${KIND}-depth0/ids.json" epcis-get.js
  done
fi
if want E4; then
  $K6 run --quiet -e DATA="../data/generated/${KIND}-depth0/documents.json" -e UNIQUE=true kg-capture.js
fi
for d in $DEPTHS; do
  if want E3; then
    MATCH="MATCH_anyEPC"; [[ "$KIND" == "transformation" ]] && MATCH="MATCH_anyEPC,MATCH_inputEPC"
    $K6 run --quiet -e IDS="../data/generated/${KIND}-depth${d}/ids.json" -e EPCIS_MATCH="$MATCH" -e LABEL="${KIND}-depth${d}" epcis-trace.js
  fi
  if want E5; then
    $K6 run --quiet -e IDS="../data/generated/${KIND}-depth${d}/ids.json" -e LABEL="${KIND}-depth${d}" kg-trace.js
  fi
done

echo; node ../scripts/summarize-k6.js "../results/$RUN"
