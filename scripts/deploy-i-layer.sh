#!/bin/bash
set -euo pipefail

# Function Factory — I-Layer Deployment
# Deploys: ff-commissioning-agent + ff-mediation-agent
#
# Prerequisites:
#   Phase 3 deployed (ff-pipeline, ff-gateway, factory-subscription-buffer)
#   ff-mediation-agent deployed (or run this script — it deploys both)
#
# Required env vars (export before running):
#   FF_AGENT_SIGNING_KEY          — WGSP envelope signing key
#   SUB_BUFFER_PRODUCER_SECRET    — SubscriptionEventBufferDO HMAC auth
#   LINEAR_API_KEY                — Linear personal access token
#
# Usage:
#   export FF_AGENT_SIGNING_KEY=...
#   export SUB_BUFFER_PRODUCER_SECRET=...
#   export LINEAR_API_KEY=...
#   bash scripts/deploy-i-layer.sh

echo "═══ I-Layer: ff-commissioning-agent + ff-mediation-agent ═══"
echo ""

# ── Validate env vars ─────────────────────────────────────────────────────────
: "${FF_AGENT_SIGNING_KEY:?FF_AGENT_SIGNING_KEY must be set}"
: "${SUB_BUFFER_PRODUCER_SECRET:?SUB_BUFFER_PRODUCER_SECRET must be set}"
: "${LINEAR_API_KEY:?LINEAR_API_KEY must be set}"

# ── Install + typecheck ───────────────────────────────────────────────────────
echo "→ Installing dependencies..."
pnpm install

echo ""
echo "→ Typechecking @factory/commissioning-agent..."
pnpm --filter @factory/commissioning-agent typecheck

echo ""
echo "→ Typechecking @factory/mediation-agent..."
pnpm --filter @factory/mediation-agent typecheck

# ── Secrets: ff-commissioning-agent ──────────────────────────────────────────
echo ""
echo "→ Setting secrets on ff-commissioning-agent..."
echo "$LINEAR_API_KEY"         | wrangler secret put LINEAR_API_KEY         -c workers/ff-commissioning-agent/wrangler.jsonc
echo "$FF_AGENT_SIGNING_KEY"   | wrangler secret put FF_AGENT_SIGNING_KEY   -c workers/ff-commissioning-agent/wrangler.jsonc
echo "$SUB_BUFFER_PRODUCER_SECRET" | wrangler secret put SUB_BUFFER_PRODUCER_SECRET -c workers/ff-commissioning-agent/wrangler.jsonc

# ── Secrets: ff-mediation-agent ───────────────────────────────────────────────
echo ""
echo "→ Setting secrets on ff-mediation-agent..."
echo "$SUB_BUFFER_PRODUCER_SECRET" | wrangler secret put SUB_BUFFER_PRODUCER_SECRET -c workers/ff-mediation-agent/wrangler.jsonc

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
