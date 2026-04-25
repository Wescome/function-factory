#!/bin/bash
set -euo pipefail

# Function Factory — Phase 2 Deployment
# Deploys: ff-gates (internal) → ff-gateway (public, binds to gates + query)
#
# Prerequisites:
#   pnpm install (from monorepo root)
#   wrangler login
#   Secrets set on each Worker:
#     wrangler secret put ARANGO_URL      -c workers/ff-gates/wrangler.jsonc
#     wrangler secret put ARANGO_DATABASE -c workers/ff-gates/wrangler.jsonc
#     wrangler secret put ARANGO_JWT      -c workers/ff-gates/wrangler.jsonc
#     (repeat for workers/ff-gateway/wrangler.jsonc)

echo "═══ Phase 2: Edge Workers + Gate 1 ═══"
echo ""

# 1. Build shared packages
echo "→ Building @factory/arango-client..."
pnpm --filter @factory/arango-client build

# 2. Deploy internal Workers first (binding targets must exist)
echo ""
echo "→ Deploying ff-gates (Gate 1, internal)..."
(cd workers/ff-gates && npx wrangler deploy)

# 3. Deploy public gateway last (binds to gates + query)
echo ""
echo "→ Deploying ff-gateway (API gateway, public)..."
(cd workers/ff-gateway && npx wrangler deploy)

echo ""
echo "═══ Phase 2 deployed ═══"
echo ""
echo "Gateway:  https://ff-gateway.<your-subdomain>.workers.dev"
echo "Test:     curl https://ff-gateway.<your-subdomain>.workers.dev/health"
echo ""
echo "Local dev:"
echo "  cd workers/ff-gateway && pnpm dev"
echo "  → http://localhost:8787/health"
