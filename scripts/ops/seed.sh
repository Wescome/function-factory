#!/usr/bin/env bash
# seed.sh — seed a dispatch EP from an IS + ES pair (runs once per Function)
#
# Usage: ! bash scripts/ops/seed.sh <IS_PATH> <ES_PATH>
#
# Reads the IS and ES files, derives artifact IDs from their filenames
# (IS-FOO.md → IS-FOO), builds the seed payload, POSTs to /seed-dispatch-ep,
# prints the resulting epId, and writes it to /tmp/gc_ep_id.txt for dispatch.sh.
#
# Requires:
#   /tmp/gc_token.txt — OPERATOR_TOKEN (written by setup.sh)

set -euo pipefail

require_command() {
  command -v "$1" >/dev/null 2>&1 || { echo "Missing: $1" >&2; exit 1; }
}
require_command curl
require_command jq

FF_BASE="https://ff-pipeline.koales.workers.dev"

IS_PATH="${1:-}"
ES_PATH="${2:-}"
[[ -n "$IS_PATH" && -n "$ES_PATH" ]] \
  || { echo "Usage: bash scripts/ops/seed.sh <IS_PATH> <ES_PATH>" >&2; exit 1; }
[[ -f "$IS_PATH" ]] || { echo "Missing required IS file: $IS_PATH" >&2; exit 1; }
[[ -f "$ES_PATH" ]] || { echo "Missing required ES file: $ES_PATH" >&2; exit 1; }

[[ -f /tmp/gc_token.txt ]] \
  || { echo "Missing /tmp/gc_token.txt — run scripts/ops/setup.sh first." >&2; exit 1; }
OPERATOR_TOKEN="$(cat /tmp/gc_token.txt)"

CURL_RETRY=(curl --http1.1 --retry 5 --retry-delay 2 --retry-all-errors --connect-timeout 10 --max-time 120 -sf)

# Derive artifact IDs from filenames: strip dir + extension.
#   /path/IS-GC-DISPATCH-WIRE.md  → IS-GC-DISPATCH-WIRE
#   /path/ES-GC-DISPATCH-WIRE.yaml → ES-GC-DISPATCH-WIRE
IS_ID="$(basename "$IS_PATH")"; IS_ID="${IS_ID%.*}"
ES_ID="$(basename "$ES_PATH")"; ES_ID="${ES_ID%.*}"
# FN id derived from the IS id: IS-FOO → FN-FOO
FN_ID="FN-${IS_ID#IS-}"

echo "=== Seeding dispatch EP ==="
echo "  IS: $IS_PATH ($IS_ID)"
echo "  ES: $ES_PATH ($ES_ID)"
echo "  FN: $FN_ID"

TASK="$(head -n 1 "$IS_PATH" | sed 's/^#\s*//')"
IS_BODY="$(cat "$IS_PATH")"
ES_BODY="$(cat "$ES_PATH")"
SEED_PAYLOAD="$(jq -cn \
  --arg fnId "$FN_ID" \
  --arg isId "$IS_ID" \
  --arg esId "$ES_ID" \
  --arg task "$TASK" \
  --arg isBody "$IS_BODY" \
  --arg esBody "$ES_BODY" \
  '{fnId:$fnId,isId:$isId,esId:$esId,task:$task,isBody:$isBody,esBody:$esBody}')"
SEED_RESP="$("${CURL_RETRY[@]}" -X POST "$FF_BASE/seed-dispatch-ep" \
  -H "Authorization: Bearer $OPERATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$SEED_PAYLOAD")"
echo "$SEED_RESP" | jq .
EP_ID="$(echo "$SEED_RESP" | jq -r '.epId')"
[[ -n "$EP_ID" && "$EP_ID" != "null" ]] \
  || { echo "ERROR: no epId in seed response." >&2; exit 1; }

echo "$EP_ID" > /tmp/gc_ep_id.txt
echo "  epId: $EP_ID  → /tmp/gc_ep_id.txt"
echo "  Next: bash scripts/ops/dispatch.sh $EP_ID"
