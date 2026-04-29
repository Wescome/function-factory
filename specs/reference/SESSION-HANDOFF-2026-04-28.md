# Session Handoff: Function Factory
## 2026-04-28 — Complete State Transfer

**Purpose:** This document is the next session's cold-start context. Read it
end to end before doing anything. It replaces all previous session memory
for this project.

**Test command (verify nothing is broken before you start):**
```bash
pnpm --filter @factory/ff-pipeline test -- --run
```
Expected: 636 tests, 37 files, 0 failures, ~6 seconds.

---

## 1. Architecture State Map

### 1.1 Repository Layout

```
function-factory/
  workers/
    ff-pipeline/        -- THE Worker. Stages 1-7, synthesis, all agents
    ff-gates/           -- Service binding: Gate 1 evaluation
    ff-gateway/         -- HTTP gateway (trigger, status, callback)

  packages/
    schemas/            -- Zod schemas, ArtifactId regex, FactoryMode enum
    compiler/           -- Stage 5 compiler (Passes 0-8), CLI
    coverage-gates/     -- Gate 1 checks (atom, invariant, validation, deps, bootstrap)
    arango-client/      -- ArangoDB HTTP client (used everywhere)
    ontology-loader/    -- Seeds ontology + agent designs into ArangoDB
    artifact-validator/ -- SHACL-like constraint checking at persist time
    task-routing/       -- Model selection per task kind
    gdk-agent/          -- Agent loop (agentLoop + tool dispatch)
    gdk-ai/             -- LLM provider abstraction (streaming, HTTP)
    gdk-ts/             -- Core tools (file_read, bash, etc.)
    stream-types/       -- SSE/streaming TypeScript types
    function-synthesis/ -- Stage 6 package stub
    assurance-graph/    -- Stage 7 package stub
    runtime/            -- Package stub
    harness-bridge/     -- Package stub (retracted, see DECISIONS.md)
    [17 more packages]  -- Factory pipeline stages, domain logic

  specs/
    reference/          -- ADRs (003-008), whitepaper, ConOps, SE assessments
    ontology/           -- factory-ontology.ttl, factory-shapes.ttl, extensions
    prds/               -- 3 compiled PRDs (Gate-1, Detect-Regression, Pass-8)
    workgraphs/         -- 3 WorkGraphs from compiler output
    coverage-reports/   -- Gate 1 reports from each compile
    signals/            -- Stage 1 signals (SIG-META-*)
    pressures/          -- Pressures (PRS-META-*)
    capabilities/       -- Capabilities (BC-META-*)
    functions/          -- Function proposals (FP-META-*)
    [15 more dirs]      -- Other artifact types

  infra/
    arangodb/           -- init-db.ts, seed.ts, verify.ts
```

### 1.2 The Pipeline (What Actually Runs)

**Entry point:** `workers/ff-pipeline/src/index.ts` (441 lines)

**Flow:**
```
POST /trigger-synthesis
  -> FactoryPipeline (Workflow: pipeline.ts, 382 lines)
    -> Stage 1: ingest-signal
    -> Stage 2: synthesize-pressure
    -> Stage 3: map-capability
    -> Stage 4: propose-function
    -> Stage 5: compile (6 LLM passes + 2 deterministic)
    -> Gate 1: via ff-gates Service Binding
    -> SYNTHESIS_QUEUE -> SynthesisCoordinator DO (coordinator.ts, 683 lines)
      -> Phase 1 (serial): architect, semantic-critic, compile, gate-1, planner
      -> Phase 2 (parallel): AtomExecutor DOs per dependency layer
      -> Phase 3 (integration): merge + verify
    -> SYNTHESIS_RESULTS Queue -> Workflow resumes
    -> ATOM_RESULTS Queue -> atom verdicts
  -> Response: { instanceId, ... }
```

**Key files in the pipeline worker:**

| File | Lines | Purpose |
|------|-------|---------|
| `src/index.ts` | 441 | Worker entry: fetch, queue, scheduled handlers |
| `src/pipeline.ts` | 382 | FactoryPipeline Workflow (Stages 1-7) |
| `src/coordinator/coordinator.ts` | 683 | SynthesisCoordinator DO (graph orchestration) |
| `src/coordinator/graph.ts` | 532 | 9-node StateGraph (architect through verifier) |
| `src/coordinator/graph-runner.ts` | ~80 | Custom StateGraph execution engine |
| `src/coordinator/atom-executor-do.ts` | ~200 | AtomExecutor DO (per-atom vertical slice) |
| `src/coordinator/atom-executor.ts` | ~150 | Atom graph: code->critic->test->verify |
| `src/coordinator/layer-dispatch.ts` | ~100 | Promise.all fan-out by dependency layer |
| `src/coordinator/completion-ledger.ts` | ~80 | Crash recovery state tracking |
| `src/coordinator/state.ts` | ~150 | GraphState type + initial state factory |
| `src/agents/output-reliability.ts` | 817 | ORL: Parse->Validate->Coerce->Repair->Fail |
| `src/agents/architect-agent.ts` | 169 | Architect: single-turn Workers AI binding |
| `src/agents/planner-agent.ts` | ~200 | Planner: atom plan production |
| `src/agents/coder-agent.ts` | ~220 | Coder: code generation per atom |
| `src/agents/critic-agent.ts` | ~130 | Critic: semantic + code review |
| `src/agents/tester-agent.ts` | ~200 | Tester: test generation/execution |
| `src/agents/verifier-agent.ts` | ~230 | Verifier: final verdict |
| `src/agents/designs.ts` | ~300 | Agent design documents (system prompts, tools) |
| `src/agents/coerce.ts` | ~100 | Type coercion primitives |
| `src/agents/context-prefetch.ts` | ~150 | Pre-fetch ArangoDB context for agents |
| `src/agents/resolve-model.ts` | ~50 | Hot-config model resolution |
| `src/agents/workers-ai-stream.ts` | ~200 | Workers AI REST API streaming adapter |
| `src/config/hot-config.ts` | 305 | Hot-reloadable config from ArangoDB |
| `src/crp.ts` | ~120 | CRP auto-generation |
| `src/lifecycle.ts` | ~150 | Function lifecycle state machine |
| `src/providers.ts` | ~250 | LLM provider abstraction |
| `src/model-bridge.ts` | ~100 | Workers AI binding bridge |
| `src/stages/*.ts` | ~600 | Pipeline stage implementations |
| `src/types.ts` | ~200 | Shared type definitions |

### 1.3 Infrastructure

| Component | Location | Status |
|-----------|----------|--------|
| ArangoDB Oasis | `koales-xxxxxxxx.arangodb.cloud` | Live, 20+ collections |
| ff-pipeline Worker | `ff-pipeline.koales.workers.dev` | Deployed |
| ff-gates Worker | `ff-gates.koales.workers.dev` | Deployed |
| ff-gateway Worker | `ff-gateway.koales.workers.dev` | Deployed |
| CF Queues | SYNTHESIS_QUEUE, SYNTHESIS_RESULTS, ATOM_RESULTS | Operational |
| CF Workflows | FACTORY_PIPELINE | Operational |
| CF DOs | SynthesisCoordinator, AtomExecutor | Operational |
| Workers AI | llama-3.3-70b (pipeline), qwen-coder-32b (agents) | Free tier |

### 1.4 Secrets and Config

Secrets are in `wrangler secret list`, NOT in source. Never read them.
- `ARANGO_URL`, `ARANGO_TOKEN` -- ArangoDB Oasis credentials
- `OFOX_API_KEY` -- ofox.ai API key (needs top-up for live synthesis)

---

## 2. Gap Analysis

### 2.1 What Works (Binary: YES)

| Capability | Evidence |
|------------|---------|
| Pipeline Stages 1-5 end-to-end | 15 seconds, zero cost, llama-70b |
| Gate 1 (5 checks, fail-closed) | 3 PRDs compiled, all PASS |
| Compiler Passes 0-8 | WorkGraphs emitted for all 3 PRDs |
| ORL (7 failure modes, 5-tier parse) | 817-line module, 636 tests |
| Hot-reloadable config from ArangoDB | alias tables, routing, model caps |
| Event-driven Queue relay | SYNTHESIS_QUEUE, SYNTHESIS_RESULTS, ATOM_RESULTS |
| Fire-and-forget DO dispatch | No more queue visibility timeout |
| AtomExecutor DOs (per-atom slicing) | Deployed, tested |
| 6 agent design documents | designs.ts, all with ORL schemas |
| Architect produces BriefingScript | Grounded in ArangoDB context |
| Critic catches misaligned proposals | Semantic review operational |
| CRP auto-generation | crp.ts wired, tested |
| Lifecycle state machine | lifecycle.ts, tested |
| Artifact validator (C1, C7, C9, C15) | 4 constraints enforced at persist |
| Ontology queryable in ArangoDB | 215 docs, 33 ontology tests pass |
| Context pre-fetching | Replaces agent tool calls |
| Field alias tables | Per-schema, hot-loaded from ArangoDB |
| Split model routing | Pipeline vs agent distinction |
| Dry-run synthesis passes | Full verdict: PASS end-to-end |

### 2.2 What Does Not Work (Binary: NO)

| Capability | Blocker | Designed? |
|------------|---------|-----------|
| Live synthesis atoms produce valid JSON | Workers AI models output function-call JSON, not schema JSON (BL6) | YES -- needs Tier 3 models via ofox.ai |
| ORL telemetry to ArangoDB | Write hooks not implemented | YES -- ADR-008 Phase 1 |
| Signal Generator (Cron) | Not implemented | YES -- ADR-008 Phase 2 |
| Governor Agent | Not implemented | YES -- ADR-008 Phase 4 |
| SystemsEngineer Agent | Not implemented | YES -- ADR-008 Phase 4 |
| Self-healing pipeline loop | Not implemented | YES -- ADR-008 Phase 5 |
| PromptPact framework | Not implemented | YES -- ORIENTATION-ONTOLOGY.md |
| Context Engineering pipeline | Not implemented | YES -- ORIENTATION-ONTOLOGY.md |
| Phase G constraint validators (12 remaining) | Not implemented | YES -- IMPLEMENTATION-PLAN.md |
| Sandbox Container execution | Container deployed but agent sessions not wired | YES -- IMPLEMENTATION-PLAN.md Phase C |
| Gate 2 (simulation coverage) | Not implemented | Designed in whitepaper |
| Gate 3 (assurance, continuous) | Not implemented | Designed in whitepaper |
| v2 vertical: git-commit-triage | Not implemented | YES -- DECISIONS.md |
| Effectiveness tracking (M7) | Not implemented | YES -- ADR-008 Phase 6 |
| TTL indexes on event collections | Not implemented | YES -- ADR-008 Phase 7 |

### 2.3 What Is Designed But Not Prioritized

| Item | Document | Priority |
|------|----------|----------|
| Orientation Agents (10 types) | ORIENTATION-ONTOLOGY.md SS1-11 | After self-healing |
| Factory Memory Ontology (Module 7) | ORIENTATION-ONTOLOGY.md SS10 | After self-healing |
| Adaptive slice depth (v5.1) | ADR-005 SS5.3 | After live synthesis |
| Phase 3 integration verification | ADR-005 SS4.4 | After live synthesis |
| Crystallization from execution | DECISIONS.md 2026-04-24 | After Gate 3 |
| Memory writes as tool calls | DECISIONS.md 2026-04-24 | Steady state |

---

## 3. Implementation Roadmap

### Sprint 1: Live Synthesis (1 session, highest value)

**JTBD:** When the Factory receives a Signal, I want to see atoms produce
real code artifacts with passing verdicts, so I can prove the synthesis
pipeline works end-to-end.

**The problem:** Workers AI models (qwen-coder-32b, llama-3.3-70b) produce
function-call-shaped JSON (`{"name":"tool","arguments":{...}}`) instead of
schema-conformant JSON when asked for structured agent output. This is BL6
(training distribution inertia) -- the models are trained on function-calling
datasets and default to that output shape. Every mitigation tried during this
session failed: text tool detection, REST API, direct binding, few-shot
examples, first-token priming, anti-corruption language, Tier 5 truncation
recovery.

**The fix:** Route synthesis agents (Tier 2 tasks) to external models via
ofox.ai. External models (deepseek-v4-pro, gemini-pro) have native function
calling and proven structured output compliance. Keep Workers AI (llama-70b)
for pipeline stages (Tier 1 tasks) where it excels.

**Steps:**

1. **Top up ofox.ai credits.** Login: `https://ofox.ai`. Check balance. Add
   credits. Wes must do this -- it requires payment.

2. **Verify `OFOX_API_KEY` secret.** Run `wrangler secret list` for
   ff-pipeline. If missing: `wrangler secret put OFOX_API_KEY`.

3. **Update `resolve-model.ts` routing.** For agent task kinds (`coder`,
   `tester`, `verifier`, `planner`, `critic`), route to ofox.ai model
   (deepseek-v4-pro or gemini-3.1-pro-preview). Keep `architect` on
   Workers AI (single-turn, already working).

   File: `workers/ff-pipeline/src/agents/resolve-model.ts`

   The hot-config system already supports this -- update the
   `model_routing` collection in ArangoDB via seed script or direct AQL:
   ```aql
   UPSERT { _key: "coder" }
   INSERT { _key: "coder", provider: "ofox", model: "deepseek-v4-pro" }
   UPDATE { provider: "ofox", model: "deepseek-v4-pro" }
   IN model_routing
   ```
   Repeat for: planner, critic, tester, verifier.

4. **Wire ofox.ai provider in `providers.ts`.** The gdk-ai HTTP streaming
   path already exists. Ensure the ofox.ai base URL and auth header are
   configured. Check `workers/ff-pipeline/src/providers.ts` for the HTTP
   provider setup.

5. **Run live synthesis.** Via ff-gateway:
   ```bash
   curl -X POST https://ff-gateway.koales.workers.dev/pipeline/trigger \
     -H "Content-Type: application/json" \
     -d '{"signalContent":"Implement a TypeScript function that validates ArtifactId format"}'
   ```

6. **Check result.** Poll:
   ```bash
   curl https://ff-gateway.koales.workers.dev/pipeline/{instanceId}/status
   ```
   Success = verdict with `decision: "pass"` and atom CodeArtifacts with
   real TypeScript code.

**Success criteria:** At least one atom produces a CodeArtifact with valid
TypeScript and a Verifier verdict of `pass`.

**Effort:** 1 session (2-4 hours).

**Risk:** ofox.ai rate limits or model availability. Mitigation: the system
falls back to Workers AI models, which complete the loop but produce
lower-quality output.

---

### Sprint 2: ORL Telemetry Foundation (1 session)

**JTBD:** When a synthesis run completes, I want structured failure events
written to ArangoDB, so the self-healing loop has data to analyze.

**Steps:**

1. **Create telemetry collections via seed script.**
   File: `infra/arangodb/seed.ts`
   Add 7 collections: `pipeline_health_events`, `gate_effectiveness_events`,
   `agent_quality_events`, `output_reliability_events`,
   `infrastructure_health_events`, `ontology_compliance_events`,
   `self_healing_metrics`.

2. **Add M4 event emission in ORL.**
   File: `workers/ff-pipeline/src/agents/output-reliability.ts`
   The `onEvent` callback already exists in the ORL config type. Wire it
   to write to `output_reliability_events` in ArangoDB. Each ORL call
   emits: model, agent, schema, success, failureMode, parseTier,
   coercions, repairAttempts, latencyMs.

3. **Add M1 event emission at pipeline end.**
   File: `workers/ff-pipeline/src/pipeline.ts`
   At the end of `FactoryPipeline.run()`, emit a `PipelineHealthEvent`
   with stage timings, final status, and total duration.

4. **Add M3 event emission in coordinator.**
   File: `workers/ff-pipeline/src/coordinator/coordinator.ts`
   After each agent call completes, emit an `AgentQualityEvent` with
   agent role, model, success, failure mode, token usage.

5. **Deploy and run one synthesis.** Verify events appear in all 3
   collections via AQL.

**Success criteria:** AQL queries return events from `output_reliability_events`,
`pipeline_health_events`, and `agent_quality_events` after a single synthesis run.

**Effort:** 1 session (3-4 hours).

**Depends on:** Sprint 1 (needs live synthesis runs to generate events).

---

### Sprint 3: Signal Generator + Governor Agent (2 sessions)

**JTBD:** When failure patterns accumulate in telemetry, I want the Factory
to detect them automatically and surface them as Pressures, so reliability
issues are caught without human monitoring.

**Session 1: Signal Generator**

1. Add `scheduled` handler in `src/index.ts`.
2. Implement pattern detector registry (start with MR-1, MR-4, MR-5, PH-1).
3. Add deduplication and 20-signal cap.
4. Add Cron Trigger to `wrangler.jsonc`: `"*/5 * * * *"`.
5. Deploy. Inject deliberate F3 failures. Verify Signal generated.

**Session 2: Governor + SystemsEngineer Agents**

1. Add Governor agent design document to `designs.ts`.
2. Implement Governor: queries all telemetry stores, produces Pressure.
3. Add SystemsEngineer agent design document.
4. Implement SystemsEngineer: validates fixes against ontology + BL1-BL7.
5. Implement confidence computation and gating logic.
6. Wire `mode: 'self-healing'` branch in pipeline.

**Success criteria:** Self-healing Signal generated from telemetry. Governor
produces domain-tagged Pressure. SystemsEngineer validates a fix.

**Effort:** 2 sessions (4-6 hours each).

**Depends on:** Sprint 2 (needs telemetry data).

---

### Sprint 4: PromptPact Framework (1-2 sessions)

**JTBD:** When an agent runs, I want its prompt to be a governed contract
with explicit context rules, output schemas, and failure signals, so prompt
quality is measurable and improvable.

**Steps:**

1. Define `PromptPact` TypeScript type based on ORIENTATION-ONTOLOGY.md SS3.
2. Define `ContextPackage` type based on ORIENTATION-ONTOLOGY.md SS5.
3. Convert existing `designs.ts` agent design documents to PromptPact format.
4. Implement Context Engineering pipeline:
   - Context discovery (what's available)
   - Context qualification (authority levels per SS8)
   - Context budget management (max tokens, compression)
   - Context packaging (structured package per agent)
5. Wire into coordinator: each agent call builds a ContextPackage before
   constructing the LLM prompt.
6. Add `prompt_traces` collection for telemetry.

**Success criteria:** All 6 agents receive qualified ContextPackages. Prompt
traces written to ArangoDB.

**Effort:** 1-2 sessions.

**Depends on:** Sprint 1 (needs working synthesis to validate).

---

### Sprint 5: Phase G Constraint Validators (1 session)

**JTBD:** When an artifact is persisted, I want all 16 SHACL constraints
checked at runtime, so the ontology is enforced, not just documented.

**Currently enforced:** C1 (lineage), C5 (invariant detector), C7 (CRP),
C9 (gate fail-closed), C15 (no secrets). Total: 5 of 16.

**Batch 1 (small, pure field checks):** C3, C4, C6, C8, C11, C12, C13, C16.
**Batch 2 (medium, need graph queries):** C2, C10.
**Already handled:** C14 (lifecycle.ts), C5, C9 (operational).

File: `packages/artifact-validator/`

**Success criteria:** 16/16 constraints enforced. 33+ new tests.

**Effort:** 1 session (3-4 hours).

**Depends on:** Nothing. Can run in parallel with any sprint.

---

### Sprint 6: Self-Healing Integration (1 session)

**JTBD:** When the Signal Generator detects a pattern and the Governor
creates a Pressure, I want the full loop to run: fix proposed, validated,
deployed to ArangoDB, next call uses the fix.

**Steps:**

1. Wire confidence gate into pipeline.
2. Implement `deployConfigFix()` for all fix atom types.
3. Create `self_healing_deployments` collection.
4. End-to-end test: inject F3 failures -> Cron -> Signal -> Pipeline ->
   Fix -> Hot-reload -> Next call succeeds.

**Success criteria:** Full closed loop without human intervention.

**Effort:** 1 session (4-6 hours).

**Depends on:** Sprint 3 (Governor + SystemsEngineer must exist).

---

### Roadmap Summary

```
Sprint 1 (Live Synthesis)          -- HIGHEST PRIORITY
  |
Sprint 2 (ORL Telemetry)
  |
Sprint 3 (Signal Generator + Governor)
  |                           Sprint 4 (PromptPacts)
  |                               |
Sprint 6 (Self-Healing Loop)      |
                                  |
Sprint 5 (Phase G) -- can run anytime, independent
```

Estimated total: 6-8 sessions to complete all sprints.

---

## 4. Critical Decisions Pending

### Decision 1: ofox.ai Model Selection for Tier 2

**Question:** Which ofox.ai model for synthesis agents?

**Options:**
- `deepseek-v4-pro` -- proven structured output, $0.50/$2.00 per M tokens
- `gemini-3.1-pro-preview` -- long context, $1.25/$5.00 per M tokens
- `claude-opus-4.6` -- highest quality, $15/$75 per M tokens (expensive)

**Recommendation:** Start with deepseek-v4-pro (cheapest, proven). Fall back
to gemini-pro if quality insufficient. Reserve claude-opus for verification
tasks only.

**Who decides:** Wes (budget decision).

### Decision 2: PromptPact Implementation Scope

**Question:** Full PromptPact framework (all 8 contracts per agent, context
engineering pipeline, telemetry) or minimum viable (output contract + context
budget only)?

**Options:**
- Full: 2-3 sessions, covers all failure signals from ORIENTATION-ONTOLOGY.md
- MVP: 1 session, output schema + context budget only

**Recommendation:** MVP first. The existing `designs.ts` already has most of
the information. Add output schema enforcement and context budget tracking.
Expand to full PromptPacts when self-healing telemetry shows which contracts
matter.

**Who decides:** Wes (scope decision).

### Decision 3: v2 Vertical Timing

**Question:** When to start git-commit-triage (v2 vertical)?

**Context:** v2 was selected in DECISIONS.md 2026-04-19 but depends on the
synthesis pipeline producing real code. Sprint 1 unblocks this.

**Recommendation:** After Sprint 1 succeeds. v2 is the first non-meta
compile -- it proves the Factory works on external domains.

**Who decides:** Wes (priority decision).

### Decision 4: Phase G vs Self-Healing Priority

**Question:** Enforce all 16 constraints (Phase G) before or after the
self-healing loop?

**Recommendation:** Phase G first. The self-healing loop (ADR-008) checks
ontology compliance (M6 domain). If constraints are not enforced at runtime,
M6 has nothing to monitor. Phase G is a prerequisite for M6.

**Who decides:** Can be GUV-level decision. No architecture gate needed.

---

## 5. Orientation Ontology Integration Plan

### 5.1 What ORIENTATION-ONTOLOGY.md Defines

The document has three parts:

1. **Orientation Ontology (SS1-17):** 10 agent types, 7 ontology modules,
   semantic loop for factory self-understanding. This is the LONG-TERM
   vision -- the Factory observing itself, interpreting, and evolving.

2. **PromptPacts (SS1-14 of the PromptPact section):** Governed contracts
   for agent prompts. 8 contract types per agent. Context engineering
   pipeline. This is the MEDIUM-TERM capability.

3. **Context Engineering (SS4-8):** Qualified context packages, authority
   levels, compression, budgeting. This is the NEAR-TERM need.

### 5.2 Mapping to Existing Codebase

| Ontology Concept | Existing Code | Gap |
|-----------------|---------------|-----|
| FactoryObject | `specs/ontology/factory-ontology.ttl` | Loaded in ArangoDB, queryable |
| TelemetryObservation | `output-reliability.ts` events | Events exist but not persisted to ArangoDB |
| Signal | `specs/signals/SIG-META-*` | File-based only, not runtime |
| OrientationAgent | Not implemented | Needs Governor (ADR-008) first |
| OrientationAssessment | Not implemented | Produced by Orientation Agents |
| MetaArtifact | Partially: `crp.ts` creates CRPs | Needs PromptPatch, ContractAmendment |
| PromptPact | Not implemented | `designs.ts` has the seed data |
| ContextPackage | Not implemented | `context-prefetch.ts` does simple version |
| ContextContract | Not implemented | New type needed |
| InstructionContract | `designs.ts` system prompts | Needs formalization |
| OutputContract | ORL schemas in `output-reliability.ts` | Already schema-driven |
| ToolContract | `designs.ts` tool lists | Needs formalization |
| EvidenceContract | Not implemented | New concept |
| FailureContract | ORL failure modes F1-F7 | Already classified |
| EvaluationContract | Not implemented | New concept |
| EvolutionContract | Not implemented | Needs self-healing loop |

### 5.3 What Gets Refactored

1. **`designs.ts`** becomes the PromptPact registry. Each agent design
   document gains: `contextContract`, `outputContract`, `toolContract`,
   `failureContract`. The existing fields (`context.tools`,
   `intent.outputShape`, `engineering.modelRoute`) map directly.

2. **`context-prefetch.ts`** becomes the Context Engineering pipeline.
   Currently it pre-fetches ArangoDB context as a blob. Refactor to:
   discover -> qualify -> prioritize -> budget -> package -> validate.

3. **`output-reliability.ts`** already implements the OutputContract. No
   refactoring needed -- just formalize the connection.

4. **`hot-config.ts`** already implements the EvolutionContract's deployment
   surface. Configuration changes are the MetaArtifact delivery mechanism.

### 5.4 What Is New

1. **`PromptPact` type** in `packages/schemas/src/` or
   `workers/ff-pipeline/src/agents/`.

2. **`ContextPackage` type** with authority levels, budget, and integrity
   checks.

3. **`prompt_traces` ArangoDB collection** for telemetry.

4. **Context authority levels** as an enum: `binding`, `primary`,
   `supporting`, `memory`, `speculative`, `forbidden`.

5. **Orientation Agent types** (10 total, per SS5) -- these are future work
   beyond PromptPacts.

---

## 6. Quick Win: Live Synthesis Pass

**The single action that unblocks everything else.**

### Current State

Dry-run synthesis: PASS (15 seconds, zero cost, llama-70b).
Live synthesis: atoms produce function-call JSON instead of schema JSON.

### Root Cause

Workers AI models are trained on function-calling datasets. When asked to
produce structured JSON output, they default to `{"name":"tool","arguments":{...}}`
format. This is BL6 (training distribution inertia) from the ontology.
Every mitigation tried in the current session failed because the behavior
is a training distribution property, not an instruction-following failure.

### The Fix (Step by Step)

**Step 1: Money.** Top up ofox.ai. This is a human action. Do it before
starting the next session.

URL: https://ofox.ai
Minimum needed: $10 covers ~50 synthesis runs at deepseek-v4-pro rates.

**Step 2: Secret.** Verify the OFOX_API_KEY is set:
```bash
cd workers/ff-pipeline && wrangler secret list
```
If missing: `wrangler secret put OFOX_API_KEY` and paste the key.

**Step 3: Routing config.** Update ArangoDB `model_routing` collection
to route agent roles to ofox.ai:
```aql
FOR role IN ["planner", "coder", "critic", "tester", "verifier"]
  UPSERT { _key: role }
  INSERT { _key: role, provider: "ofox", model: "deepseek-v4-pro", updatedAt: DATE_ISO8601(DATE_NOW()) }
  UPDATE { provider: "ofox", model: "deepseek-v4-pro", updatedAt: DATE_ISO8601(DATE_NOW()) }
  IN model_routing
```

**Step 4: Provider wiring.** Check that `providers.ts` has the ofox.ai HTTP
path configured. The `gdk-ai` streaming HTTP provider should handle this
if the base URL and auth header are set. If not, add:
```typescript
// In the provider configuration for ofox.ai:
{
  provider: 'ofox',
  baseUrl: 'https://api.ofox.ai/v1',
  authHeader: `Bearer ${env.OFOX_API_KEY}`,
}
```

**Step 5: Deploy and test.**
```bash
cd workers/ff-pipeline && npx wrangler deploy
```
Then trigger:
```bash
curl -X POST https://ff-gateway.koales.workers.dev/pipeline/trigger \
  -H "Content-Type: application/json" \
  -d '{"signalContent":"Implement a function that validates artifact lineage"}'
```

**Step 6: Verify.** Check the pipeline status endpoint. Look for:
- Architect: BriefingScript produced (Workers AI, already working)
- Planner: SlicePlan with atom specs (ofox.ai)
- Coder: CodeArtifact with TypeScript files (ofox.ai)
- Tester: TestReport with test results (ofox.ai)
- Verifier: Verdict with `decision: "pass"` (ofox.ai)

**Expected result:** First-ever live `synthesis-passed` verdict with real atoms.

**Fallback if ofox.ai fails:** Try gemini-3.1-pro-preview instead of
deepseek-v4-pro. If all external models fail, the architecture is still
correct -- the ORL handles whatever comes back -- but the output quality
will be lower.

---

## 7. Session Start Protocol for Next Session

### Read Order (mandatory, in this order)

1. **This file.** You are reading it. Do not skip sections.
   `/Users/wes/Developer/function-factory/specs/reference/SESSION-HANDOFF-2026-04-28.md`

2. **AGENTS.md** -- the agent map.
   `/Users/wes/Developer/function-factory/.agent/AGENTS.md`

3. **DECISIONS.md** -- architectural decisions. Large file (600+ lines).
   Read the first 100 lines (active decisions) and skim the rest.
   `/Users/wes/Developer/function-factory/.agent/memory/semantic/DECISIONS.md`

4. **IMPLEMENTATION-PLAN.md** -- ontology phase status (tells you what is
   Done vs Next).
   `/Users/wes/Developer/function-factory/specs/ontology/IMPLEMENTATION-PLAN.md`

5. **Run tests.** Before anything else:
   ```bash
   pnpm --filter @factory/ff-pipeline test -- --run
   ```
   Expected: 636 tests, 0 failures.

### Do NOT Read (wastes context)

- Previous session memory files (`project_session_*.md`) -- this handoff
  supersedes them.
- The full whitepaper (`The_Function_Factory_2026-04-18_v4.md`) -- 42KB,
  too large. Reference specific sections only when needed.
- ADR-003 (historical, superseded by current architecture).
- Any `dist/` directories.

### Key Facts to Hold in Working Memory

1. **Workers AI is free but weak at structured output.** Use it for pipeline
   stages (Tier 1). Use ofox.ai for synthesis agents (Tier 2).

2. **The ORL handles ALL output failures.** Do not add per-agent JSON
   parsing. Everything goes through `output-reliability.ts`.

3. **Hot config is operational.** Alias tables, model routing, and model
   capabilities load from ArangoDB at call time. Changes take effect
   immediately without redeployment.

4. **Queue relay is the canonical DO-to-Workflow pattern.** DO publishes to
   SYNTHESIS_RESULTS Queue. Worker queue handler forwards to Workflow via
   sendEvent. No self-fetch. No direct callback from DO to Worker.

5. **The Architect is single-turn Workers AI binding.** All other agents
   need multi-turn or tool calls, which Workers AI binding cannot handle.
   They use Workers AI REST API (or ofox.ai HTTP).

6. **BL6 is the blocker.** Training distribution inertia. Workers AI models
   default to function-call JSON. The fix is better models (ofox.ai), not
   better prompts.

7. **636 tests, 37 files, 0 regressions.** Do not break this. Run tests
   before every deploy.

8. **Commit messages are prefixed.** `INFRA:` for plumbing, `META:` for
   architecture docs, `FN-XXX:` for Function work, `GATE-N:` for coverage
   gate work.

### What Wes Needs to Do Before the Session

1. Top up ofox.ai credits ($10 minimum).
2. Have the OFOX_API_KEY ready (or already set as Worker secret).
3. Decide: deepseek-v4-pro or gemini-pro for synthesis agents.

### What the Session Should Accomplish

**Minimum:** Live synthesis passes with at least one atom producing real code.
**Target:** Sprint 1 complete + Sprint 2 started.
**Stretch:** Sprint 1 + Sprint 2 + Phase G (Sprint 5) in parallel.

---

## Appendix A: ADR Index

| ADR | Title | Status | Key Decision |
|-----|-------|--------|-------------|
| ADR-003 | pi SDK as default executor | Active | gdk-agent for all agent loops |
| ADR-004 | Custom StateGraph over LangGraph | Active | 80-line graph runner, no LangGraph |
| ADR-005 | Vertical Slicing Execution | Proposed | 3-phase: serial plan, parallel atoms, integration |
| ADR-006 | Workers AI Stream Adapter | Active | Text tool detection, REST API streaming |
| ADR-007 | Output Reliability Layer | Proposed | 5-tier parse, 7 failure modes, schema-driven |
| ADR-008 | Self-Healing Factory | Proposed | 7 monitoring domains, Governor + SystemsEngineer, hot config |

All ADRs at: `/Users/wes/Developer/function-factory/specs/reference/ADR-*.md`

## Appendix B: Ontology Extension Index

| Extension | File | Domains |
|-----------|------|---------|
| Core ontology | `specs/ontology/factory-ontology.ttl` | 1-7 |
| SHACL shapes | `specs/ontology/factory-shapes.ttl` | C1-C16 |
| Output reliability | `specs/ontology/output-reliability-extension.ttl` | 8-9, F1-F7, BL1-BL7, DI1-DI8, C17-C25 |
| Self-healing | ADR-008 SS15 | Domain 10 (proposed) |

## Appendix C: Test File Inventory

37 test files, 636 tests total. Key test files:

| File | Tests | Covers |
|------|-------|--------|
| `agents/output-reliability.test.ts` | ~80 | ORL pipeline, all failure modes |
| `agents/architect-agent.test.ts` | ~20 | BriefingScript production |
| `agents/planner-agent.test.ts` | ~15 | SlicePlan generation |
| `agents/coder-agent.test.ts` | ~15 | CodeArtifact production |
| `agents/tester-agent.test.ts` | ~15 | TestReport production |
| `agents/verifier-agent.test.ts` | ~15 | Verdict production |
| `agents/workers-ai-stream.test.ts` | ~20 | Stream adapter, text tool detection |
| `agents/context-prefetch.test.ts` | ~10 | ArangoDB pre-fetch |
| `coordinator/graph-9node.test.ts` | ~25 | Full 9-node graph execution |
| `coordinator/coordinator-*.test.ts` | ~60 | Coordinator wiring, callbacks, hot-config |
| `coordinator/atom-executor-do.test.ts` | ~15 | Per-atom execution |
| `coordinator/completion-ledger.test.ts` | ~10 | Crash recovery ledger |
| `coordinator/vertical-slicing.test.ts` | ~15 | Layer dispatch, placeholder resolution |
| `coordinator/sandbox-*.test.ts` | ~20 | Sandbox wiring, deps factory |
| `config/hot-config.test.ts` | ~20 | ArangoDB config loading |
| `pipeline.test.ts` | ~15 | Workflow stages |
| `crp.test.ts` | ~7 | CRP auto-generation |
| `lifecycle.test.ts` | ~10 | Lifecycle state machine |
| `stages/compile.test.ts` | ~15 | 8-pass compiler in pipeline |
| `stages/semantic-grounding.test.ts` | ~10 | Semantic review grounding |

## Appendix D: ArangoDB Collections (Production)

**Core pipeline:**
`specs_signals`, `specs_pressures`, `specs_capabilities`,
`specs_functions`, `specs_prds`, `specs_workgraphs`,
`specs_coverage_reports`, `consultation_requests`,
`version_controlled_resolutions`

**Ontology:**
`ontology_classes`, `ontology_properties`, `ontology_relations`

**Agent config:**
`agent_designs`, `mentorscript_rules`, `model_routing`,
`model_capabilities`, `orl_config`

**Telemetry (ADR-008, to be created):**
`pipeline_health_events`, `gate_effectiveness_events`,
`agent_quality_events`, `output_reliability_events`,
`infrastructure_health_events`, `ontology_compliance_events`,
`self_healing_metrics`, `self_healing_deployments`

---

**End of handoff.** The next session starts at Sprint 1, Step 1.
