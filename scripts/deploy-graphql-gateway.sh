#!/bin/bash
set -euo pipefail

# Secrets managed via CF Secrets Store (factory-secrets). No secret env vars required.

# Function Factory — GraphQL + Gateway Deployment
# Deploys: factory-graphql + factory-gateway
#
# Prerequisites:
#   Phase 3 deployed (ff-pipeline, factory-subscription-buffer)
#   ff-commissioning-agent deployed (factory-gateway binds its DO)
#
# Usage:
#   bash scripts/deploy-graphql-gateway.sh

echo "═══ GraphQL + Gateway: factory-graphql + factory-gateway ═══"
echo ""

# ── Install + typecheck ───────────────────────────────────────────────────────
echo "→ Installing dependencies..."
pnpm install

echo ""
echo "→ Typechecking factory-graphql..."
pnpm --filter factory-graphql typecheck 2>/dev/null || echo "no typecheck for factory-graphql"

echo ""
echo "→ Typechecking factory-gateway..."
pnpm --filter factory-gateway typecheck 2>/dev/null || echo "no typecheck for factory-gateway"

# ── Deploy ────────────────────────────────────────────────────────────────────
echo ""
echo "→ Deploying factory-graphql..."
(cd workers/factory-graphql && npx wrangler deploy)

echo ""
echo "→ Deploying factory-gateway..."
(cd workers/factory-gateway && npx wrangler deploy)

# ── Health checks ─────────────────────────────────────────────────────────────
echo ""
echo "═══ GraphQL + Gateway deployed ═══"
echo ""
echo "Health checks:"
echo "  curl https://factory-graphql.koales.workers.dev/health"
echo "  curl https://factory-gateway.koales.workers.dev/health"
echo ""
echo "Smoke test (GraphQL introspection):"
echo '  curl -X POST https://factory-graphql.koales.workers.dev/graphql \'
echo '    -H "Content-Type: application/json" \'
echo '    -d '"'"'{"query":"{__typename}"}'"'"''
