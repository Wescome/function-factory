#!/bin/bash
set -euo pipefail

# Function Factory — Phase 3 Deployment
# Deploys: ff-pipeline (Workflow) + patches ff-gateway (new routes)
#
# Prerequisites:
#   Phase 2 deployed (ff-gates, ff-gateway on koales.workers.dev)
#   Secrets set on ff-pipeline:
#     wrangler secret put ARANGO_URL      -c workers/ff-pipeline/wrangler.jsonc
#     wrangler secret put ARANGO_DATABASE  -c workers/ff-pipeline/wrangler.jsonc
#     wrangler secret put ARANGO_JWT       -c workers/ff-pipeline/wrangler.jsonc
#     wrangler secret put ANTHROPIC_API_KEY -c workers/ff-pipeline/wrangler.jsonc
#     (optional: OPENAI_API_KEY, DEEPSEEK_API_KEY for multi-provider routing)

echo "═══ Phase 3: CF Workflows (Stages 1-5) ═══"
echo ""

# 1. Install + build shared packages
echo "→ Installing dependencies..."
pnpm install

echo "→ Building @factory/arango-client..."
pnpm --filter @factory/arango-client build

echo "→ Building @factory/task-routing..."
pnpm --filter @factory/task-routing build

# 2. Typecheck new packages
echo ""
echo "→ Typechecking ff-pipeline..."
pnpm --filter @factory/ff-pipeline typecheck

echo "→ Typechecking ff-gateway..."
pnpm --filter @factory/ff-gateway typecheck

# 3. Deploy pipeline Worker (Workflow)
echo ""
echo "→ Deploying ff-pipeline (FactoryPipeline Workflow)..."
(cd workers/ff-pipeline && npx wrangler deploy)

# 4. Re-deploy gateway with pipeline binding
echo ""
echo "→ Re-deploying ff-gateway (new pipeline routes)..."
(cd workers/ff-gateway && npx wrangler deploy)

echo ""
echo "═══ Phase 3 deployed ═══"
echo ""
echo "Dry-run test:"
echo '  curl -X POST https://ff-gateway.koales.workers.dev/pipeline \'
echo '    -H "Content-Type: application/json" \'
echo '    -d '"'"'{'
echo '      "dryRun": true,'
echo '      "signal": {'
echo '        "signalType": "internal",'
echo '        "source": "manual",'
echo '        "title": "Test signal",'
echo '        "description": "Testing the pipeline"'
echo '      }'
echo '    }'"'"''
echo ""
echo "Then approve:"
echo '  curl -X POST https://ff-gateway.koales.workers.dev/approve/{instanceId} \'
echo '    -H "Content-Type: application/json" \'
echo '    -d '"'"'{"decision": "approved", "by": "architect"}'"'"''
echo ""
echo "Check status:"
echo '  curl https://ff-gateway.koales.workers.dev/pipeline/{instanceId}'
