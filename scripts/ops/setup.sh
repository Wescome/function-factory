#!/usr/bin/env bash
# setup.sh — rare-cadence Gas City setup
#
# Usage: ! bash scripts/ops/setup.sh
#
# Rotates all tokens, sets all secrets, deploys ff-pipeline + supervisor,
# rotates the supervisor singleton (evicts + re-bakes the Container), pre-warms
# the Container, and waits for the city runtime to report dispatch readiness.
#
# This runs RARELY — only when tokens must rotate or the Container must be
# re-baked. It does NOT seed or dispatch. Use seed.sh + dispatch.sh for those.
#
# Persists for downstream scripts:
#   /tmp/gc_supervisor_token.txt — GC_BEARER_TOKEN (supervisor bearer)
#   /tmp/gc_token.txt            — OPERATOR_TOKEN  (operator control token)
#   /tmp/gc_hmac_secret.txt      — GC_HMAC_SECRET  (webhook HMAC secret)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FF_PIPELINE_DIR="$ROOT/workers/ff-pipeline"
SUPERVISOR_DIR="$ROOT/workers/gascity-supervisor"

require_command() {
  command -v "$1" >/dev/null 2>&1 || { echo "Missing: $1" >&2; exit 1; }
}
require_command curl
require_command jq
require_command openssl
require_command npx
require_command git
require_command perl

# ── 1. Generate all tokens ───────────────────────────────────────────────────
echo "=== [1/4] Generating tokens ==="
GC_BEARER_TOKEN="$(openssl rand -hex 32)"
OPERATOR_TOKEN="$(openssl rand -hex 32)"
GC_HMAC_SECRET="$(openssl rand -hex 32)"

echo "$GC_BEARER_TOKEN" > /tmp/gc_supervisor_token.txt
echo "$OPERATOR_TOKEN" > /tmp/gc_token.txt
echo "$GC_HMAC_SECRET" > /tmp/gc_hmac_secret.txt

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

echo "  Setting OPERATOR_CONTROL_TOKEN on gascity-supervisor (pi-rpc bearer token)..."
printf '%s' "$OPERATOR_TOKEN" | (cd "$SUPERVISOR_DIR" && npx wrangler secret put OPERATOR_CONTROL_TOKEN)

# ── 2. Deploy ff-pipeline ────────────────────────────────────────────────────
echo ""
echo "=== [2/4] Deploying ff-pipeline with Gas City vars ==="
DEPLOY_LOG="$(mktemp)"
if ! (cd "$FF_PIPELINE_DIR" && npx wrangler deploy >"$DEPLOY_LOG" 2>&1); then
  cat "$DEPLOY_LOG"
  rm -f "$DEPLOY_LOG"
  echo "Deploy failed."
  exit 1
fi
grep -E "Deployed|Current Version|ERROR|error" "$DEPLOY_LOG" || cat "$DEPLOY_LOG"
rm -f "$DEPLOY_LOG"

# ── 2a. Rotate supervisor singleton + deploy supervisor ──────────────────────
echo ""
echo "=== [3/4] Rotating supervisor singleton + deploying supervisor ==="
# The idFromName key change (not the deploy) is what evicts the old Container.
# One rotation re-bakes all three injected secrets:
#   GC_SUPERVISOR_TOKEN, FF_OPERATOR_CONTROL_TOKEN, GAS_CITY_HMAC_SECRET
git -C "$ROOT" symbolic-ref -q HEAD >/dev/null \
  || { echo "ERROR: detached HEAD — refusing to commit singleton bump." >&2; exit 1; }
CURRENT_VER=$(grep -o 'singleton-v[0-9]*' "$SUPERVISOR_DIR/src/index.ts" | head -1 | grep -o '[0-9]*$')
[[ "$CURRENT_VER" =~ ^[0-9]+$ ]] \
  || { echo "ERROR: could not parse singleton version from index.ts" >&2; exit 1; }
NEXT_VER=$((CURRENT_VER + 1))
echo "  singleton-v${CURRENT_VER} → singleton-v${NEXT_VER}"
perl -i -pe "s/idFromName\\(\"singleton-v${CURRENT_VER}\"\\)/idFromName(\"singleton-v${NEXT_VER}\")/g" \
  "$SUPERVISOR_DIR/src/index.ts"
if ! git -C "$ROOT" diff --quiet -- "$SUPERVISOR_DIR/src/index.ts"; then
  git -C "$ROOT" add "$SUPERVISOR_DIR/src/index.ts"
  git -C "$ROOT" commit -m "INFRA: rotate singleton v${CURRENT_VER}→v${NEXT_VER} — re-bake GC_SUPERVISOR_TOKEN + FF_OPERATOR_CONTROL_TOKEN + GAS_CITY_HMAC_SECRET into Container"
fi
DEPLOY_LOG="$(mktemp)"
if ! (cd "$SUPERVISOR_DIR" && npx wrangler deploy >"$DEPLOY_LOG" 2>&1); then
  cat "$DEPLOY_LOG"; rm -f "$DEPLOY_LOG"; echo "Supervisor deploy failed." >&2; exit 1
fi
grep -E "Deployed|Current Version|ERROR" "$DEPLOY_LOG" || cat "$DEPLOY_LOG"
rm -f "$DEPLOY_LOG"

# ── 2b. Pre-warm Container ───────────────────────────────────────────────────
echo ""
echo "=== [4/4] Pre-warming Gas City Container (up to 120s) ==="
GC_BASE="https://gascity-supervisor.koales.workers.dev"
WARM=0
for i in $(seq 1 40); do
  HTTP=$(curl --http1.1 --connect-timeout 5 --max-time 15 -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer $GC_BEARER_TOKEN" \
    "$GC_BASE/v0/cities" 2>/dev/null || echo "000")
  if [[ "$HTTP" == "200" || "$HTTP" == "404" ]]; then
    echo "  Container ready (attempt $i, status $HTTP)"
    WARM=1
    break
  fi
  echo "  Waiting... attempt $i status=$HTTP"
  sleep 3
done
[[ "$WARM" -eq 1 ]] || { echo "ERROR: Container did not become ready." >&2; exit 1; }

echo "  Waiting for city runtime to report dispatch readiness..."
CITY_READY=0
LAST_CITY_ITEM=""
for i in $(seq 1 100); do
  CITY_ITEM=$(curl --http1.1 --connect-timeout 5 --max-time 15 -s \
    -H "Authorization: Bearer $GC_BEARER_TOKEN" \
    "$GC_BASE/v0/cities" 2>/dev/null | jq -c '.items[]? | select(.name=="factory")' || true)
  LAST_CITY_ITEM="$CITY_ITEM"
  CITY_RUNNING=$(printf '%s' "$CITY_ITEM" | jq -r '.running // false' 2>/dev/null || echo "false")
  CITY_DISPATCH_READY=$(printf '%s' "$CITY_ITEM" | jq -r '.dispatch_ready // false' 2>/dev/null || echo "false")
  CITY_STATUS=$(printf '%s' "$CITY_ITEM" | jq -r '.status // ""' 2>/dev/null || echo "")
  CITY_PHASE_META=$(printf '%s' "$CITY_ITEM" | jq -c '.phase_meta // null' 2>/dev/null || echo "null")
  if [[ "$CITY_DISPATCH_READY" == "true" || "$CITY_STATUS" == "running_degraded" || "$CITY_RUNNING" == "true" ]]; then
    echo "  City runtime ready (attempt $i)"
    CITY_READY=1
    break
  fi
  if [[ "$CITY_STATUS" == failed_* ]]; then
    echo "ERROR: City entered terminal startup state: $CITY_STATUS" >&2
    echo "  phase_meta: $CITY_PHASE_META" >&2
    exit 1
  fi
  echo "  City not ready yet (attempt $i, status=${CITY_STATUS:-unknown})"
  sleep 3
done
[[ "$CITY_READY" -eq 1 ]] || {
  echo "ERROR: City did not reach dispatch readiness." >&2
  if [[ -n "$LAST_CITY_ITEM" ]]; then
    echo "  last city item: $LAST_CITY_ITEM" >&2
  fi
  exit 1
}

# Probe formula endpoint — same URL ff-pipeline CALL 1 will hit
echo "  Probing formula endpoint..."
FORMULA_PROBE=$(curl --http1.1 -s -o /dev/stdout -w "\nHTTP_STATUS:%{http_code}" \
  -H "Authorization: Bearer $GC_BEARER_TOKEN" \
  -H "X-GC-Request: true" \
  "$GC_BASE/v0/city/factory/formulas/factory-coding-v1?target=coder&scope_kind=city&scope_ref=factory" 2>/dev/null)
echo "  Formula probe: $FORMULA_PROBE"

echo ""
echo "=== Setup complete ==="
echo "  GC_BEARER_TOKEN → /tmp/gc_supervisor_token.txt"
echo "  OPERATOR_TOKEN  → /tmp/gc_token.txt"
echo "  GC_HMAC_SECRET  → /tmp/gc_hmac_secret.txt"
echo "  Next: bash scripts/ops/seed.sh <IS_PATH> <ES_PATH>"
