#!/usr/bin/env bash
# dispatch-only.sh — seed EP + dispatch to Gas City without token rotation or deploy.
#
# Use after first-dispatch.sh has already set all secrets. Reads OPERATOR_TOKEN
# from /tmp/gc_token.txt (written by first-dispatch.sh) or GC_OPERATOR_TOKEN env.
#
# Usage: ! bash scripts/ops/dispatch-only.sh
#
# Fails fast if 2 dispatch attempts fail (then bench the sync approach).

set -euo pipefail

FF_BASE="https://ff-pipeline.koales.workers.dev"
GC_BASE="https://gascity-supervisor.koales.workers.dev"
CURL_RETRY=(curl --http1.1 --retry 3 --retry-delay 2 --retry-all-errors --connect-timeout 10 --max-time 120 -sf)

# ── Token ────────────────────────────────────────────────────────────────────
if [[ -n "${GC_OPERATOR_TOKEN:-}" ]]; then
  OPERATOR_TOKEN="$GC_OPERATOR_TOKEN"
elif [[ -f /tmp/gc_token.txt ]]; then
  OPERATOR_TOKEN="$(cat /tmp/gc_token.txt)"
else
  echo "ERROR: no operator token. Set GC_OPERATOR_TOKEN or run first-dispatch.sh first." >&2
  exit 1
fi

# ── Pre-warm: wait for Container to be ready ─────────────────────────────────
echo "=== Pre-warming Gas City Container (up to 90s) ==="
WARM=0
for i in $(seq 1 30); do
  HTTP=$(curl --http1.1 --connect-timeout 5 --max-time 10 -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer $OPERATOR_TOKEN" \
    "$GC_BASE/v0/supervisor/status" 2>/dev/null || echo "000")
  if [[ "$HTTP" == "200" ]]; then
    echo "  Container ready (attempt $i, status $HTTP)"
    WARM=1
    break
  fi
  echo "  Waiting... attempt $i status=$HTTP"
  sleep 3
done

if [[ "$WARM" -eq 0 ]]; then
  echo "ERROR: Container did not become ready within 90s." >&2
  exit 1
fi

# ── Dispatch (max 2 attempts) ─────────────────────────────────────────────────
ATTEMPTS=0
SUCCESS=0

for ATTEMPT in 1 2; do
  ATTEMPTS=$ATTEMPT
  echo ""
  echo "=== Dispatch attempt $ATTEMPT/2 ==="

  # Seed EP
  SEED_RESP="$("${CURL_RETRY[@]}" -X POST "$FF_BASE/seed-dispatch-ep" \
    -H "Authorization: Bearer $OPERATOR_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
      "fnId": "FN-GC-DISPATCH-WIRE",
      "isId": "IS-GC-DISPATCH-WIRE",
      "esId": "ES-GC-DISPATCH-WIRE",
      "task": "Wire POST /dispatch-formula to Gas City 3-call HTTP sequence per IS-GC-DISPATCH-WIRE."
    }')"
  EP_ID="$(echo "$SEED_RESP" | jq -r '.epId // empty')"
  if [[ -z "$EP_ID" ]]; then
    echo "  Seed failed: $SEED_RESP"
    continue
  fi
  echo "  epId: $EP_ID"

  # Dispatch
  DISPATCH_RESP="$("${CURL_RETRY[@]}" -X POST "$FF_BASE/dispatch-formula" \
    -H "Authorization: Bearer $OPERATOR_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"epId\": \"$EP_ID\", \"factoryAttempt\": 1}")"
  echo "$DISPATCH_RESP" | jq .

  OUTCOME="$(echo "$DISPATCH_RESP" | jq -r '.outcome // empty')"
  GC_BEAD_ID="$(echo "$DISPATCH_RESP" | jq -r '.gc_bead_id // empty')"

  if [[ "$OUTCOME" == "dispatched" && -n "$GC_BEAD_ID" ]]; then
    SUCCESS=1
    echo ""
    echo "SUCCESS — bead live: $GC_BEAD_ID"
    echo "Monitor: $GC_BASE/v0/city/factory/beads/$GC_BEAD_ID"
    break
  fi

  echo "  outcome=$OUTCOME — attempt $ATTEMPT failed."
  if [[ "$ATTEMPT" -lt 2 ]]; then
    echo "  Retrying in 5s..."
    sleep 5
  fi
done

if [[ "$SUCCESS" -eq 0 ]]; then
  echo ""
  echo "BENCHED after $ATTEMPTS attempts. Sync dispatch is not reliable against cold Container."
  echo "Next: design event-driven dispatch (.agent/patterns/event-driven-default.md)"
  exit 1
fi
