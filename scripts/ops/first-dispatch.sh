#!/usr/bin/env bash
# first-dispatch.sh — initial end-to-end wire-up + roadmap smoke
#
# Usage: ! bash scripts/ops/first-dispatch.sh
#
# Thin wrapper that runs the three focused ops scripts in sequence for the
# initial E2E wire-up:
#   setup.sh    — rotate tokens, deploy, rotate singleton, pre-warm (rare)
#   seed.sh     — IS + ES → epId (once per Function)
#   dispatch.sh — POST /dispatch-formula (every job)
#
# Then exercises the RELEASE webhook bridge and runs the Cloudflare autonomy
# monitor. Those last two steps are smoke-test scaffolding, NOT steady-state
# dispatch — they live here and nowhere else.

set -euo pipefail

DIR="$(dirname "$0")"
ROOT="$(cd "$DIR/../.." && pwd)"
FF_BASE="https://ff-pipeline.koales.workers.dev"

require_command() {
  command -v "$1" >/dev/null 2>&1 || { echo "Missing: $1" >&2; exit 1; }
}
require_command curl
require_command jq
require_command openssl

CURL_RETRY=(curl --http1.1 --retry 5 --retry-delay 2 --retry-all-errors --connect-timeout 10 --max-time 120 -sf)

IS_PATH="$ROOT/specs/intent-specifications/IS-GC-DISPATCH-WIRE.md"
ES_PATH="$ROOT/specs/executable-specifications/ES-GC-DISPATCH-WIRE.md"
if [[ ! -f "$ES_PATH" ]]; then
  ES_PATH="$ROOT/specs/executable-specifications/ES-GC-DISPATCH-WIRE.yaml"
fi

# ── 1–4. setup → seed → dispatch ─────────────────────────────────────────────
bash "$DIR/setup.sh"
bash "$DIR/seed.sh" "$IS_PATH" "$ES_PATH"

EP_ID="$(cat /tmp/gc_ep_id.txt)"
OPERATOR_TOKEN="$(cat /tmp/gc_token.txt)"
GC_HMAC_SECRET="$(cat /tmp/gc_hmac_secret.txt)"

bash "$DIR/dispatch.sh" "$EP_ID"

# Reuse the response dispatch.sh persisted, rather than re-issuing the dispatch
# (which risks spawning a second bead). dispatch.sh writes the full raw JSON to
# /tmp/gc_dispatch_resp.json; the webhook bridge below needs form_id + bead id.
DISPATCH_RESP="$(cat /tmp/gc_dispatch_resp.json)"
GC_BEAD_ID="$(echo "$DISPATCH_RESP" | jq -r '.gc_bead_id // empty')"
FORM_ID="$(echo "$DISPATCH_RESP" | jq -r '.form_id // empty')"

# ── 5. Exercise RELEASE webhook bridge ──────────────────────────────────────
echo ""
echo "=== [smoke 1/2] Exercising Factory webhook RELEASE bridge ==="
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
echo "=== [smoke 2/2] Running Cloudflare autonomy monitor ==="
# Worker was redeployed in setup.sh — give it a moment to warm up before
# hitting the autonomy endpoint (which does 4 sequential probes at 6s each).
echo "  Waiting 10s for Worker to warm after redeploy..."
sleep 10

AUTONOMY_OK=0
for attempt in 1 2 3; do
  echo "  Autonomy run attempt $attempt..."
  if AUTONOMY_RESP="$(curl --http1.1 --connect-timeout 15 --max-time 120 -sf -X POST "$FF_BASE/gascity/autonomy/run" \
    -H "Authorization: Bearer $OPERATOR_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"trigger":"smoke"}')"; then
    echo "$AUTONOMY_RESP" | jq .
    if [[ "$(echo "$AUTONOMY_RESP" | jq -r '.ok // "false"')" == "true" ]]; then
      AUTONOMY_OK=1
      break
    fi
    echo "  Autonomy run returned ok!=true (attempt $attempt)."
  else
    echo "  Autonomy run timed out or failed (attempt $attempt)."
  fi
  [[ $attempt -lt 3 ]] && sleep 15
done
[[ "$AUTONOMY_OK" -eq 1 ]] || { echo "ERROR: Autonomy monitor failed after 3 attempts." >&2; exit 1; }

echo ""
echo "=== Autonomy status ==="
if AUTONOMY_STATUS="$(curl --http1.1 --connect-timeout 10 --max-time 30 -sf "$FF_BASE/gascity/autonomy/status")"; then
  echo "$AUTONOMY_STATUS" | jq .
  if [[ "$(echo "$AUTONOMY_STATUS" | jq -r '.ok // "false"')" != "true" ]]; then
    echo "Autonomy status did not report ok=true."
    exit 1
  fi
else
  echo "Autonomy status unavailable (non-fatal): run already succeeded."
fi
