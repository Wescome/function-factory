# Roadmap — 003-flue-retirement

> Feature: Retire `@flue/runtime`; migrate atom execution to Cloudflare Agents SDK + Project Think (Option B)
> Generated: 2026-06-12 | Anchored on: requirements.md (0 open points)

---

## 1. Approach Summary

This is a **substrate swap** inside `@factory/gears`. The execution model changes underneath the CoordinatorDO dispatch boundary; nothing above it (CoordinatorDO, KSP packages, Mastra T1/T4, pipeline routing) is touched.

**Before:**
```
CoordinatorDO → /execute → FlueAtomExecutionWorkflow (Flue DO)
  └─ init(AgentProfile) → harness.session() → session.skill(skillRef) → session.prompt(...)
```

**After:**
```
CoordinatorDO → /execute → ThinkExecutor DO (Think substrate)
  └─ executeAtom() → buildConductingAgent() [local] → mastraAgent.generate() inside runFiber()
       └─ tools: createWorkspaceTools / createExecuteTool / createSandboxTools (Think tool factories)
```

The entry point (`/execute`) and the exit points (`/release`, `/fail` on CoordinatorDO) are structurally identical. The caller (`queue-handler.ts`, `trigger-synthesis-handler.ts`) changes only the dispatch target, not the contract shape.

---

## 2. Delta — Files Deleted

| Path | Reason |
|------|--------|
| `packages/gears/src/flue/` (entire dir) | Flue wrapping layer retired |
| `packages/gears/src/flue/agents.ts` | `PROFILE_BY_ROLE` replaced by `MODEL_BY_ROLE` in new agents module |
| `packages/gears/src/flue/sandbox.ts` | Sandbox host injection replaced by `createSandboxTools()` |
| `packages/gears/src/flue/index.ts` | Barrel for retired directory |
| `packages/gears/src/flue/workflows/atom-execution.ts` | Replaced by `think-executor.ts` + `conducting-agent.ts` |
| `packages/gears/src/flue/workflows/atom-execution-do.ts` | Retired Flue workflow DO |

---

## 3. Delta — Files Created

| Path | Description |
|------|-------------|
| `packages/gears/src/agents/conducting-agent.ts` | `buildConductingAgent()` — Mastra Agent factory |
| `packages/gears/src/agents/think-executor.ts` | `ThinkExecutor extends Think<Env>` — durable execution substrate DO |
| `packages/gears/src/agents/models.ts` | `MODEL_BY_ROLE` map (replaces `PROFILE_BY_ROLE` from agents.ts) |
| `packages/gears/src/processors/consent-bead-audit-processor.ts` | Mastra `BaseProcessor` subclass — I4 enforcement |

---

## 4. Delta — Files Modified

| Path | Change |
|------|--------|
| `packages/gears/src/index.ts` | Remove flue exports; add agents + ThinkExecutor exports |
| `packages/gears/package.json` | Remove `@flue/runtime`; add `agents`, `@cloudflare/think`, `@cloudflare/shell`, `@cloudflare/codemode`, `@cloudflare/worker-bundler`, `@mastra/core`, `@mastra/memory`, `@mastra/cloudflare-d1` |
| `workers/ff-pipeline/src/cloudflare.ts` | Replace `Sandbox` / Flue DO exports with `ThinkExecutor` export |
| `workers/ff-pipeline/wrangler.jsonc` | Remove Flue bindings; add `THINK_EXECUTOR` DO binding, migration `v2` (`new_sqlite_classes: ["ThinkExecutor"]`), `worker_loaders` binding `LOADER` |
| `workers/ff-pipeline/src/queue-handler.ts` | Dispatch target: `ThinkExecutor.executeAtom()` via `env.THINK_EXECUTOR` stub |
| `workers/ff-pipeline/src/trigger-synthesis-handler.ts` | Same dispatch change |
| `workers/ff-pipeline/src/queue-bridge.test.ts` | Delete 3 dead `@flue/runtime` `vi.mock` blocks (~lines 72–94) |

---

## 5. Delta — Architecture

**SDD reference:** `_reversa_sdd/architecture.md#KSP Layer`, `_reversa_sdd/ksp-gears/design.md#2. Package Structure`

Change to `@factory/gears` purpose statement 🟢:
> Before: "wraps the Flue runtime, hosts per-run execution-trace bead store (CoordinatorDO), provides gear registry vocabulary"
> After: "is the Mastra Agent execution harness; hosts CoordinatorDO (per-run bead store), Think-based durable execution substrate (ThinkExecutor), gear registry vocabulary. Consumers never import `@cloudflare/think`, `@cloudflare/shell`, or `@cloudflare/sandbox` directly."

New package dependency in `_reversa_sdd/dependencies.md`:
```
@factory/gears → @mastra/core, @mastra/memory, @mastra/cloudflare-d1
                  agents (CF Agents SDK), @cloudflare/think, @cloudflare/shell,
                  @cloudflare/codemode, @cloudflare/worker-bundler
```

Phase 5 in the KSP package build order changes:
> Before: `.flue/workflows` (Flue workflow layer — Phase 5)
> After: `ThinkExecutor` + `ConductingAgent` (in `@factory/gears` — Phase 4, no separate phase needed)

**ADR to add:** ADR-014 — Substrate migration from Flue to Cloudflare Agents SDK + Project Think.

---

## 6. Delta — Contracts / Interfaces

**No external contract changes.** The CoordinatorDO fetch handler routes (`/init`, `/claim`, `/release`, `/fail`, `/next`) are unchanged. `AtomExecutionPayload` and `AtomDirective` schemas are unchanged. The entry contract for atom dispatch (request body shape, caller identity, error responses) is preserved — only the internal dispatch target moves from a Flue Workflow DO to `ThinkExecutor`.

**wrangler.jsonc additive delta** (internal, not external contract):
```jsonc
// Remove:
// { "name": "Sandbox", "class_name": "Sandbox" } — retired Flue sandbox binding

// Add to durable_objects.bindings:
{ "name": "THINK_EXECUTOR", "class_name": "ThinkExecutor" }

// Add to migrations (new tag after existing v1):
{ "tag": "v2", "new_sqlite_classes": ["ThinkExecutor"] }

// Add:
"worker_loaders": [{ "binding": "LOADER" }]
```

---

## 7. Delta — Data

**No schema changes.** CoordinatorDO SQLite schema (`execution_beads`, `work_graph`) is unchanged. D1 `factory-bead-audit` schema is unchanged. KV key patterns are unchanged. `ThinkExecutor` uses its own DO SQLite via `@cloudflare/shell` workspace — managed internally, not exposed to other packages. See `data-delta.md` for full diff.

---

## 8. State Machine Impact

**SM-6 (ExecutionBead Status)** — unchanged. Transitions `ready → in_progress → done/failed` are driven by `claimHook()` / `releaseHook()` / `failHook()` calls from `ThinkExecutor.executeAtom()` via the existing `hook.ts` wrappers. The stale-bead re-hook via `CoordinatorDO.alarm()` is unchanged and is now the recovery path for `onFiberRecovered` (ThinkExecutor defers re-dispatch to it explicitly).

**SM-7 (Autonomy Floor Degradation)** — unchanged. `AutonomyDegradedError` from `retrieveKnowingState()` propagates through `executeAtom()` the same way; `ThinkExecutor` does not swallow it.

---

## 9. I4 Enforcement Chain (Consent — NFR-02)

**Enforcement layer:** Mastra `outputProcessors` exclusively. No Think-layer hook required.

```
LLM generates tool call
   ↓
Mastra processOutputStep fires BEFORE tool dispatch
   ↓
ConsentBeadAuditProcessor
  - writes ConsentBead (append-only, BeadGraphDO)
  - checks tool name against directive.permittedTools
  - throws ConsentDeniedError if not in allowlist
   ↓
ToolCallFilter (secondary gate — belt-and-suspenders)
  - checks same allowlist, throws if not allowed
   ↓
Tool executor (ThinkExecutor workspace/codemode/sandbox tools)
  - only reached if both processors cleared the call
```

This satisfies I4 (fail-closed coupling) from `_reversa_sdd/architecture.md#Architectural Thesis`. 🟢

---

## 10. Implementation Order

| Step | Action | Gate | FR |
|------|--------|------|----|
| 1 | `pnpm remove @flue/runtime`; add CF + Mastra packages | `tsc --noEmit` (expect import errors) | FR-01, FR-07 |
| 2 | Delete `packages/gears/src/flue/` | All Flue imports now fail — clean cut confirmed | FR-01 |
| 3 | Create `models.ts` (`MODEL_BY_ROLE`) + `consent-bead-audit-processor.ts` | `tsc --noEmit` | FR-02, NFR-02 |
| 4 | Create `conducting-agent.ts` (`buildConductingAgent()`) | `tsc --noEmit` | FR-02, FR-09 |
| 5 | Create `think-executor.ts` (`ThinkExecutor`) | `tsc --noEmit` | FR-03 |
| 6 | Update `packages/gears/src/index.ts` barrel | `tsc --noEmit` | FR-01 |
| 7 | Update `workers/ff-pipeline/src/cloudflare.ts` + `wrangler.jsonc` | `wrangler dev` starts | FR-07 |
| 8 | Update `queue-handler.ts` + `trigger-synthesis-handler.ts`; delete `vi.mock` blocks in `queue-bridge.test.ts` | `pnpm test` (26/26 pass + no vi.mock blocks) | FR-06 |
| 9 | Smoke test: single atom end-to-end | AC-1 passes | all FRs |
| 10 | Kill-and-recover test: evict mid-stream | AC-2 passes | NFR-01 |
| 11 | I4 enforcement test | AC-6 passes | NFR-02 |
| 12 | Update WEO-7, WEO-8, WEO-9, WEO-12, WEO-15 in Linear | Issues unblocked | FR-10 |

---

## 11. Risks

| Risk | Severity | Mitigation |
|------|----------|-----------|
| `@cloudflare/think` is experimental (CF blog) | Medium | CF uses it internally. Active changelog v0.12.4 May 2026. Lower risk than Flue (no production SLA). |
| `session.withSkill()` path format differs from `session.skill()` | Low | Verify in `@cloudflare/think` source before step 5 implementation. Same `.agents/skills/` root expected. |
| Mastra `processOutputStep` timing assumption (fires before tool dispatch) | Low | Verify against `@mastra/core` source — confirmed in D-2 resolution. Document the version pinned. |
| `runFiber()` stash/recovery under mid-stream eviction | Medium | Step 10 kill test is mandatory, not optional, before declaring done. |
| BR-FLUE-04 (kimi-k2.6 gateway bypass) not carried forward | High | `MODEL_BY_ROLE` coder entry must preserve `gateway: false` equivalent. Verify in step 3. |

---

## 12. Criterion for Done

1. `grep -r "@flue/runtime" packages/ workers/` → zero hits (outside docs/comments)
2. `tsc --noEmit` → zero errors repo-wide
3. `pnpm test` → all 26 previously-passing tests still pass; no new failures
4. AC-1 (end-to-end smoke), AC-2 (kill-and-recover), AC-6 (I4 enforcement) all pass
5. WEO-7/8/9/12/15 updated in Linear

---

## 13. Principles Applied

No `principles.md` found in this repo. Relevant architectural invariants from `_reversa_sdd/architecture.md#Architectural Thesis` applied instead:

| Invariant | Status |
|-----------|--------|
| I1 — Externalization | Preserved — knowing-state stays in BeadGraphDO |
| I2 — Retrieval enforcement | Preserved — `retrieveKnowingState()` called at execution moment |
| I3 — Continuous maintenance | Preserved — maintenance relation unchanged |
| I4 — Fail-closed coupling | Preserved and clarified — Mastra `outputProcessors` is sole enforcement layer |
