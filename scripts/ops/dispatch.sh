#!/usr/bin/env bash
# dispatch.sh — fire a single dispatch into Gas City (runs every job)
#
# Usage: ! bash scripts/ops/dispatch.sh <epId> [--attempt N]
#
# Optionally probes city health, POSTs /dispatch-formula {epId, factoryAttempt},
# prints outcome / gc_bead_id / trace_id, and exits non-zero unless the outcome
# is "dispatched". Does NOT rotate tokens, deploy, rotate the singleton, run the
# webhook bridge, or run the autonomy monitor — that is steady-state only.
#
# Requires:
#   /tmp/gc_token.txt           — OPERATOR_TOKEN (written by setup.sh)
# Optional:
#   /tmp/gc_supervisor_token.txt — GC_BEARER_TOKEN (enables city health probe)

set -euo pipefail

require_command() {
  command -v "$1" >/dev/null 2>&1 || { echo "Missing: $1" >&2; exit 1; }
}
require_command curl
require_command jq

FF_BASE="https://ff-pipeline.koales.workers.dev"
GC_BASE="https://gascity-supervisor.koales.workers.dev"

EP_ID=""
ATTEMPT=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --attempt)
      ATTEMPT="${2:-}"
      [[ "$ATTEMPT" =~ ^[0-9]+$ ]] || { echo "ERROR: --attempt requires an integer." >&2; exit 1; }
      shift 2
      ;;
    *)
      if [[ -z "$EP_ID" ]]; then EP_ID="$1"; shift
      else echo "Unexpected argument: $1" >&2; exit 1; fi
      ;;
  esac
done
[[ -n "$EP_ID" ]] || { echo "Usage: bash scripts/ops/dispatch.sh <epId> [--attempt N]" >&2; exit 1; }

[[ -f /tmp/gc_token.txt ]] \
  || { echo "Missing /tmp/gc_token.txt — run scripts/ops/setup.sh first." >&2; exit 1; }
OPERATOR_TOKEN="$(cat /tmp/gc_token.txt)"

CURL_RETRY=(curl --http1.1 --retry 5 --retry-delay 2 --retry-all-errors --connect-timeout 10 --max-time 120 -sf)

# ── Optional city health probe ───────────────────────────────────────────────
if [[ -f /tmp/gc_supervisor_token.txt ]]; then
  GC_BEARER_TOKEN="$(cat /tmp/gc_supervisor_token.txt)"
  echo "=== City health probe ==="
  HTTP=$(curl --http1.1 --connect-timeout 5 --max-time 15 -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer $GC_BEARER_TOKEN" \
    "$GC_BASE/v0/cities" 2>/dev/null || echo "000")
  echo "  /v0/cities status: $HTTP"
  if [[ "$HTTP" != "200" && "$HTTP" != "404" ]]; then
    echo "  WARNING: city did not respond ready (status $HTTP) — proceeding anyway." >&2
  fi
fi

# ── Dispatch ─────────────────────────────────────────────────────────────────
echo ""
echo "=== Dispatching to Gas City ==="
echo "  epId: $EP_ID  factoryAttempt: $ATTEMPT"
DISPATCH_RESP="$("${CURL_RETRY[@]}" -X POST "$FF_BASE/dispatch-formula" \
  -H "Authorization: Bearer $OPERATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"epId\": \"$EP_ID\", \"factoryAttempt\": $ATTEMPT}")"
# Persist the raw response so wrappers (e.g. first-dispatch.sh) can reuse it
# without re-issuing the dispatch and risking a second bead.
echo "$DISPATCH_RESP" > /tmp/gc_dispatch_resp.json
echo "$DISPATCH_RESP" | jq .

OUTCOME="$(echo "$DISPATCH_RESP" | jq -r '.outcome // empty')"
GC_BEAD_ID="$(echo "$DISPATCH_RESP" | jq -r '.gc_bead_id // empty')"
TRACE_ID="$(echo "$DISPATCH_RESP" | jq -r '.trace_id // empty')"

echo ""
echo "=== Result ==="
echo "  outcome:    ${OUTCOME:-<none>}"
echo "  gc_bead_id: ${GC_BEAD_ID:-<none>}"
echo "  trace_id:   ${TRACE_ID:-<none>}"

if [[ "$OUTCOME" == "dispatched" && -n "$GC_BEAD_ID" ]]; then
  echo ""
  echo "SUCCESS — bead is live in Gas City."
  echo "Monitor: $GC_BASE/v0/city/factory/beads/$GC_BEAD_ID"
else
  echo ""
  echo "Dispatch did not complete — check outcome above." >&2
  exit 1
fi
