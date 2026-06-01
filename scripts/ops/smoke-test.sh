#!/usr/bin/env bash
# smoke-test.sh — fast E2E smoke test. No token rotation. No deploy.
# Reads OPERATOR_TOKEN and GC_HMAC_SECRET from env or /tmp files written by first-dispatch.sh.
#
# Usage: ! bash scripts/ops/smoke-test.sh

set -euo pipefail

FF_BASE="https://ff-pipeline.koales.workers.dev"
GC_BASE="https://gascity-supervisor.koales.workers.dev"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

require_command() { command -v "$1" >/dev/null 2>&1 || { echo "Missing: $1" >&2; exit 1; }; }
require_command curl; require_command jq; require_command openssl

# ── Resolve tokens ────────────────────────────────────────────────────────────
OPERATOR_TOKEN="${OPERATOR_TOKEN:-}"
GC_HMAC_SECRET="${GC_HMAC_SECRET:-}"
GC_BEARER_TOKEN="${GC_BEARER_TOKEN:-}"

[[ -z "$OPERATOR_TOKEN"   && -f /tmp/gc_token.txt         ]] && OPERATOR_TOKEN="$(cat /tmp/gc_token.txt)"
[[ -z "$GC_BEARER_TOKEN"  && -f /tmp/gc_supervisor_token.txt ]] && GC_BEARER_TOKEN="$(cat /tmp/gc_supervisor_token.txt)"

if [[ -z "$OPERATOR_TOKEN" || -z "$GC_BEARER_TOKEN" ]]; then
  echo "ERROR: tokens not found. Run first-dispatch.sh first, or export OPERATOR_TOKEN and GC_BEARER_TOKEN." >&2
  exit 1
fi

# GC_HMAC_SECRET can't be read back from CF — must be exported or passed via env.
# If missing, the webhook bridge step is skipped with a warning.

CURL_RETRY=(curl --http1.1 --retry 3 --retry-delay 3 --retry-all-errors --connect-timeout 10 --max-time 60 -sf)

echo "=== [1/5] Checking city readiness ==="
for i in $(seq 1 40); do
  CITY_ITEM=$(curl --http1.1 --connect-timeout 5 --max-time 15 -s \
    -H "Authorization: Bearer $GC_BEARER_TOKEN" \
    "$GC_BASE/v0/cities" 2>/dev/null | jq -c '.items[]? | select(.name=="factory")' || true)
  CITY_DISPATCH_READY=$(printf '%s' "$CITY_ITEM" | jq -r '.dispatch_ready // false' 2>/dev/null || echo "false")
  CITY_STATUS=$(printf '%s' "$CITY_ITEM" | jq -r '.status // ""' 2>/dev/null || echo "")
  if [[ "$CITY_DISPATCH_READY" == "true" || "$CITY_STATUS" == "running_degraded" ]]; then
    echo "  City ready (attempt $i, status=$CITY_STATUS)"
    break
  fi
  if [[ "$CITY_STATUS" == failed_* ]]; then
    echo "ERROR: City in terminal failed state: $CITY_STATUS" >&2; exit 1
  fi
  echo "  Waiting... attempt $i status=${CITY_STATUS:-unknown}"
  sleep 3
done

echo ""
echo "=== [1.5/5] Checking telemetry health gates ==="
SUP_TELE_HEALTH="$("${CURL_RETRY[@]}" -X GET "$GC_BASE/internal/telemetry/health" \
  -H "Authorization: Bearer $GC_BEARER_TOKEN")"
echo "$SUP_TELE_HEALTH" | jq .
[[ "$(echo "$SUP_TELE_HEALTH" | jq -r '.ok // false')" == "true" ]] || { echo "ERROR: supervisor telemetry health failed"; exit 1; }
FF_TELE_STATUS="$("${CURL_RETRY[@]}" -X GET "$FF_BASE/gascity/telemetry/status")"
echo "$FF_TELE_STATUS" | jq .
[[ "$(echo "$FF_TELE_STATUS" | jq -r '.ok // false')" == "true" ]] || { echo "ERROR: ff-pipeline telemetry status failed"; exit 1; }

echo ""
echo "=== [2/5] Seeding dispatch EP ==="
IS_PATH="$ROOT/specs/intent-specifications/IS-GC-DISPATCH-WIRE.md"
ES_PATH="$ROOT/specs/executable-specifications/ES-GC-DISPATCH-WIRE.yaml"
[[ -f "$IS_PATH" ]] || { echo "Missing: $IS_PATH" >&2; exit 1; }
[[ -f "$ES_PATH" ]] || { echo "Missing: $ES_PATH" >&2; exit 1; }
TASK="$(head -n 1 "$IS_PATH" | sed 's/^#\s*//')"
SEED_PAYLOAD="$(jq -cn \
  --arg fnId "FN-GC-DISPATCH-WIRE" --arg isId "IS-GC-DISPATCH-WIRE" --arg esId "ES-GC-DISPATCH-WIRE" \
  --arg task "$TASK" --arg isBody "$(cat "$IS_PATH")" --arg esBody "$(cat "$ES_PATH")" \
  '{fnId:$fnId,isId:$isId,esId:$esId,task:$task,isBody:$isBody,esBody:$esBody}')"
SEED_RESP="$("${CURL_RETRY[@]}" -X POST "$FF_BASE/seed-dispatch-ep" \
  -H "Authorization: Bearer $OPERATOR_TOKEN" -H "Content-Type: application/json" -d "$SEED_PAYLOAD")"
echo "$SEED_RESP" | jq .
EP_ID="$(echo "$SEED_RESP" | jq -r '.epId')"
echo "  epId: $EP_ID"

echo ""
echo "=== [3/5] Dispatching to Gas City ==="
DISPATCH_RESP="$("${CURL_RETRY[@]}" -X POST "$FF_BASE/dispatch-formula" \
  -H "Authorization: Bearer $OPERATOR_TOKEN" -H "Content-Type: application/json" \
  -d "{\"epId\": \"$EP_ID\", \"factoryAttempt\": 1}")"
echo "$DISPATCH_RESP" | jq .
GC_BEAD_ID="$(echo "$DISPATCH_RESP" | jq -r '.gc_bead_id // empty')"
FORM_ID="$(echo "$DISPATCH_RESP" | jq -r '.form_id // empty')"
OUTCOME="$(echo "$DISPATCH_RESP" | jq -r '.outcome // empty')"
TRACE_ID="$(echo "$DISPATCH_RESP" | jq -r '.trace_id // empty')"
echo "  outcome: $OUTCOME  bead: ${GC_BEAD_ID:-<none>}  trace_id: ${TRACE_ID:-<none>}"
[[ "$OUTCOME" == "dispatched" && -n "$GC_BEAD_ID" ]] || { echo "Dispatch failed."; exit 1; }
[[ -n "$TRACE_ID" && "$TRACE_ID" != "<none>" ]] || { echo "ERROR: missing trace_id in dispatch response."; exit 1; }

echo ""
echo "=== [4/5] Webhook RELEASE bridge ==="
if [[ -z "$GC_HMAC_SECRET" ]]; then
  echo "  GC_HMAC_SECRET not set — skipping webhook bridge test."
else
  CALLBACK_PAYLOAD="$(jq -cn \
    --arg fn_id "FN-GC-DISPATCH-WIRE" --arg is_id "IS-GC-DISPATCH-WIRE" \
    --arg es_id "ES-GC-DISPATCH-WIRE" --arg ep_id "$EP_ID" \
    --arg form_id "$FORM_ID" --arg bead_id "$GC_BEAD_ID" --arg outcome "approved" \
    --argjson factory_attempt 1 \
    '{fn_id:$fn_id,is_id:$is_id,es_id:$es_id,ep_id:$ep_id,form_id:$form_id,factory_attempt:$factory_attempt,bead_id:$bead_id,outcome:$outcome}')"
  SIG="$(printf '%s' "$CALLBACK_PAYLOAD" | openssl dgst -sha256 -hmac "$GC_HMAC_SECRET" | awk '{print $2}')"
  CALLBACK_RESP="$("${CURL_RETRY[@]}" -X POST "$FF_BASE/webhooks/gascity" \
    -H "Content-Type: application/json" -H "X-GC-Key-ID: v1" -H "X-GC-Signature: sha256=$SIG" \
    -d "$CALLBACK_PAYLOAD")"
  echo "$CALLBACK_RESP" | jq .
  echo "  trace_id in response: $(echo "$CALLBACK_RESP" | jq -r '.trace_id // "<none>"')"
fi

echo ""
echo "=== [5/5] Autonomy monitor ==="
AUTONOMY_OK=0
for attempt in 1 2 3; do
  echo "  attempt $attempt..."
  if AUTONOMY_RESP="$(curl --http1.1 --connect-timeout 15 --max-time 120 -sf \
    -X POST "$FF_BASE/gascity/autonomy/run" \
    -H "Authorization: Bearer $OPERATOR_TOKEN" -H "Content-Type: application/json" \
    -d '{"trigger":"smoke"}')"; then
    echo "$AUTONOMY_RESP" | jq .
    [[ "$(echo "$AUTONOMY_RESP" | jq -r '.ok // "false"')" == "true" ]] && { AUTONOMY_OK=1; break; }
    echo "  ok!=true (attempt $attempt)"
  else
    echo "  timed out or failed (attempt $attempt)"
  fi
  [[ $attempt -lt 3 ]] && sleep 15
done
[[ "$AUTONOMY_OK" -eq 1 ]] || { echo "ERROR: Autonomy failed after 3 attempts." >&2; exit 1; }

echo ""
echo "════════════════════════════════════"
echo "  E2E PASSED"
echo "  trace_id:   ${TRACE_ID:-<check dispatch output>}"
echo "  bead:       $GC_BEAD_ID"
echo "  form:       ${FORM_ID:-<check dispatch output>}"
echo "════════════════════════════════════"
