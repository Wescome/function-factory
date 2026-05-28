#!/usr/bin/env bash
# first-dispatch.sh — wire Gas City + fire first live dispatch and roadmap smoke
#
# Usage: ! bash scripts/ops/first-dispatch.sh
#
# Zero prompts. Generates all tokens, sets all secrets, deploys, dispatches,
# exercises the RELEASE webhook bridge, and runs the Cloudflare autonomy monitor.

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

CURL_RETRY=(curl --http1.1 --retry 5 --retry-delay 2 --retry-all-errors --connect-timeout 10 --max-time 120 -sf)

# ── 1. Generate all tokens ───────────────────────────────────────────────────
echo "=== [1/6] Generating tokens ==="
GC_BEARER_TOKEN="$(openssl rand -hex 32)"
OPERATOR_TOKEN="$(openssl rand -hex 32)"
GC_HMAC_SECRET="$(openssl rand -hex 32)"

echo "  Setting GC_SUPERVISOR_TOKEN on gascity-supervisor..."
printf '%s' "$GC_BEARER_TOKEN" | (cd "$SUPERVISOR_DIR" && npx wrangler secret put GC_SUPERVISOR_TOKEN)

echo "  Setting GAS_CITY_BEARER_TOKEN on ff-pipeline..."
printf '%s' "$GC_BEARER_TOKEN" | (cd "$FF_PIPELINE_DIR" && npx wrangler secret put GAS_CITY_BEARER_TOKEN)

echo "  Setting GAS_CITY_HMAC_SECRET on gascity-supervisor..."
printf '%s' "$GC_HMAC_SECRET" | (cd "$SUPERVISOR_DIR" && npx wrangler secret put GAS_CITY_HMAC_SECRET)

echo "  Setting GAS_CITY_HMAC_SECRET_V1 on ff-pipeline..."
printf '%s' "$GC_HMAC_SECRET" | (cd "$FF_PIPELINE_DIR" && npx wrangler secret put GAS_CITY_HMAC_SECRET_V1)

echo "  Setting OPERATOR_CONTROL_TOKEN on ff-pipeline..."
printf '%s' "$OPERATOR_TOKEN" | (cd "$FF_PIPELINE_DIR" && npx wrangler secret put OPERATOR_CONTROL_TOKEN)

# ── 2. Deploy ff-pipeline ────────────────────────────────────────────────────
echo ""
echo "=== [2/6] Deploying ff-pipeline with Gas City vars ==="
DEPLOY_LOG="$(mktemp)"
if ! (cd "$FF_PIPELINE_DIR" && npx wrangler deploy >"$DEPLOY_LOG" 2>&1); then
  cat "$DEPLOY_LOG"
  rm -f "$DEPLOY_LOG"
  echo "Deploy failed."
  exit 1
fi
grep -E "Deployed|Current Version|ERROR|error" "$DEPLOY_LOG" || cat "$DEPLOY_LOG"
rm -f "$DEPLOY_LOG"

# Brief pause for Worker propagation after version/secret changes.
sleep 10

# ── 3. Seed EP ───────────────────────────────────────────────────────────────
echo ""
echo "=== [3/6] Seeding dispatch EP ==="
SEED_RESP="$("${CURL_RETRY[@]}" -X POST "$FF_BASE/seed-dispatch-ep" \
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
echo "=== [4/6] Dispatching to Gas City ==="
DISPATCH_RESP="$("${CURL_RETRY[@]}" -X POST "$FF_BASE/dispatch-formula" \
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

# ── 5. Exercise RELEASE webhook bridge ──────────────────────────────────────
echo ""
echo "=== [5/6] Exercising Factory webhook RELEASE bridge ==="
FORM_ID="$(echo "$DISPATCH_RESP" | jq -r '.form_id')"
CALLBACK_PAYLOAD="$(jq -cn \
  --arg fn_id "FN-GC-DISPATCH-WIRE" \
  --arg is_id "IS-GC-DISPATCH-WIRE" \
  --arg es_id "ES-GC-DISPATCH-WIRE" \
  --arg ep_id "$EP_ID" \
  --arg form_id "$FORM_ID" \
  --arg bead_id "$GC_BEAD_ID" \
  --arg outcome "approved" \
  --argjson factory_attempt 1 \
  '{fn_id:$fn_id,is_id:$is_id,es_id:$es_id,ep_id:$ep_id,form_id:$form_id,factory_attempt:$factory_attempt,bead_id:$bead_id,outcome:$outcome}')"
CALLBACK_SIGNATURE="$(printf '%s' "$CALLBACK_PAYLOAD" | openssl dgst -sha256 -hmac "$GC_HMAC_SECRET" | awk '{print $2}')"
CALLBACK_RESP="$("${CURL_RETRY[@]}" -X POST "$FF_BASE/webhooks/gascity" \
  -H "Content-Type: application/json" \
  -H "X-GC-Key-ID: v1" \
  -H "X-GC-Signature: sha256=$CALLBACK_SIGNATURE" \
  -d "$CALLBACK_PAYLOAD")"
echo "$CALLBACK_RESP" | jq .

# ── 6. Run Cloudflare autonomy monitor ──────────────────────────────────────
echo ""
echo "=== [6/6] Running Cloudflare autonomy monitor ==="
if AUTONOMY_RESP="$("${CURL_RETRY[@]}" -X POST "$FF_BASE/gascity/autonomy/run" \
  -H "Authorization: Bearer $OPERATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"trigger":"smoke"}')"; then
  echo "$AUTONOMY_RESP" | jq .
else
  echo "Autonomy run request timed out or failed; fetching status directly."
fi

echo ""
echo "=== Autonomy status ==="
AUTONOMY_STATUS="$("${CURL_RETRY[@]}" "$FF_BASE/gascity/autonomy/status")"
echo "$AUTONOMY_STATUS" | jq .
if [[ "$(echo "$AUTONOMY_STATUS" | jq -r '.ok // "false"')" != "true" ]]; then
  echo "Autonomy status did not report ok=true."
  exit 1
fi
