# Actions — 003-flue-retirement

> Feature: Retire `@flue/runtime`; migrate atom execution to Cloudflare Agents SDK + Project Think (Option B)
> Generated: 2026-06-12 | Source: roadmap.md §10

**Summary**
- Total actions: 22
- Parallelizable (`[//]`): 5
- Longest dependency chain: T001 → T002 → T003 → T004 → T005 → T006 → T007 → T008 → T009 → T010 → T012 → T013 (12 steps)

---

## Phase 1 — Preparation

| ID | Description | Dependencies | `[//]` | File target | Confidence | Status |
|----|-------------|--------------|--------|-------------|------------|--------|
| T001 | Remove `@flue/runtime` from `packages/gears/package.json`. Add: `agents@latest`, `@cloudflare/think@latest`, `@cloudflare/shell`, `@cloudflare/codemode`, `@cloudflare/worker-bundler`, `@mastra/core`, `@mastra/memory`, `@mastra/cloudflare-d1`. Run `pnpm install`. Gate: `pnpm install` exits 0. | — | — | `packages/gears/package.json` | 🟢 | [X] |
| T002 | Delete entire `packages/gears/src/flue/` directory (agents.ts, index.ts, sandbox.ts, workflows/). Do not create any replacement files yet — this step confirms the clean cut by making all `@flue/runtime` imports fail. Gate: `grep -r "@flue/runtime" packages/gears/src` returns zero hits. | T001 | — | `packages/gears/src/flue/` | 🟢 | [X] |

---

## Phase 2 — Tests

| ID | Description | Dependencies | `[//]` | File target | Confidence | Status |
|----|-------------|--------------|--------|-------------|------------|--------|
| T003 | Delete 3 dead `@flue/runtime` `vi.mock` blocks from `workers/ff-pipeline/src/queue-bridge.test.ts` (~lines 72–94). These are already stale and will error once Flue is removed. Gate: `grep "vi.mock.*flue" workers/ff-pipeline/src/queue-bridge.test.ts` returns zero hits. | T002 | — | `workers/ff-pipeline/src/queue-bridge.test.ts` | 🟢 | [X] |

---

## Phase 3 — Core

| ID | Description | Dependencies | `[//]` | File target | Confidence | Status |
|----|-------------|--------------|--------|-------------|------------|--------|
| T004 | Create `packages/gears/src/agents/models.ts`. Export `MODEL_BY_ROLE` mapping each role to its Mastra-compatible model config. Carry forward exact model IDs from retired `agents.ts`: planner→`anthropic/claude-opus-4-6`, coder→`cloudflare/@cf/moonshotai/kimi-k2.6` with `gateway: false` equivalent (direct Workers AI binding — BR-FLUE-04), critic/tester/verifier→`openai/gpt-5.5`. Export `RoleName` type. Gate: `tsc --noEmit` on `packages/gears/`. | T002 | — | `packages/gears/src/agents/models.ts` | 🟢 | [X] |
| T005 | Create `packages/gears/src/processors/consent-bead-audit-processor.ts`. Implement `ConsentBeadAuditProcessor extends BaseProcessor` (from `@mastra/core`). Logic: on `processOutputStep`, for each tool call in the output, (1) write a ConsentBead to `BeadGraphDO` via `coordinatorDO` reference, (2) check tool name against `directive.permittedTools`; if not in allowlist, throw `ConsentDeniedError`. Receives `coordinatorDO` stub and `directive` in constructor. Gate: `tsc --noEmit`. | T004 | — | `packages/gears/src/processors/consent-bead-audit-processor.ts` | 🟢 | [X] |
| T006 | Create `packages/gears/src/agents/conducting-agent.ts`. Export `buildConductingAgent(directive, coordinatorDO, thinkExecutorDO, env): Agent`. Wire: model from `MODEL_BY_ROLE[directive.role]`; instructions from `buildSystemPrompt(directive)` (inline helper — reads `directive.workspaceContext`); tools async resolver using `requestContext` calling `createWorkspaceTools(thinkExecutorDO)`, `createExecuteTool({tools, loader: env.LOADER})`, `createSandboxTools(env.SANDBOX)`; memory as `new Memory({storage: new D1Store({binding: env.DB}), options: {observationalMemory: {model: new ModelByInputTokens({upTo: {10_000: 'google/gemini-2.5-flash', 40_000: 'openai/gpt-4o', 1_000_000: 'openai/gpt-4.5'}})}}})`. inputProcessors and outputProcessors chains per requirements FR-09 and NFR-02. Gate: `tsc --noEmit`. | T005 | — | `packages/gears/src/agents/conducting-agent.ts` | 🟢 | [X] |
| T007 | Create `packages/gears/src/agents/think-executor.ts`. `class ThinkExecutor extends Think<Env>` — no `getModel()`. Implement `executeAtom(directive, coordinatorDO)`: (1) call `buildConductingAgent(directive, coordinatorDO, this.stub, this.env)` locally; (2) wrap `mastraAgent.generate(buildAtomPrompt(directive), {threadId: directive.runId, resourceId: directive.orgId, requestContext: new Map([['directive', directive]])})` inside `this.runFiber('atom-execution', async (ctx) => { ctx.stash({atomId: directive.atomId, runId: directive.runId}); ... })`. (3) evaluate `successCondition` against `this.workspace`. (4) POST `/release` or `/fail` to `coordinatorDO`. Implement `onFiberRecovered`: do NOT re-run the atom — log only; CoordinatorDO stale-bead alarm handles re-dispatch. Gate: `tsc --noEmit`. | T006 | — | `packages/gears/src/agents/think-executor.ts` | 🟢 | [X] |
| T008 | Update `packages/gears/src/index.ts` barrel. Remove all `./flue/*` exports. Add exports: `ThinkExecutor` from `./agents/think-executor.js`, `buildConductingAgent` from `./agents/conducting-agent.js`, `MODEL_BY_ROLE`, `RoleName` from `./agents/models.js`, `ConsentBeadAuditProcessor` from `./processors/consent-bead-audit-processor.js`. Preserve all `./beads/*`, `./gears/*`, `./skills/*` exports. Gate: `tsc --noEmit` zero errors on `packages/gears/`. | T007 | — | `packages/gears/src/index.ts` | 🟢 | [X] |

---

## Phase 4 — Integration

| ID | Description | Dependencies | `[//]` | File target | Confidence | Status |
|----|-------------|--------------|--------|-------------|------------|--------|
| T009 | Update `workers/ff-pipeline/src/cloudflare.ts`. Remove `export { Sandbox } from '@factory/gears/flue'` and Flue DO exports. Add `export { ThinkExecutor } from '@factory/gears'`. Keep all other exports (`CoordinatorDO`, `MediationAgentDO`, `ArchitectAgentDO`, KSP DO classes). Gate: `tsc --noEmit`. | T008 | — | `workers/ff-pipeline/src/cloudflare.ts` | 🟢 | [X] |
| T010 | Update `workers/ff-pipeline/wrangler.jsonc`. (a) In `durable_objects.bindings`: remove `{ "name": "Sandbox", "class_name": "Sandbox" }`; add `{ "name": "THINK_EXECUTOR", "class_name": "ThinkExecutor" }`. (b) Add migration tag `v2`: `{ "tag": "v2", "new_sqlite_classes": ["ThinkExecutor"] }` (after existing `v1` entry). (c) Add `"worker_loaders": [{ "binding": "LOADER" }]`. (d) Add `{ "binding": "DB", ... }` D1 entry for Mastra Memory if not already present. Gate: `wrangler dev` starts without binding errors. | T009 | — | `workers/ff-pipeline/wrangler.jsonc` | 🟢 | [X] |
| T011 | Update `workers/ff-pipeline/src/queue-handler.ts`. Replace Flue/workflow dispatch with `ThinkExecutor` DO dispatch: obtain `ThinkExecutor` stub from `env.THINK_EXECUTOR`, call `stub.executeAtom(directive, coordinatorDOStub)`. Keep type-only static imports; all CF-runtime dependencies (`@factory/gears`, `@cloudflare/*`) deferred via `await import()` (BR-FLUE-06). Gate: `tsc --noEmit`. | T010 | [//] | `workers/ff-pipeline/src/queue-handler.ts` | 🟢 | [X] |
| T012 | Update `workers/ff-pipeline/src/trigger-synthesis-handler.ts`. Same dispatch change as T011 — replace Flue/workflow dispatch with `ThinkExecutor` DO stub call. Maintain type-only static imports and `await import()` pattern (BR-FLUE-06). Gate: `tsc --noEmit`. | T010 | [//] | `workers/ff-pipeline/src/trigger-synthesis-handler.ts` | 🟢 | [X] |
| T013 | Run full test suite. Gate: `pnpm -r test` — all 26 previously-passing `workers/ff-pipeline` tests still pass, zero new failures. `queue-bridge.test.ts` has no `vi.mock('@flue/runtime')` blocks (verified in T003). | T011, T012 | — | (test run) | 🟢 | [X] |
| T014 | Verify clean cut end-to-end. Gate: `grep -r "@flue/runtime" packages/ workers/ --include="*.ts" --include="*.js"` returns zero hits; `pnpm -r tsc --noEmit` returns zero errors repo-wide. | T013 | — | (repo-wide) | 🟢 | [X] |
| T015 | Verify `session.withSkill()` path parity (AC-5). Read `@cloudflare/think` source to confirm `session.withSkill(skillRef)` accepts the same filesystem path format as Flue's `session.skill(skillRef)` — i.e., resolves `.agents/skills/<skillRef>/SKILL.md`. Document the confirmed version in `investigation.md` under a new §8. Gate: path confirmed in source or docs; no skill files modified. | T007 | [//] | `_reversa_forward/003-flue-retirement/investigation.md` | 🟡 | [X] |
| T016 | Smoke test — single atom end-to-end (AC-1). Dispatch a single seeded atom via queue or trigger-synthesis handler. Verify: `ThinkExecutor.executeAtom()` runs the fiber; CoordinatorDO receives `/release`; D1 `factory-bead-audit` row written; no `@flue/runtime` code executed. Gate: AC-1 passes. | T014 | — | (manual test) | 🟢 | [ ] |
| T017 | Kill-and-recover test (AC-2, NFR-01). In a live CF environment, dispatch a long-running atom; evict the Worker mid-stream; verify `onFiberRecovered` fires (log); verify stale-bead alarm re-dispatches; verify atom completes. Gate: AC-2 passes; atom never left in `in_progress`; no double-execution. | T016 | — | (manual test) | 🟢 | [ ] |
| T018 | I4 enforcement test (AC-6, NFR-02). Dispatch an atom with `permittedTools: ['workspace_read']`. The LLM will attempt a disallowed tool call. Verify: `ConsentBeadAuditProcessor` throws before tool execution; CoordinatorDO receives `/fail`; bead transitions to `failed` per SM-6; tool never executes. Gate: AC-6 passes. | T016 | [//] | (manual test) | 🟢 | [ ] |
| T019 | kimi-k2.6 gateway bypass verification (NFR-03, BR-FLUE-04). Dispatch one atom with `role: 'coder'`. Verify: the model binding for kimi-k2.6 does NOT route through the Cloudflare AI Gateway (direct Workers AI binding). Gate: no stream-hang observed; AI Gateway logs show no kimi-k2.6 request (or bypass confirmed via binding config). | T016 | [//] | (manual test + config) | 🟢 | [ ] |

---

## Phase 5 — Polish

| ID | Description | Dependencies | `[//]` | File target | Confidence | Status |
|----|-------------|--------------|--------|-------------|------------|--------|
| T020 | Add ADR-014 to `_reversa_sdd/adrs/`. Document: substrate migration decision (Flue → CF Agents SDK + Project Think), Option B rationale, boundary choice (Mastra owns LLM orchestration; Think owns durability), date 2026-06-12. This keeps the SDD authoritative. Gate: file written; no existing ADR file modified. | T014 | — | `_reversa_sdd/adrs/ADR-014.md` | 🟢 | [X] |
| T021 | Update `_reversa_sdd/ksp-gears/design.md` §1 purpose statement and §2 package structure to reflect the new `src/agents/` layout and removal of `src/flue/`. Non-destructive: update only the sections that changed. Gate: no new `[QUESTION]` markers introduced; document internally consistent. | T014 | — | `_reversa_sdd/ksp-gears/design.md` | 🟢 | [X] |
| T022 | Update WEO-7, WEO-8, WEO-9, WEO-12, WEO-15 in Linear. Mark Flue/Gas City execution path references as resolved. Unblock any issues blocked by this feature. Gate: 5 issues updated. | T017, T018 | — | (Linear) | 🟡 | [ ] |
