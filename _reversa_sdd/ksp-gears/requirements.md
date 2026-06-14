# Requirements — @factory/gears

> Module: ksp-gears | Package: `@factory/gears`
> doc_level: completo | Generated: 2026-06-10
> Source: SPEC-FF-GEARS-001, domain.md (KSP section), architecture.md (KSP Layer section)

---

## Functional Requirements

### FR-01: Absorb Three Retired Concerns into One Package
🟢 confidence | Source: SPEC-FF-GEARS-001 §1

`@factory/gears` consolidates three previously separate concerns into a single package:
- Flue wrapping (replaces `@factory/harness-bridge` and Gas City pi-coding-agent)
- Execution-Trace Bead Graph (replaces `@factory/runtime` stub and Gas City JSONL + flock task store)
- Gear Registry (ports Gas City Pack/Formula/Molecule vocabulary to typed D1-backed artifacts)

Consumers import `@factory/gears`. They never import `@flue/runtime` or `@cloudflare/sandbox` directly.

**MoSCoW: Must** — foundational consolidation; all downstream packages depend on this.

---

### FR-02: Define Five Dark Factory Agent Profiles (GD-001 Option A)
🟢 confidence | Source: SPEC-FF-GEARS-001 §6, §2 (GD-001)

Static `defineAgentProfile` exports for five roles: `planner`, `coder`, `critic`, `tester`, `verifier`. Loaded at package load time. Dynamic per-candidate model binding is deferred until the Architect Agent DO is operational.

Model assignments:
- `planner` and `coder`: `anthropic/claude-opus-4-6`
- `critic`, `tester`, `verifier`: `openai/gpt-5.5`

Export `PROFILE_BY_ROLE` map for role-based profile selection. The `deriveRole()` heuristic is deleted (BR-KSP-19).

**MoSCoW: Must** — required for Flue workflow role selection.

---

### FR-03: Provide Single Sandbox Class with All Outbound Host Injectors (GD-005)
🟢 confidence | Source: SPEC-FF-GEARS-001 §6

Extend `@cloudflare/sandbox` `Sandbox` class. Provide `static outboundByHost` map with four host injectors:
- `api.anthropic.com` → injects `x-api-key: ANTHROPIC_API_KEY`
- `api.openai.com` → injects `Authorization: Bearer OPENAI_API_KEY`
- `api.deepseek.com` → injects `Authorization: Bearer DEEPSEEK_API_KEY`
- `api.github.com` → injects `Authorization: Bearer GITHUB_TOKEN`

Per-role gating is handled at application layer via `toolPolicy`. The Sandbox class itself applies no per-role restrictions.

**MoSCoW: Must** — required for agent outbound calls within Cloudflare Sandbox.

---

### FR-04: Provide Gear, GearFormula, GearMolecule Zod Schemas
🟢 confidence | Source: SPEC-FF-GEARS-001 §3–4

`src/gears/types.ts` defines three typed artifacts:
- `Gear` — role-bound execution unit with `skillRef`, `toolPolicy`, `beadType`, `source_refs`
- `GearFormula` — named sequence of gears with dependency edges
- `GearMolecule` — instantiated bead set from a formula, keyed by `runId`

Content-addressed IDs: `GEAR-*`, `FORMULA-*`, `MOLECULE-*` prefixes.

**MoSCoW: Must** — canonical gear vocabulary consumed by Mediation Agent compile step.

---

### FR-05: CoordinatorDO — One DO Per WorkGraph Execution (GD-002 Option B)
🟢 confidence | Source: SPEC-FF-GEARS-001 §7, domain.md BR-KSP-16

One Durable Object per WorkGraph execution. DO key: `coordinator:{runId}`. `runId = SHA-256(workGraphId + workGraphVersion)` — deterministic and re-attachable after crash.

The DO exposes the following HTTP endpoints (consumed via `DurableObjectStub`):
- `POST /init` — stores `runId` and `orgId`; idempotent
- `POST /claim` — claims a bead (atomic CAS)
- `POST /release` — marks bead `done`, writes audit, records outcome
- `POST /fail` — marks bead `failed`, writes audit, records outcome
- `POST /next` — returns next ready bead for a molecule (respects dependency edges)

**MoSCoW: Must** — central execution substrate.

---

### FR-06: initRun() Must Be Called Before getNextReady() (BR-KSP-16)
🟢 confidence | Source: SPEC-FF-GEARS-001 §7b (Gap 6), domain.md BR-KSP-16

`CoordinatorDO.initRun(runId, orgId)` stores both fields to DO storage (`ctx.storage.put`). On DO eviction and restart, `blockConcurrencyWhile` restores them. `writeAudit()` and `recordOutcome()` silently skip if `runId` is not yet set (guards against pre-init calls).

The `atom-execution.ts` workflow calls `POST /init` before calling `POST /next` on every invocation.

**MoSCoW: Must** — invariant violation: calling `getNextReady()` before `initRun()` produces an audit log without `runId` context.

---

### FR-07: writeAudit() Is Fully Implemented — Not a Stub (BR-KSP-17)
🟢 confidence | Source: SPEC-FF-GEARS-001 §7b (Gap 1), domain.md BR-KSP-17

`CoordinatorDO.writeAudit()` writes a row to the D1 `bead_audit` table in `D1_AUDIT` binding. Fields written: `run_id`, `bead_id`, `gear_id`, `agent_id`, `verdict`, `attempt`, `ts`. This is the cross-run append-only compliance log.

Any implementation that leaves this as a no-op or stub violates the audit requirement.

**MoSCoW: Must** — compliance requirement; append-only cross-run record.

---

### FR-08: recordOutcome() Wires LoopClosureService Bridge Point 3
🟢 confidence | Source: SPEC-FF-GEARS-001 §7b (Gaps 1+5), domain.md BR-KSP-14

On `releaseBead()` and `failBead()`, `CoordinatorDO.recordOutcome()` instantiates `LoopClosureService` from `@factory/loop-closure` and calls `loopClosure.recordOutcome(...)` with the `ConductingAgentTraceFragment` parsed from `resultJson`. This wires Bridge Point 3 of SPEC-KSP-LOOP-CLOSURE-001.

**Dependency gate**: This wiring must NOT be implemented until `ksp-loop-closure` Step 26 is green (all five bridge-point tests passing). This is a hard sequencing gate (BR-KSP-14).

`LoopClosureService` is constructed with:
- `artifactGraphDO` — stub for `FactoryArtifactGraphDO` namespaced as `factory:{orgId}:{runId}`
- `beadGraphDO` — stub for `FactoryBeadGraphDO` namespaced as `{orgId}`
- `kvStore` — `KV` namespace binding
- `detectDivergences` — `factoryDivergenceDetector`
- `buildHypothesis` — `factoryHypothesisBuilder`
- `verifyAmendment` — `factoryAmendmentVerifier`

**MoSCoW: Must** — required for BuildOutcomeBead and ExecutionTrace node in the KSP artifact graph.

---

### FR-09: Stalled Bead Detection via DO Alarm
🟢 confidence | Source: SPEC-FF-GEARS-001 §7

`CoordinatorDO.alarm()` re-hooks beads stuck in `in_progress` for more than 5 minutes. Logic: `UPDATE execution_beads SET status='ready', assigned_to=NULL WHERE status='in_progress' AND updated_at < cutoff`. Re-arms alarm after each run. No Flue extension hook, no `scheduleEvery`.

**MoSCoW: Must** — crash recovery for agents that die mid-execution.

---

### FR-10: Hook API for Conducting Agent
🟢 confidence | Source: SPEC-FF-GEARS-001 §7

`src/beads/hook.ts` exports four functions consumed by the Conducting Agent (`atom-execution.ts` workflow):
- `claimHook(stub, beadId, agentId)` — calls `POST /claim`
- `releaseHook(stub, beadId, agentId, result)` — calls `POST /release`
- `failHook(stub, beadId, agentId, result)` — calls `POST /fail`
- `getNextReady(stub, moleculeId)` — calls `POST /next`

All functions accept a `DurableObjectStub` for `CoordinatorDO`.

**MoSCoW: Must** — sole public API for agents to interact with the DO.

---

### FR-11: AtomDirective Gets skillRef and role Fields Added
🟢 confidence | Source: SPEC-FF-GEARS-001 §5

`packages/schemas/src/atom-directive.ts` gains two new required fields:
- `skillRef: z.string().min(1)` — declared skill name passed to `session.skill()`
- `role: z.enum(['planner', 'coder', 'critic', 'tester', 'verifier'])` — authoritative role source

Both are populated by the Mediation Agent compile step from the dispatched `Gear`. Neither is set by the Conducting Agent.

The `role` field replaces the deleted `deriveRole()` heuristic (BR-KSP-19). `PROFILE_BY_ROLE[directive.role]` is the only valid role-to-profile lookup.

**MoSCoW: Must** — schema change; gating all downstream consumers.

---

### FR-12: Skill Distribution via Workspace Discovery (GD-003 Zero-Migration)
🟢 confidence | Source: SPEC-FF-GEARS-001 §8

Flue loads Agent Skills automatically from `<cwd>/.agents/skills/` at harness init. No TypeScript import is required for workspace-discovered skills. Migration action: rename `.agent/skills/` to `.agents/skills/` (one-time, no SKILL.md content changes).

`session.skill(skillRef, { args?, result? })` invokes a skill by its declared name in `SKILL.md` frontmatter.

**MoSCoW: Should** — one-time migration; no new code logic required.

---

### FR-13: Delete Retired Packages
🟢 confidence | Source: SPEC-FF-GEARS-001 §10

Delete `packages/harness-bridge/` and `packages/runtime/` (retired stubs). `tsc --noEmit` must pass repo-wide after deletion.

**MoSCoW: Should** — reduces confusion; no consumers of retired packages remain after gears is live.

---

### FR-14: Export Barrel via src/index.ts
🟢 confidence | Source: SPEC-FF-GEARS-001 §3

`src/index.ts` re-exports the public surface:
- `src/flue/agents.ts` exports
- `src/flue/sandbox.ts` exports
- `src/gears/types.ts` exports
- `src/beads/types.ts` exports
- `src/beads/coordinator-do.ts` exports
- `src/beads/hook.ts` exports

**MoSCoW: Must** — consumers import from `@factory/gears`, never from internal paths.

---

## Non-Functional Requirements

### NFR-01: Single-Writer Serialization (Availability)
🟢 confidence | Source: SPEC-FF-GEARS-001 §7, domain.md BR-KSP-11

One `CoordinatorDO` instance per `runId`. All bead state writes are serialized through this DO. No external Workers may write to `execution_beads` directly. All writes are atomic SQLite CAS operations (`RETURNING *` on claim).

---

### NFR-02: Deterministic runId (Availability / Crash Recovery)
🟢 confidence | Source: SPEC-FF-GEARS-001 §7 (GD-002), domain.md KSP Implicit Constraints

`runId = SHA-256(workGraphId + workGraphVersion)`. This makes the DO key deterministic: after a crash, the workflow reattaches to the same DO instance by computing the same `runId`. No new state is lost on reattachment.

---

### NFR-03: Stalled Bead Timeout = 5 Minutes (Performance)
🟢 confidence | Source: SPEC-FF-GEARS-001 §7

Any bead stuck in `in_progress` for longer than 5 minutes is automatically re-hooked to `ready` by the alarm handler. This limits agent hang duration to at most `5 minutes + alarm latency`.

---

### NFR-04: Cloudflare-Only Deployment (Deployability)
🟢 confidence | Source: architecture.md KSP Layer — Single-Host Constraint

`@factory/gears` runs on Cloudflare Workers infrastructure only. DO SQLite is the exclusive persistent store. D1 is the cross-run audit log only. No external database services, no ArangoDB for this layer.

---

### NFR-05: Fail-Closed on Missing runId (Availability)
🟢 confidence | Source: SPEC-FF-GEARS-001 §7b, domain.md BR-KSP-16

If `recordOutcome()` or `writeAudit()` is called before `initRun()`, they skip silently (early return). Execution-bead state transitions proceed normally (claim/release/fail are not blocked). Only the audit and loop-closure writes are skipped. This prevents a missing-init from crashing active execution.

---

### NFR-06: D1 bead_audit Table Is Append-Only (Compliance)
🟢 confidence | Source: domain.md KSP Implicit Constraints

The `bead_audit` table in `D1_AUDIT` uses `INTEGER PRIMARY KEY AUTOINCREMENT`. No deletes or updates are performed. All writes are `INSERT` only.

---

### NFR-07: No @koales/* Imports in Public API (Deployability)
🟡 confidence | Source: domain.md BR-KSP-15, SPEC-KSP-ARCH-001 §3

Package names use `@factory/*` prefix in public exports. All `@koales/*` references apply the package naming rule: `@koales/loop-closure` → `@factory/loop-closure`, `@koales/artifact-graph` → `@factory/artifact-graph`, `@koales/bead-graph` → `@factory/bead-graph`. Internal implementation imports follow the same rule.

---

## Acceptance Criteria

### AC-01: CoordinatorDO Claim/Release Happy Path

**Given** a molecule has been initialized with `initRun(runId, orgId)` and a bead is in `ready` state,
**When** an agent calls `claimHook(stub, beadId, agentId)` followed by `releaseHook(stub, beadId, agentId, resultJson)`,
**Then** the bead transitions `ready → in_progress → done`, a row is written to `D1_AUDIT.bead_audit` with `verdict = 'done'`, and `LoopClosureService.recordOutcome()` is called with `status: 'SUCCESS'`.

---

### AC-02: CoordinatorDO Claim/Release Failure Path

**Given** a bead is in `ready` state and `initRun()` has been called,
**When** an agent calls `claimHook(stub, beadId, agentId)` and then `failHook(stub, beadId, agentId, errorJson)`,
**Then** the bead transitions to `failed`, a row is written to `D1_AUDIT.bead_audit` with `verdict = 'failed'`, and `LoopClosureService.recordOutcome()` is called with `status: 'FAILURE'`.

---

### AC-03: Stalled Bead Recovery

**Given** a bead has been claimed by an agent (`status = 'in_progress'`, `updated_at = T`),
**When** the alarm fires and `Date.now() - T > 5 minutes`,
**Then** the bead returns to `ready` status with `assigned_to = NULL`, making it available for the next `getNextReady()` call.

---

### AC-04: getNextReady Dependency Ordering Invariant

**Given** beads A and B exist in a molecule where B depends on A,
**When** `getNextReady(stub, moleculeId)` is called and A is not yet `done`,
**Then** B is NOT returned (dependency not satisfied). Once A transitions to `done`, B becomes available via the next `getNextReady()` call.

---

### AC-05: initRun Before getNextReady Invariant (Failure Path)

**Given** a CoordinatorDO instance has been created but `initRun()` has NOT been called,
**When** `releaseBead()` is called with a result payload,
**Then** the bead status is updated to `done` in DO SQLite, but `writeAudit()` and `recordOutcome()` return early without writing (silent skip), and no error is thrown.

---

### AC-06: PROFILE_BY_ROLE Lookup

**Given** an `AtomDirective` with `role: 'coder'`,
**When** the Flue workflow selects a profile via `PROFILE_BY_ROLE[directive.role]`,
**Then** `coderProfile` is returned with `model: 'anthropic/claude-opus-4-6'` and no call to any `deriveRole()` function occurs.

---

## Patch 2026-06-11: Flue Atom-Execution Absorbed into Gears

### FR-15: ~~FlueAtomExecutionWorkflow and FlueRegistry Exported from Gears~~ — SUPERSEDED by ADR-014 (2026-06-13)

**[2026-06-11 new, 2026-06-13 superseded]** `FlueAtomExecutionWorkflow` and `FlueRegistry` have been deleted. `src/flue/` directory removed entirely. wrangler.jsonc v8 migration deletes these DOs from the CF migration tracker. Replaced by `ThinkExecutor` (FR-15-NEW). 🟢 CONFIRMADO

### FR-15-NEW: ThinkExecutor DO Exported from Gears (ADR-014)

**[2026-06-13 new]** `@factory/gears` exports `ThinkExecutor` (DO class extending `@cloudflare/think` `Think<Env>`). Re-exported by `workers/ff-pipeline/src/index.ts` for wrangler DO binding registration as `THINK_EXECUTOR`. DO naming: `think-${executableSpecificationId}-${atomId}`. Dispatched by ff-pipeline queue consumer via `POST /execute-atom` with `AtomDirective` body. 🟢 CONFIRMADO

**Acceptance test**: `packages/gears/src/agents/think-executor.ts` exports `ThinkExecutor`. `wrangler deploy` registers it as `THINK_EXECUTOR` DO binding via `ff-pipeline` wrangler.jsonc v8 migration.

### FR-16: seedBeads() Gate Before getNextReady() (BR-KSP-16)

**[2026-06-11 new]** `CoordinatorDO.getNextReady()` throws if `seedBeads()` + `initRun()` have not been called. The dispatcher must seed the molecule before requesting the next bead. `initRun()` also arms the stale-bead alarm. 🟢 CONFIRMADO

**Acceptance test**: Calling `getNextReady()` on an unseeded DO throws `Error('molecule not seeded')`.

### FR-16-NEW: ConductingAgent Factory and MODEL_BY_ROLE (ADR-014)

**[2026-06-13 new]** `packages/gears/src/agents/conducting-agent.ts` exports `buildConductingAgent(directive, coordinatorDO, workspace, env)`. Returns a Mastra `Agent` with: `MODEL_BY_ROLE` model routing (`src/agents/models.ts`), D1-backed observational memory (`@mastra/memory` + `@mastra/cloudflare-d1`, storage id: `gears-agent-memory`), input processors (UnicodeNormalizer, PromptInjectionDetector, ModerationProcessor, PIIDetector), output processors (ConsentBeadAuditProcessor, ToolCallFilter, BatchPartsProcessor, PIIDetector), and async tools resolver (workspace tools + execute tool + sandbox tools). 🟢 CONFIRMADO

**MODEL_BY_ROLE bindings** (🟢 CONFIRMADO from `src/agents/models.ts`):
- `planner`: `anthropic/claude-opus-4-6`
- `coder`: `cloudflare/@cf/moonshotai/kimi-k2.6`, `bypassGateway: true`, `thinkingLevel: 'low'`
- `critic`, `tester`, `verifier`: `openai/gpt-5.5`

**Acceptance test**: `buildConductingAgent({ role: 'coder', ... })` returns an Agent whose model is `cloudflare/@cf/moonshotai/kimi-k2.6` with `bypassGateway: true`.

### FR-17: D1 Bead Audit Helpers (d1-audit.ts)

**[2026-06-11 new]** `packages/gears/src/beads/d1-audit.ts` exports `insertBeadAudit(db, row)` and `queryBeadAudit(db, runId)`. `CoordinatorDO.writeAudit()` calls `insertBeadAudit`. Cross-run audit log stored in `factory-bead-audit` D1 database. 🟢 CONFIRMADO

### FR-17-NEW: ConsentBeadAuditProcessor (ADR-014, I4 Enforcement)

**[2026-06-13 new]** `packages/gears/src/processors/consent-bead-audit-processor.ts` exports `ConsentBeadAuditProcessor extends BaseProcessor`. Fires at `processOutputStep` boundary — after LLM response, before tool executor. For every tool call: (1) POSTs audit record to `CoordinatorDO /consent` (🔴 GAP: route not yet implemented — BR-THINK-05); (2) checks `directive.permittedTools` allowlist; (3) throws `ConsentDeniedError` if tool not permitted (fail-closed, I4 invariant). 🟢 CONFIRMADO (logic); 🔴 LACUNA (/consent route)

**Acceptance test**: Calling `processOutputStep` with a tool call not in `directive.permittedTools` throws `ConsentDeniedError` with `toolName` and `beadId`.

### FR-18: AI Gateway Bypassed for kimi-k2.6 (BR-THINK-04-MODEL)

**[2026-06-11, updated 2026-06-13]** `MODEL_BY_ROLE.coder` sets `bypassGateway: true` (previously `coderProfile.gateway: false`). The Cloudflare AI Gateway closes SSE response bodies prematurely on kimi-k2.6 text turns, causing stream reads to hang. Direct CF Workers AI binding is required. 🟢 CONFIRMADO

### NFR-08: R2 Write Non-Fatal (inherited from BR-FLUE-05)

**[2026-06-11, updated 2026-06-13]** R2 write failures are non-fatal. The error is logged but must not propagate. R2 unavailability must not cause atom execution failure. Now owned by the `ThinkExecutor`/`ConductingAgent` layer. 🟡 INFERIDO

### NFR-09: @cloudflare/think Runtime Dependency

**[2026-06-13 new]** `ThinkExecutor` depends on `@cloudflare/think` (Cloudflare Project Think). Requires `LOADER` (`WorkerLoader`) binding in wrangler.jsonc for `createExecuteTool`. Requires wrangler.jsonc v8 migration to register `ThinkExecutor` as new DO and delete `FlueAtomExecutionWorkflow`/`FlueRegistry`. 🟢 CONFIRMADO

### NFR-10: Mastra Runtime Dependencies

**[2026-06-13 new]** `ConductingAgent` depends on `@mastra/core` (Agent, processors), `@mastra/memory` (observational memory compressor with `ModelByInputTokens`), and `@mastra/cloudflare-d1` (D1Store). D1 binding `DB` is used for agent memory storage (storage id: `gears-agent-memory`). 🟢 CONFIRMADO

---

## Known Implementation Gaps (2026-06-13)

| Gap | Rule | Fix required |
|-----|------|-------------|
| `ThinkExecutor.executeAtom()` never calls `claimHook()` before running | BR-THINK-03 | Add `claimHook(coordinatorDO, directive.atomId, directive.directiveId)` as first step of `executeAtom()` |
| `CoordinatorDO.fetch()` has no `/consent` route | BR-THINK-05 | Add `/consent` handler to persist `ConsentBead` audit records |
| No auto-dispatch of next ready bead after completion | 🔴 unspecced | After `releaseHook`/`failHook`, someone must query `getNextReady()` and enqueue next `synthesis-queue` message |

---

## MoSCoW Summary

| ID | Requirement | Priority |
|----|------------|---------|
| FR-01 | Absorb three retired concerns | Must |
| FR-02 | Five agent profiles (GD-001 A) | Must |
| FR-03 | Single Sandbox class (GD-005) | Must |
| FR-04 | Gear/GearFormula/GearMolecule types | Must |
| FR-05 | CoordinatorDO one-per-execution (GD-002 B) | Must |
| FR-06 | initRun before getNextReady (BR-KSP-16) | Must |
| FR-07 | writeAudit fully wired (BR-KSP-17) | Must |
| FR-08 | recordOutcome → LoopClosureService BP3 | Must |
| FR-09 | Stalled bead detection via alarm | Must |
| FR-10 | Hook API for Conducting Agent | Must |
| FR-11 | AtomDirective skillRef + role fields | Must |
| FR-12 | Skill workspace discovery (GD-003) | Should |
| FR-13 | Delete harness-bridge + runtime stubs | Should |
| FR-14 | src/index.ts barrel | Must |
| FR-15 | ~~FlueAtomExecutionWorkflow + FlueRegistry exported~~ SUPERSEDED | — |
| FR-15-NEW | ThinkExecutor DO exported from gears (ADR-014) | Must |
| FR-16 | seedBeads() gate before getNextReady() | Must |
| FR-16-NEW | ConductingAgent factory + MODEL_BY_ROLE (ADR-014) | Must |
| FR-17 | D1 bead audit helpers (d1-audit.ts) | Must |
| FR-17-NEW | ConsentBeadAuditProcessor I4 enforcement (ADR-014) | Must |
| FR-18 | AI Gateway bypassed for kimi-k2.6 (MODEL_BY_ROLE.coder) | Must |
| NFR-08 | R2 write non-fatal | Must |
| NFR-09 | @cloudflare/think + LOADER binding | Must |
| NFR-10 | @mastra/core + @mastra/memory + @mastra/cloudflare-d1 | Must |
| NFR-01 | Single-writer serialization | Must |
| NFR-02 | Deterministic runId | Must |
| NFR-03 | 5-minute stall timeout | Must |
| NFR-04 | Cloudflare-only deployment | Must |
| NFR-05 | Fail-closed on missing runId | Must |
| NFR-06 | Append-only audit table | Must |
| NFR-07 | @factory/* naming throughout | Should |
| NFR-08 | storeFullOutput non-fatal | Must |
