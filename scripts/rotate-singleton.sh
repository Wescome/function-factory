#!/usr/bin/env bash
set -euo pipefail

FILE="workers/gascity-supervisor/src/index.ts"
CURRENT=$(grep -oE 'singleton-v[0-9]+' "$FILE" | head -1)
NUM=$(echo "$CURRENT" | grep -oE '[0-9]+')
NEW=$((NUM + 1))

# ── Drain gate ──────────────────────────────────────────────────────────────
# Before rotating, verify the outgoing singleton has no active molecules.
# This check MUST use the current suffix — once the suffix changes and the
# Worker redeploys, requests route to the new DO and v_old is unreachable via
# the normal request path. A live v_old with keepalive_refcount > 0 will
# self-renew forever (split-brain with R2/Dolt writes from both DOs).
#
# Set GC_BASE and GC_SUPERVISOR_TOKEN to enforce the gate in production.
# Without them the gate is skipped with a warning (offline/dev rotation).

if [ -n "${GC_BASE:-}" ] && [ -n "${GC_SUPERVISOR_TOKEN:-}" ]; then
  echo "Drain gate: checking $CURRENT fence at ${GC_BASE}/__supervisor/fence ..."
  FENCE=$(curl -sf \
    -H "Authorization: Bearer ${GC_SUPERVISOR_TOKEN}" \
    "${GC_BASE}/__supervisor/fence" 2>/dev/null \
    || echo '{"active":true,"refcount":-1,"error":"unreachable"}')
  ACTIVE=$(echo "$FENCE" | jq -r '.active // true')
  REFCOUNT=$(echo "$FENCE" | jq -r '.refcount // "unknown"')

  if [ "$ACTIVE" = "true" ]; then
    echo "ERROR: $CURRENT is active (refcount=$REFCOUNT) — drain first, then rotate"
    echo "       Wait for in-flight molecules to complete, then re-run this script."
    echo "Fence: $FENCE"
    exit 1
  fi

  echo "Drain gate: $CURRENT is idle (refcount=$REFCOUNT) — safe to rotate"
else
  echo "WARNING: GC_BASE or GC_SUPERVISOR_TOKEN not set — skipping drain gate (offline rotation)"
fi

# ── Rotate ──────────────────────────────────────────────────────────────────
# macOS + Linux compatible sed
if sed --version 2>/dev/null | grep -q GNU; then
  sed -i "s/singleton-v${NUM}/singleton-v${NEW}/" "$FILE"
else
  sed -i '' "s/singleton-v${NUM}/singleton-v${NEW}/" "$FILE"
fi

echo "Rotated: singleton-v${NUM} → singleton-v${NEW}"
