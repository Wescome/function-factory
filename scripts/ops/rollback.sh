#!/usr/bin/env bash
# rollback.sh — controlled Worker rollback with secret-diff gate (INV-6)
# Usage: bash scripts/ops/rollback.sh <worker-name> [--confirm-secret-change]

set -euo pipefail

WORKER="${1:-}"
CONFIRM="${2:-}"

if [[ -z "$WORKER" ]]; then
  echo "Usage: $0 <worker-name> [--confirm-secret-change]" >&2
  echo "  Example: $0 ff-pipeline" >&2
  exit 1
fi

MANIFEST="$(cd "$(dirname "$0")/../.." && pwd)/secrets-manifest.yaml"
[[ -f "$MANIFEST" ]] || { echo "ERROR: secrets-manifest.yaml not found" >&2; exit 1; }

echo "=== Rollback: $WORKER ==="

CURRENT=$(wrangler deployments list --name "$WORKER" --json 2>/dev/null | jq -r '.[0].id' 2>/dev/null || echo "unknown")
PRIOR=$(wrangler deployments list --name "$WORKER" --json 2>/dev/null | jq -r '.[1].id' 2>/dev/null || echo "unknown")

echo "  Current:  $CURRENT"
echo "  Prior:    $PRIOR"
echo ""

echo "Secrets in manifest for $WORKER:"
grep -A1 "worker: $WORKER" "$MANIFEST" -A50 | grep "  - name:" | sed 's/.*- name: /    /' || true
echo ""

if [[ "$CONFIRM" != "--confirm-secret-change" ]]; then
  read -r -p "Did any secret VALUES change between $PRIOR and $CURRENT? [y/N] " CHANGED
  if [[ "$CHANGED" =~ ^[Yy] ]]; then
    echo ""
    echo "ERROR: Re-run with --confirm-secret-change after verifying secrets are correct for $PRIOR." >&2
    exit 1
  fi
fi

echo "Rolling back $WORKER to $PRIOR..."
wrangler rollback --name "$WORKER" "$PRIOR"

echo ""
echo "Rollback complete. Verify health:"
echo "  curl -sf -H 'Authorization: Bearer \$OPERATOR_CONTROL_TOKEN' \\"
echo "    https://ff-pipeline.koales.workers.dev/healthz"
