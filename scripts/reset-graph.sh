#!/usr/bin/env bash
# Wipe the knowledge graph and reload a known state: the demo scenarios (clothing, tuna, battery, tire)
# and the generated evaluation datasets (so E5 / KgTrace have their identifiers).
#
#   ./reset-graph.sh                 # scenarios + every dataset under ../data/generated
#   ./reset-graph.sh --no-scenarios  # datasets only
#   KG_URL=http://host:7087 ./reset-graph.sh
#
# Run it after every KG-capture run (E4 creates new nodes on purpose) and before the
# query experiments. Needs DEMO_MODE=true on the graph service.
set -euo pipefail
cd "$(dirname "$0")"
KG_URL="${KG_URL:-http://localhost:7087}"
TRACE_SRC="${TRACE_SRC:-../../traceability/src}"
SCENARIOS=true
[[ "${1:-}" == "--no-scenarios" ]] && SCENARIOS=false

health=$(curl -s -m 10 -o /dev/null -w '%{http_code}' "$KG_URL/health" || true)
if [[ "$health" != "200" ]]; then
  echo "graph service not reachable at $KG_URL (GET /health -> ${health:-no answer})." >&2
  echo "Check 'docker compose ps' in traceability/, the TRACEABILITY_PORT in its .env, or set KG_URL=http://host:port" >&2
  exit 1
fi
before=$(curl -s -m 60 "$KG_URL/traceability/stats" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["nodes"]["events"])' 2>/dev/null || echo "unknown")
echo "wiping graph ($before events) ..."
if ! curl -sf -m 600 -X DELETE "$KG_URL/traceability/graph" >/dev/null; then
  echo "DELETE /traceability/graph failed: the service needs DEMO_MODE=true in its .env (restart after changing it)." >&2
  exit 1
fi

if $SCENARIOS && [[ -d "$TRACE_SRC" ]]; then
  for s in clothing tuna battery tire; do
    (cd "$TRACE_SRC" && node scripts/load-scenario.js "$s" --target graph --trace "$KG_URL" >/dev/null && echo "loaded scenario $s")
  done
fi

n=0
for f in ../data/generated/*/documents.json; do
  [[ -f "$f" ]] || continue
  count=$(python3 - "$f" "$KG_URL" <<'EOF'
import json, sys, urllib.request
docs = json.load(open(sys.argv[1])); url = sys.argv[2] + "/traceability/ingest"
for doc in docs:
    urllib.request.urlopen(urllib.request.Request(url, data=json.dumps(doc).encode(), headers={"Content-Type": "application/json"}, method="POST"), timeout=60)
print(len(docs))
EOF
)
  echo "loaded $count documents from $(basename "$(dirname "$f")")"
  n=$((n + count))
done

curl -sf "$KG_URL/traceability/stats" | python3 -c 'import json,sys; d=json.load(sys.stdin); print("graph now:", d["nodes"])'
