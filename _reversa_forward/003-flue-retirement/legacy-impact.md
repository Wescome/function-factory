# Legacy Impact — 003-flue-retirement

> Feature: Retire `@flue/runtime`; migrate atom execution to Cloudflare Agents SDK + Project Think (Option B)
> Date: 2026-06-12
> Source SDD: `_reversa_sdd/`

---

## Affected Files

| Arquivo afetado | Componente (`architecture.md`) | Tipo | Severidade | Justificativa |
|-----------------|-------------------------------|------|-----------|---------------|
| `packages/gears/package.json` | ksp-gears / @factory/gears | `regra-alterada` | HIGH | Removed `@flue/runtime`. Added `agents`, `@cloudflare/think`, `@cloudflare/shell`, `@cloudflare/codemode`, `@cloudflare/worker-bundler`, `@mastra/core`, `@mastra/memory`, `@mastra/cloudflare-d1`. Entire execution substrate dependency tree replaced. |
| `packages/gears/src/flue/` (deleted) | ksp-gears / Flue Substrate | `componente-extinto` | CRITICAL | Entire `flue/` directory deleted: `agents.ts`, `index.ts`, `sandbox.ts`, `workflows/`. Flue API surface (`FlueAtomExecutionWorkflow`, `FlueRegistry`, `PROFILE_BY_ROLE`) no longer exists. |
| `packages/gears/src/agents/models.ts` (new) | ksp-gears / @factory/gears | `componente-novo` | HIGH | Replaces `PROFILE_BY_ROLE` from retired `agents.ts`. `MODEL_BY_ROLE` maps roles to Mastra-compatible model configs. Model IDs carried forward exactly. |
| `packages/gears/src/agents/conducting-agent.ts` (new) | ksp-gears / @factory/gears | `componente-novo` | HIGH | `buildConductingAgent()` → Mastra `Agent`. Owns LLM loop, processors (I4 enforcement), D1-backed memory, tools resolver. |
| `packages/gears/src/agents/think-executor.ts` (new) | ksp-gears / @factory/gears | `componente-novo` | HIGH | `ThinkExecutor extends Think<Env>`. Durable execution substrate. HTTP route `/execute-atom`. No LLM loop. |
| `packages/gears/src/processors/consent-bead-audit-processor.ts` (new) | ksp-gears / @factory/gears | `componente-novo` | HIGH | `ConsentBeadAuditProcessor extends BaseProcessor`. I4 enforcement: writes ConsentBead, throws `ConsentDeniedError` if tool not in `permittedTools`. |
| `packages/gears/src/index.ts` | ksp-gears / @factory/gears | `regra-alterada` | HIGH | Removed `./flue/*` exports. Added `ThinkExecutor`, `buildConductingAgent`, `MODEL_BY_ROLE`, `RoleName`, `ConsentBeadAuditProcessor`, `ConsentDeniedError`. |
| `packages/gears/types/flue-runtime.d.ts` (deleted) | ksp-gears / @factory/gears | `componente-extinto` | LOW | Dead type stub file. Removed. |
| `workers/ff-pipeline/src/index.ts` | ff-pipeline Worker | `regra-alterada` | HIGH | Removed `FlueAtomExecutionWorkflow`, `FlueRegistry`, `Sandbox` exports. Added `ThinkExecutor`. Removed Flue routing block from fetch handler (`routeAtomExecutionWorkflow`). |
| `workers/ff-pipeline/src/types.ts` | ff-pipeline Worker | `regra-alterada` | MEDIUM | Added `THINK_EXECUTOR?: DurableObjectNamespace`. Removed `FLUE_ATOM_EXECUTION_WORKFLOW?`, `FLUE_REGISTRY?`. |
| `workers/ff-pipeline/wrangler.jsonc` | ff-pipeline Worker | `delta-de-contrato-externo` | HIGH | Removed Sandbox DO binding + migration. Added `THINK_EXECUTOR` binding + v2 migration (`new_sqlite_classes: ["ThinkExecutor"]`). Added `worker_loaders`. |
| `workers/ff-pipeline/src/queue-handler.ts` | ff-pipeline / Queue Consumer | `regra-alterada` | HIGH | `atom-execute` branch: replaced `ATOM_EXECUTOR` DO dispatch with `THINK_EXECUTOR` DO dispatch. DO naming: `atom-${...}` → `think-${...}`. Dispatch method: JSON POST to `/execute-atom`. |
| `workers/ff-pipeline/src/trigger-synthesis-handler.ts` | ff-pipeline / HTTP Routes | `regra-alterada` | LOW | Comment-only: removed Flue DO/Workflow class references from file header. No logic changes. |
| `workers/ff-pipeline/src/queue-bridge.test.ts` | ff-pipeline / Tests | `regra-alterada` | MEDIUM | Updated `atom-execute` test suite: `ATOM_EXECUTOR` → `THINK_EXECUTOR` mock binding; `atom-${...}` → `think-${...}` DO naming; assertion descriptions updated. |
| `_reversa_sdd/adrs/ADR-014-*.md` (new) | SDD | `componente-novo` | LOW | ADR documenting Flue retirement decision, Option B rationale, boundary choice. |
| `_reversa_sdd/ksp-gears/design.md` | SDD | `regra-alterada` | LOW | Updated §1, §2, §3, §6, §9 to reflect new `src/agents/` layout, removed `src/flue/`, new dependency list, and wrangler.jsonc changes. |

---

## Diff Conceitual por Componente

### ksp-flue-workflow → EXTINTO

`packages/gears/src/flue/` is fully deleted. `FlueAtomExecutionWorkflow`, `FlueRegistry`, all Flue workflow types and session primitives are gone. The execution substrate is now owned by `ThinkExecutor extends Think<Env>` and `buildConductingAgent()` (Mastra Agent).

No replacement for `FlueAtomExecutionWorkflow.run()` — the loop is now driven by Mastra Agent's `generate()` inside `ThinkExecutor.executeAtom()` via `runFiber()`.

### @factory/gears substrate boundary — REWRITTEN

The package now owns three new collaborating components instead of one monolithic Flue wrapper:
1. `ThinkExecutor` (durable substrate — no LLM)
2. `buildConductingAgent` (LLM orchestration — no durability)
3. `ConsentBeadAuditProcessor` (I4 enforcement — stateless, per-directive)

The `MODEL_BY_ROLE` map replaces `PROFILE_BY_ROLE`. Model IDs are identical; only the configuration shape changes (Mastra-compatible vs. Flue AgentProfile).

### ff-pipeline queue dispatch — UPDATED

`atom-execute` queue messages now dispatch to `ThinkExecutor` DO via HTTP POST to `/execute-atom`. DO identifier changes from `atom-${executableSpecificationId}-${atomId}` to `think-${executableSpecificationId}-${atomId}`. The `atomSpec` JSON is the request body.

### I4 enforcement — STRENGTHENED

`ConsentBeadAuditProcessor` is the single authoritative I4 enforcement point. It runs in Mastra `outputProcessors` — after LLM response, before tool dispatch. This is structurally fail-closed: no LLM output with a denied tool can reach the tool executor.

Previously, I4 enforcement was gated on Flue's `beforeToolCall()` hook. That hook no longer exists; the Mastra processor chain is the sole enforcement path.

---

## Preservadas

Rules that remain intact after this feature:

| Regra | Origem |
|-------|--------|
| BR-FLUE-04: kimi-k2.6 must bypass AI Gateway (`gateway: false`) | `MODEL_BY_ROLE['coder']` carries this forward via direct Workers AI binding. Preserved. |
| BR-FLUE-06: Handler modules must have clean import graphs | `queue-handler.ts` and `trigger-synthesis-handler.ts` still use only type-only static imports; all CF-runtime deps deferred via `await import()`. Preserved. |
| `CoordinatorDO` bead state machine (ready → in_progress → done | failed) | No changes to `coordinator-do.ts`. Preserved. |
| D1 `bead_audit` append-only rule | `releaseHook` and `failHook` still call `CoordinatorDO` which calls `writeAudit`. Preserved. |
| `executor-do` naming convention: `coordinator:${runId}` | `ThinkExecutor.executeAtom()` uses `idFromName(`coordinator:${directive.runId}`)`. Preserved. |
| AtomDirective schema fields | No schema changes. `directive.role`, `directive.runId`, `directive.repoId`, `directive.atomId`, `directive.directiveId`, `directive.successCondition` all used as before. |

---

## Modificadas

Rules that changed as a result of this feature:

| Regra | Mudança |
|-------|---------|
| BR-FLUE-01: `FlueAtomExecutionWorkflow` lives in `@factory/gears` | **REGRA-REMOVIDA**: `FlueAtomExecutionWorkflow` and `FlueRegistry` no longer exist. Replaced by: `ThinkExecutor` lives in `@factory/gears` and is re-exported by `ff-pipeline/index.ts`. |
| BR-FLUE-02: `seedBeads()` required before `getNextReady()` | **REGRA-REMOVIDA**: `ThinkExecutor` does not call `getNextReady()` or `seedBeads()`. Atom dispatch is queue-driven; CoordinatorDO `getNextReady()` is called by the queue consumer before dispatch, not by the executor. |
| BR-FLUE-03: Only `atom-execution` workflow is specced | **REGRA-REMOVIDA**: No Flue workflows remain. `ThinkExecutor.executeAtom()` is the sole execution entry point. |
| `ATOM_EXECUTOR` wrangler binding | **DELTA-DE-CONTRATO-EXTERNO**: Binding name changed to `THINK_EXECUTOR`. DO class changed from `FlueAtomExecutionWorkflow` to `ThinkExecutor`. SQLite migration tag updated to `v2`. |
| DO identifier for atom execution | **REGRA-ALTERADA**: `atom-${executableSpecificationId}-${atomId}` → `think-${executableSpecificationId}-${atomId}`. |
| `session.skill(skillRef)` path resolution | **REGRA-REMOVIDA**: Flue's `session.skill(skillRef)` (resolves `.agents/skills/<skillRef>/SKILL.md`) has no direct equivalent in `@cloudflare/think`. The SDK uses a `getSkills(): SkillSource[]` registry model. Any Factory code using path-based skill invocation must migrate (tracked separately — not blocking this feature). |
