#!/usr/bin/env bash
# arango-cf-up.sh — deploy ArangoDB as a Cloudflare Container, init collections, fire dispatch
#
# Usage: ! bash scripts/ops/arango-cf-up.sh
#
# What it does:
#   1. Deploys workers/ff-arango (ArangoDB 3.12 in a CF Container DO)
#   2. Generates ARANGO_ROOT_PASSWORD, sets it on ff-arango
#   3. Waits for ArangoDB container to be ready
#   4. Initialises database + collections
#   5. Wires ARANGO_* secrets on ff-pipeline
#   6. Runs first-dispatch.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FF_ARANGO_DIR="$ROOT/workers/ff-arango"
FF_PIPELINE_DIR="$ROOT/workers/ff-pipeline"
FF_BASE="https://ff-pipeline.koales.workers.dev"
ARANGO_BASE="https://ff-arango.koales.workers.dev"
ARANGO_DB="function_factory"

require_command() {
  command -v "$1" >/dev/null 2>&1 || { echo "Missing: $1" >&2; exit 1; }
}
require_command curl
require_command jq
require_command openssl
require_command npx

WRANGLER="$FF_PIPELINE_DIR/node_modules/.bin/wrangler"

put_secret() {
  local dir="$1" key="$2" val="$3"
  printf '%s' "$val" | (cd "$dir" && "$WRANGLER" secret put "$key")
}

ARANGO_PASS="factory-$(openssl rand -hex 16)"
AUTH_B64="$(printf 'root:%s' "$ARANGO_PASS" | base64 | tr -d '\n')"

# ── 1. Deploy ff-arango ──────────────────────────────────────────────────────
echo "=== [1/6] Deploying ff-arango Container ==="
(cd "$FF_ARANGO_DIR" && "$WRANGLER" deploy) 2>&1 | grep -E "Deployed|Current Version|ERROR|error" || true
put_secret "$FF_ARANGO_DIR" ARANGO_ROOT_PASSWORD "$ARANGO_PASS"
echo "  ff-arango deployed. Password set."

# ── 2. Wait for ArangoDB container ──────────────────────────────────────────
echo ""
echo "=== [2/6] Waiting for ArangoDB container (first cold start ~30s) ==="
STATUS=""
for i in $(seq 1 60); do
  STATUS="$(curl -s --max-time 8 -o /dev/null -w "%{http_code}" \
    -H "Authorization: Basic $AUTH_B64" \
    "$ARANGO_BASE/_api/version" 2>/dev/null || echo 000)"
  if [[ "$STATUS" == "200" ]]; then
    echo "  ArangoDB ready."
    break
  fi
  echo "  Waiting... ($i/60, status=$STATUS)"
  sleep 3
done

if [[ "$STATUS" != "200" ]]; then
  echo "ArangoDB did not become ready. Check: curl -H 'Authorization: Basic $AUTH_B64' $ARANGO_BASE/_api/version" >&2
  exit 1
fi

# ── 3. Initialise database + collections ────────────────────────────────────
echo ""
echo "=== [3/6] Initialising database + collections ==="

curl -sf -H "Authorization: Basic $AUTH_B64" \
  -X POST "$ARANGO_BASE/_api/database" \
  -H "Content-Type: application/json" \
  -d "{\"name\": \"$ARANGO_DB\"}" >/dev/null || true

COLLECTIONS=(
  execution_packets
  formulas
  dispatch_log
  verification_reports
  functions
  pressures
  function_proposals
  intent_specifications
  executable_specifications
  lineage_edges
  invariants
  trellis_execution_packets
)

for col in "${COLLECTIONS[@]}"; do
  curl -sf -H "Authorization: Basic $AUTH_B64" \
    -X POST "$ARANGO_BASE/_db/$ARANGO_DB/_api/collection" \
    -H "Content-Type: application/json" \
    -d "{\"name\": \"$col\"}" >/dev/null 2>&1 || true
  echo "  collection: $col"
done
echo "  Database ready."

# ── 4. Wire ff-pipeline secrets ─────────────────────────────────────────────
echo ""
echo "=== [4/6] Wiring ff-pipeline secrets ==="
put_secret "$FF_PIPELINE_DIR" ARANGO_URL      "$ARANGO_BASE"
put_secret "$FF_PIPELINE_DIR" ARANGO_DATABASE "$ARANGO_DB"
put_secret "$FF_PIPELINE_DIR" ARANGO_USERNAME "root"
put_secret "$FF_PIPELINE_DIR" ARANGO_PASSWORD "$ARANGO_PASS"
echo "  Secrets written."

# ── 5. Verify pipeline health ────────────────────────────────────────────────
echo ""
echo "=== [5/6] Verifying pipeline health ==="
echo "  Waiting 10s for secret propagation..."
sleep 10
HEALTH="$(curl -s "$FF_BASE/debug/health")"
echo "  Health: $HEALTH"
ARANGO_OK="$(echo "$HEALTH" | jq -r '.arango // false')"
if [[ "$ARANGO_OK" != "true" ]]; then
  echo "  Pipeline not yet seeing ArangoDB — retrying in 15s..."
  sleep 15
  HEALTH="$(curl -s "$FF_BASE/debug/health")"
  echo "  Health: $HEALTH"
fi

# ── 6. Run first-dispatch ────────────────────────────────────────────────────
echo ""
echo "=== [6/6] Running first-dispatch ==="
bash "$ROOT/scripts/ops/first-dispatch.sh"
