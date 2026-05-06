# Current Workspace

## Status
Active task: Phase 5 sandbox binding preflight for Function Factory.

## Last update
2026-05-06T01:18:39Z

## Current actions

- Added index-only documentation files:
  - `docs/README.md`
  - `docs/adr/README.md`
  - `specs/README.md`
  - `specs/reference/README.md`
- No `specs/` artifacts were moved or renamed.
- Verification completed:
  - new-doc relative link check: pass
  - `pnpm -r --if-present typecheck`: pass
  - `pnpm -r --if-present test`: pass
- Added Stage 2 audit:
  - `scripts/audit-docs.mjs`
  - root `pnpm audit:docs` script
  - docs references in `docs/README.md` and `specs/README.md`
- Stage 2 audit recognizes current explicit exceptions:
  - 253 `ATOM-*` virtual compiler-intermediate refs in WorkGraphs
  - 1 historical known lineage gap:
    `OBS-META-ARCHITECTURE-CANDIDATE-EXECUTION-2`
- Verification completed:
  - `pnpm audit:docs`: pass
  - `pnpm -r --if-present typecheck`: pass
  - `pnpm -r --if-present test`: pass
- Added Stage 3 low-risk docs grouping:
  - moved the Strategy.Recipes dogfood how-to to `docs/how-to/STRATEGY_RECIPES_DOGFOOD.md`
  - left `docs/STRATEGY_RECIPES_DOGFOOD.md` as a compatibility stub
  - updated links in `docs/README.md` and `docs/AUTONOMOUS_FACTORY_TRANSITION.md`
- Verification completed:
  - `pnpm audit:docs`: pass
  - `git diff --check`: pass
  - `pnpm -r --if-present typecheck`: pass
  - `pnpm -r --if-present test`: pass
- Hardened sandbox binding/API preflight:
  - verified `workers/ff-pipeline/wrangler.jsonc` declares the `SANDBOX` Durable Object binding, migration, sandbox container, workspace R2 bucket, and Stage 6 queue bridge bindings
  - added `workers/ff-pipeline/src/coordinator/sandbox-preflight.test.ts` to lock those bindings and the installed `@cloudflare/sandbox` backup API shape
  - changed sandbox backup state/deps from string IDs to full `SandboxBackupHandle` objects matching the installed `DirectoryBackup` contract
  - updated coordinator fallback stubs and sandbox/coordinator/state tests to pass full backup handles through restore
- Verification completed:
  - `pnpm --filter @factory/ff-pipeline test -- src/coordinator/sandbox-deps-factory.test.ts src/coordinator/sandbox-role.test.ts src/coordinator/coordinator-sandbox-wiring.test.ts src/coordinator/coordinator-integration.test.ts src/coordinator/state.test.ts src/coordinator/sandbox-preflight.test.ts`: pass, 92 tests
  - `pnpm --filter @factory/ff-pipeline typecheck`: pass
  - `git diff --check`: pass
- Hardened Stage 6 graph evidence:
  - replaced graph-internal compile stub output with non-authoritative upstream compile pass-through evidence
  - replaced graph-internal Gate 1 stub output with non-authoritative upstream Gate 1 pass-through evidence
  - added tests that reject the old `stub-check` / `Gate 1 passed (stub)` evidence labels
  - cleaned repair-path test fixtures to use upstream compile evidence instead of `{ stub: true }`
- Verification completed:
  - `pnpm --filter @factory/ff-pipeline test -- src/coordinator/graph-9node.test.ts`: failed before implementation as expected
  - `pnpm --filter @factory/ff-pipeline test -- src/coordinator/graph-9node.test.ts src/coordinator/coordinator-9node-wiring.test.ts src/coordinator/vertical-slicing.test.ts`: pass
  - `pnpm --filter @factory/ff-pipeline typecheck`: pass
  - `git diff --check`: pass
- Imported ontology self-sensing reference:
  - copied `/Users/wes/Downloads/factory-onto-self-sense.md` to `specs/reference/ONTOLOGICAL-SELF-SENSING-2026-05-03.md`
  - indexed it in `specs/reference/README.md`
  - linked it from `specs/README.md` and `docs/README.md`
  - clarified that `AGENTS.md`, `spec.md`, and `tasks.md` are portable agent-facing emission views, not replacements for the native typed Factory artifact graph
- Verification completed after import:
  - `pnpm audit:docs`: pass
  - `git diff --check`: pass
- Added Stage 4 docs hardening:
  - added `docs/how-to/README.md`
  - classified remaining root docs in `docs/README.md`
  - kept `AUTONOMOUS_FACTORY_TRANSITION.md` as explanation
  - kept terminal contract/backlog docs as reference/planning material
  - found no additional pure how-to files to move
  - kept all `specs/` paths unchanged
- Tightened `pnpm audit:docs`:
  - requires README files for Markdown-bearing `docs/` sections
  - requires declared how-to migration compatibility stubs
  - reports orphan docs not linked from a docs README index
- Verification completed:
  - `pnpm audit:docs`: pass
  - `git diff --check`: pass
  - `pnpm -r --if-present typecheck`: pass
  - `pnpm -r --if-present test`: pass

## Recent actions (last 4h from AGENT_LEARNINGS.jsonl)

- [18:11:30] Bash: curl -s "https://ff-gateway.koales.workers.dev/pipeline/0b046595-089f-4599-97a1-516d3d546369" 2>/dev/null | python3 -c "
- [18:11:31] Bash: curl -s "https://ff-gateway.koales.workers.dev/pipeline/57d30a2b-8b75-4983-a1ec-8123232a7ebc" 2>/dev/null | python3 -c "
- [18:12:26] Bash: for id in 0b046595-089f-4599-97a1-516d3d546369 57d30a2b-8b75-4983-a1ec-8123232a7ebc f848d60e-1e80-40a5-ab81-4f6fa88c5111
- [18:12:33] Bash: curl -s "https://ff-pipeline.koales.workers.dev/debug/pipeline?id=0b046595-089f-4599-97a1-516d3d546369" 2>/dev/null | py
- [18:12:35] Bash: curl -s "https://ff-pipeline.koales.workers.dev/debug/governor" 2>/dev/null | python3 -c "
import sys, json
d = json.loa
- [18:12:41] Bash: curl -s "https://ff-pipeline.koales.workers.dev/debug/crystallizer?signal=latest" 2>/dev/null | python3 -c "
import sys,
- [18:12:42] Bash: curl -s "https://ff-pipeline.koales.workers.dev/debug/queues" 2>/dev/null | python3 -c "
import sys, json
try:
  d = jso
- [18:12:52] Bash: curl -s "https://ff-gateway.koales.workers.dev/pipeline/0b046595-089f-4599-97a1-516d3d546369" 2>/dev/null | python3 -c "
- [18:13:00] Bash: grep -rn "signalType\|signal_type\|SignalType" /Users/wes/Developer/function-factory/workers/ff-gateway/src/ --include="
- [18:13:01] Bash: grep -rn "signalType\|required.*field" /Users/wes/Developer/function-factory/workers/ff-pipeline/src/ --include="*.ts" |
- [18:13:12] Bash: ID1=$(curl -s -X POST "https://ff-gateway.koales.workers.dev/pipeline" \
  -H "Content-Type: application/json" \
  -d '{
- [18:13:17] Bash: ID2=$(curl -s -X POST "https://ff-gateway.koales.workers.dev/pipeline" \
  -H "Content-Type: application/json" \
  -d '{
- [18:13:19] Bash: ID3=$(curl -s -X POST "https://ff-gateway.koales.workers.dev/pipeline" \
  -H "Content-Type: application/json" \
  -d '{
- [18:18:05] Bash: for id in 38eb0342-f210-4ef8-b063-c907ebabefe5 9bb2165a-a98e-4170-aab5-da3a04d79ecf 14638de4-3c81-4664-a089-27e34bb2f5d4
- [18:18:14] Bash: curl -s "https://ff-pipeline.koales.workers.dev/debug/health" 2>/dev/null | python3 -c "
import sys, json
try:
  d = jso
- [18:18:15] Bash: curl -s "https://ff-pipeline.koales.workers.dev/debug/synthesis?limit=5" 2>/dev/null | python3 -c "
import sys, json
try
- [18:18:23] Bash: grep -rn "running\|currentStage\|step.do" /Users/wes/Developer/function-factory/workers/ff-pipeline/src/pipeline.ts | he
- [18:18:37] Bash: git log --oneline -5 && echo "---" && curl -s "https://ff-pipeline.koales.workers.dev/version" 2>/dev/null || echo "No v
- [18:18:44] Bash: grep -n "wrangler\|deploy" /Users/wes/Developer/function-factory/workers/ff-pipeline/package.json | head -5
- [18:18:55] Bash: curl -s "https://ff-gateway.koales.workers.dev/pipeline/38eb0342-f210-4ef8-b063-c907ebabefe5" 2>/dev/null | python3 -c "

## Notes
This file is auto-updated on session end. Manual edits will be overwritten.
Archive to `.agent/memory/episodic/snapshots/` if you need to preserve a specific state.
