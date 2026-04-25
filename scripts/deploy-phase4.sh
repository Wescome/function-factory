#!/bin/bash
set -euo pipefail

# Function Factory — Phase 4 Deployment
# Adds: SynthesisCoordinator DO (Stage 6, 5-role topology)
#
# Prerequisites:
#   Phase 3 deployed (ff-pipeline with Stages 1-5)
#   ANTHROPIC_API_KEY set on ff-pipeline
#   ArangoDB collections: execution_artifacts, mentorscript_rules (create if missing)

echo "═══ Phase 4: Coordinator DO + Stage 6 ═══"
echo ""

# 1. Build shared packages
echo "→ Installing dependencies..."
pnpm install

echo "→ Building @factory/task-routing..."
pnpm --filter @factory/task-routing build

echo "→ Building @factory/arango-client..."
pnpm --filter @factory/arango-client build

# 2. Typecheck
echo ""
echo "→ Typechecking ff-pipeline..."
pnpm --filter @factory/ff-pipeline typecheck

# 3. Deploy ff-pipeline with DO binding
echo ""
echo "→ Deploying ff-pipeline (Workflow + SynthesisCoordinator DO)..."
(cd workers/ff-pipeline && npx wrangler deploy)

echo ""
echo "═══ Phase 4 deployed ═══"
echo ""
echo "Dry-run test (full pipeline including Stage 6):"
echo '  curl -X POST https://ff-gateway.koales.workers.dev/pipeline \'
echo '    -H "Content-Type: application/json" \'
echo '    -d '"'"'{"dryRun":true,"signal":{"signalType":"meta","source":"manual","title":"Phase 4 test","description":"Full pipeline with Stage 6 synthesis"}}'"'"''
echo ""
echo "Then approve:"
echo '  curl -X POST https://ff-gateway.koales.workers.dev/approve/{instanceId} \'
echo '    -H "Content-Type: application/json" \'
echo '    -d '"'"'{"decision":"approved","by":"architect"}'"'"''
echo ""
echo "Expected: Stages 1-5 → Gate 1 PASS → Stage 6 (5 roles) → synthesis-passed"
