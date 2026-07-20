#!/bin/bash
set -euo pipefail

# Secrets managed via CF Secrets Store (factory-secrets). No secret env vars required.

# Function Factory — I-Layer Deployment
# Deploys: ff-commissioning-agent + ff-mediation-agent
#
# Prerequisites:
#   Phase 3 deployed (ff-pipeline, ff-gateway, factory-subscription-buffer)
#   ff-mediation-agent deployed (or run this script — it deploys both)
#
# Usage:
#   bash scripts/deploy-i-layer.sh

echo "═══ I-Layer: ff-commissioning-agent + ff-mediation-agent ═══"
echo ""

# ── Install + typecheck ───────────────────────────────────────────────────────
echo "→ Installing dependencies..."
pnpm install

echo ""
echo "→ Typechecking @factory/commissioning-agent..."
pnpm --filter @factory/commissioning-agent typecheck

echo ""
echo "→ Typechecking @factory/mediation-agent..."
pnpm --filter @factory/mediation-agent typecheck

# ── Deploy ────────────────────────────────────────────────────────────────────
echo ""
echo "→ Deploying ff-mediation-agent..."
(cd workers/ff-mediation-agent && npx wrangler deploy)

echo ""
echo "→ Deploying ff-commissioning-agent..."
(cd workers/ff-commissioning-agent && npx wrangler deploy)

# ── Health checks ─────────────────────────────────────────────────────────────
echo ""
echo "═══ I-Layer deployed ═══"
echo ""
echo "Health checks:"
echo "  curl https://ff-mediation-agent.koales.workers.dev/health"
echo "  curl https://ff-commissioning-agent.koales.workers.dev/health"
echo ""
echo "Smoke test (signal intake):"
echo '  curl -X POST https://ff-commissioning-agent.koales.workers.dev/agents/commission/default/signal \'
echo '    -H "Content-Type: application/json" \'
echo '    -d '"'"'{"repoId":"test","runId":"smoke-001","signal":"test signal"}'"'"''
