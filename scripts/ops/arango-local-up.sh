#!/usr/bin/env bash
# arango-local-up.sh — spin up local ArangoDB, tunnel it, wire workers, run dispatch
#
# Usage: ! bash scripts/ops/arango-local-up.sh
#
# What it does:
#   1. Starts ArangoDB in Docker (local port 8529)
#   2. Opens a cloudflared quick tunnel → public HTTPS URL
#   3. Waits for ArangoDB to be ready
#   4. Initialises database collections
#   5. Updates ARANGO_* secrets on ff-pipeline
#   6. Runs first-dispatch.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FF_PIPELINE_DIR="$ROOT/workers/ff-pipeline"
FF_BASE="https://ff-pipeline.koales.workers.dev"

ARANGO_CONTAINER="ff-arango-local"
ARANGO_PORT=8529
ARANGO_PASS="factory-local-$(openssl rand -hex 8)"
ARANGO_DB="function_factory"
TUNNEL_LOG="/tmp/ff-arango-tunnel.log"

require_command() {
  command -v "$1" >/dev/null 2>&1 || { echo "Missing: $1" >&2; exit 1; }
}
require_command docker
require_command cloudflared
require_command curl
require_command jq
require_command npx

put_secret() {
  local key="$1" val="$2"
  printf '%s' "$val" | (cd "$FF_PIPELINE_DIR" && npx wrangler secret put "$key")
}

# ── 1. ArangoDB container ────────────────────────────────────────────────────
echo "=== [1/6] Starting ArangoDB ==="
if docker ps -a --format '{{.Names}}' | grep -q "^${ARANGO_CONTAINER}$"; then
  echo "  Removing old container..."
  docker rm -f "$ARANGO_CONTAINER" >/dev/null 2>&1 || true
fi

docker run -d \
  --name "$ARANGO_CONTAINER" \
  -p "${ARANGO_PORT}:8529" \
  -e ARANGO_ROOT_PASSWORD="$ARANGO_PASS" \
  arangodb/arangodb:3.12 >/dev/null

echo "  Container started."

# ── 2. Cloudflared quick tunnel ──────────────────────────────────────────────
echo ""
echo "=== [2/6] Opening tunnel ==="
cloudflared tunnel --url "http://localhost:${ARANGO_PORT}" \
  --no-autoupdate \
  > "$TUNNEL_LOG" 2>&1 &
TUNNEL_PID=$!
echo "  Tunnel PID: $TUNNEL_PID (log: $TUNNEL_LOG)"

# Wait for trycloudflare URL
TUNNEL_URL=""
for i in $(seq 1 30); do
  TUNNEL_URL="$(grep -oP 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" 2>/dev/null | head -1 || true)"
  [[ -n "$TUNNEL_URL" ]] && break
  sleep 2
done

if [[ -z "$TUNNEL_URL" ]]; then
  echo "Tunnel URL not found after 60s. Log:" >&2
  cat "$TUNNEL_LOG" >&2
  exit 1
fi
echo "  Tunnel URL: $TUNNEL_URL"

# ── 3. Wait for ArangoDB ─────────────────────────────────────────────────────
echo ""
echo "=== [3/6] Waiting for ArangoDB ==="
for i in $(seq 1 40); do
  STATUS="$(curl -s --max-time 3 -o /dev/null -w "%{http_code}" \
    -u "root:${ARANGO_PASS}" \
    "http://localhost:${ARANGO_PORT}/_api/version" 2>/dev/null || echo 000)"
  if [[ "$STATUS" == "200" ]]; then
    echo "  ArangoDB ready."
    break
  fi
  echo "  Waiting... ($i/40, status=$STATUS)"
  sleep 3
done

if [[ "$STATUS" != "200" ]]; then
  echo "ArangoDB did not start in time." >&2
  exit 1
fi

# ── 4. Initialise database + collections ─────────────────────────────────────
echo ""
echo "=== [4/6] Initialising database ==="

# Create database
curl -sf -u "root:${ARANGO_PASS}" \
  -X POST "http://localhost:${ARANGO_PORT}/_api/database" \
  -H "Content-Type: application/json" \
  -d "{\"name\": \"${ARANGO_DB}\"}" >/dev/null || true

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
  curl -sf -u "root:${ARANGO_PASS}" \
    -X POST "http://localhost:${ARANGO_PORT}/_db/${ARANGO_DB}/_api/collection" \
    -H "Content-Type: application/json" \
    -d "{\"name\": \"${col}\"}" >/dev/null 2>&1 || true
  echo "  collection: $col"
done

# Create edge collection for lineage_edges
curl -sf -u "root:${ARANGO_PASS}" \
  -X PUT "http://localhost:${ARANGO_PORT}/_db/${ARANGO_DB}/_api/collection/lineage_edges/properties" \
  -H "Content-Type: application/json" \
  -d '{}' >/dev/null 2>&1 || true

echo "  Database ready."

# ── 5. Update worker secrets ──────────────────────────────────────────────────
echo ""
echo "=== [5/6] Updating ff-pipeline secrets ==="
put_secret ARANGO_URL      "$TUNNEL_URL"
put_secret ARANGO_DATABASE "$ARANGO_DB"
put_secret ARANGO_USERNAME "root"
put_secret ARANGO_PASSWORD "$ARANGO_PASS"

echo "  Secrets written."
echo "  Waiting 5s for propagation..."
sleep 5

# Verify
HEALTH="$(curl -s "$FF_BASE/debug/health")"
ARANGO_OK="$(echo "$HEALTH" | jq -r '.arango')"
echo "  Health: $HEALTH"

if [[ "$ARANGO_OK" != "true" ]]; then
  echo ""
  echo "  ArangoDB still not reachable via worker — may need a moment. Retrying in 10s..."
  sleep 10
  HEALTH="$(curl -s "$FF_BASE/debug/health")"
  ARANGO_OK="$(echo "$HEALTH" | jq -r '.arango')"
  echo "  Health: $HEALTH"
fi

# ── 6. Run first-dispatch ─────────────────────────────────────────────────────
echo ""
echo "=== [6/6] Running first-dispatch ==="
bash "$ROOT/scripts/ops/first-dispatch.sh"

echo ""
echo "Tunnel is running (PID $TUNNEL_PID). Keep this session alive."
echo "URL: $TUNNEL_URL"
echo "To stop: docker rm -f $ARANGO_CONTAINER && kill $TUNNEL_PID"
