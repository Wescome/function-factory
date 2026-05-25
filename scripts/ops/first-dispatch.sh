#!/usr/bin/env bash
# first-dispatch.sh — wire Gas City + fire first live dispatch
#
# Usage: ! bash scripts/ops/first-dispatch.sh
#
# Zero prompts. Generates all tokens, sets all secrets, deploys, dispatches.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FF_PIPELINE_DIR="$ROOT/workers/ff-pipeline"
SUPERVISOR_DIR="/Users/wes/eai/examples/factory/weops-gascity/stage/supervisor"
FF_BASE="https://ff-pipeline.koales.workers.dev"

require_command() {
  command -v "$1" >/dev/null 2>&1 || { echo "Missing: $1" >&2; exit 1; }
}
require_command curl
require_command jq
require_command openssl
require_command npx

# ── 1. Generate all tokens ───────────────────────────────────────────────────
echo "=== [1/4] Generating tokens ==="
GC_BEARER_TOKEN="$(openssl rand -hex 32)"
OPERATOR_TOKEN="$(openssl rand -hex 32)"

echo "  Setting GC_SUPERVISOR_TOKEN on gascity-supervisor..."
printf '%s' "$GC_BEARER_TOKEN" | (cd "$SUPERVISOR_DIR" && npx wrangler secret put GC_SUPERVISOR_TOKEN)

echo "  Setting GAS_CITY_BEARER_TOKEN on ff-pipeline..."
printf '%s' "$GC_BEARER_TOKEN" | (cd "$FF_PIPELINE_DIR" && npx wrangler secret put GAS_CITY_BEARER_TOKEN)

echo "  Setting OPERATOR_CONTROL_TOKEN on ff-pipeline..."
printf '%s' "$OPERATOR_TOKEN" | (cd "$FF_PIPELINE_DIR" && npx wrangler secret put OPERATOR_CONTROL_TOKEN)

# ── 2. Deploy ff-pipeline ────────────────────────────────────────────────────
echo ""
echo "=== [2/4] Deploying ff-pipeline with Gas City vars ==="
(cd "$FF_PIPELINE_DIR" && npx wrangler deploy) 2>&1 | grep -E "Deployed|Current Version|ERROR|error" || true

# Brief pause for worker propagation
sleep 3

# ── 3. Seed EP ───────────────────────────────────────────────────────────────
echo ""
echo "=== [3/4] Seeding dispatch EP ==="
SEED_RESP="$(curl -sf -X POST "$FF_BASE/seed-dispatch-ep" \
  -H "Authorization: Bearer $OPERATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "fnId": "FN-GC-DISPATCH-WIRE",
    "isId": "IS-GC-DISPATCH-WIRE",
    "esId": "ES-GC-DISPATCH-WIRE",
    "task": "Wire POST /dispatch-formula to Gas City 3-call HTTP sequence per IS-GC-DISPATCH-WIRE."
  }')"
echo "$SEED_RESP" | jq .
EP_ID="$(echo "$SEED_RESP" | jq -r '.epId')"
echo "  epId: $EP_ID"

# ── 4. Dispatch ───────────────────────────────────────────────────────────────
echo ""
echo "=== [4/4] Dispatching to Gas City ==="
DISPATCH_RESP="$(curl -sf -X POST "$FF_BASE/dispatch-formula" \
  -H "Authorization: Bearer $OPERATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"epId\": \"$EP_ID\", \"factoryAttempt\": 1}")"
echo "$DISPATCH_RESP" | jq .

GC_BEAD_ID="$(echo "$DISPATCH_RESP" | jq -r '.gc_bead_id // empty')"
OUTCOME="$(echo "$DISPATCH_RESP" | jq -r '.outcome // empty')"

echo ""
echo "=== Result ==="
echo "  outcome:    $OUTCOME"
echo "  gc_bead_id: ${GC_BEAD_ID:-<none>}"

if [[ "$OUTCOME" == "dispatched" && -n "$GC_BEAD_ID" ]]; then
  echo ""
  echo "SUCCESS — bead is live in Gas City."
  echo "Monitor: https://gascity-supervisor.koales.workers.dev/v0/city/factory/beads/$GC_BEAD_ID"
else
  echo ""
  echo "Dispatch did not complete — check outcome above."
  exit 1
fi
