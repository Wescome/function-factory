# Inventory — function-factory

> Phase 1 · Scout · Re-generated 2026-06-10 (post D1 migration, diff patch)

---

## Project Overview

**Name:** function-factory
**Description:** An upstream-to-downstream compiler for trustworthy executable Functions.
**Author:** Wislet J. Celestin (wes@koales.ai)
**License:** UNLICENSED (proprietary)
**Version:** 0.0.1

---

## Technology Stack

| Dimension | Value | Confidence |
|-----------|-------|-----------|
| Primary language | TypeScript | 🟢 CONFIRMED — package.json `"type": "module"`, 424 `.ts` source files |
| Runtime | Cloudflare Workers (edge) | 🟢 CONFIRMED — `cloudflare:workers` imports, wrangler configs |
| Package manager | pnpm 9.0.0 | 🟢 CONFIRMED — `pnpm-workspace.yaml`, `packageManager` field |
| Node version | >=20.0.0 | 🟢 CONFIRMED — engines field in package.json |
| Test framework | vitest | 🟢 CONFIRMED — `devDependencies.vitest`, 160 `.test.ts` files |
| Compiler/bundler | wrangler (Cloudflare) | 🟢 CONFIRMED — `.wrangler/` dirs in all workers |
| DB | D1 (Cloudflare) for worker operational state; ArangoDB for artifact store | 🟢 CONFIRMED — `factory-store-do.ts` (D1 SQLite), `packages/db-client`, env vars `ARANGO_URL/DATABASE/JWT` |
| AI/LLM | Workers AI (llama-70b, kimi-k2.6) | 🟢 CONFIRMED — `model-bridge.ts`, `@factory/task-routing` |
| Agent orchestration | `@weops/gdk-agent` | 🟢 CONFIRMED — `coordinator.ts` imports |

---

## Monorepo Structure

```
function-factory/
├── workers/                     # Cloudflare Worker entry points
│   ├── ff-pipeline/             # Main pipeline Workflow + DOs
│   │   └── src/
│   │       ├── index.ts         # Worker export root
│   │       ├── pipeline.ts      # FactoryPipeline WorkflowEntrypoint (Discovery Core)
│   │       ├── stages/          # Per-stage pure functions
│   │       │   ├── ingest-signal.ts
│   │       │   ├── synthesize-pressure.ts
│   │       │   ├── map-capability.ts
│   │       │   ├── propose-function.ts
│   │       │   ├── semantic-review.ts
│   │       │   ├── crystallize-intent.ts
│   │       │   ├── compile.ts             # 8-pass compiler
│   │       │   ├── intent-probe.ts
│   │       │   ├── reconciliation-gate.ts
│   │       │   ├── drift-ledger.ts
│   │       │   └── generate-pr.ts
│   │       ├── coordinator/     # SynthesisCoordinator DO + AtomExecutor DO
│   │       ├── agents/          # Architect/Coder/Tester/Verifier/Critic/Planner
│   │       ├── gascity/         # Gas City dispatch and webhook receiver
│   │       ├── compilers/       # Formula/contract compilers
│   │       ├── observability/   # RunEventLog
│   │       └── config/          # Hot config loaders
│   ├── gascity-supervisor/      # Gas City Container Worker + FactoryStore DO
│   │   └── src/
│   │       ├── index.ts         # GasCitySupervisor Container + fetch router
│   │       └── factory-store-do.ts  # SQLite-backed bead/artifact store
│   ├── ff-gates/                # Coherence Verification service (deterministic)
│   │   └── src/index.ts
│   ├── ff-gateway/              # Public HTTP gateway
│   └── ff-arango/               # ArangoDB proxy Container Worker
├── packages/                    # Shared library packages
│   ├── schemas/                 # Canonical Zod schemas for ALL artifacts
│   ├── db-client/               # D1/ArangoDB client wrapper (renamed from arango-client)
│   ├── arango-client-OLD/       # (deprecated — migration artifact, safe to delete)
│   ├── compiler/                # Intent-to-Executable pass engine
│   ├── verification/            # VR schema + helpers
│   ├── capability-delta/        # DEL/FP delta computation
│   ├── signal-hygiene/          # Signal normalization + dedup
│   ├── adaptive-recalibration/  # RPRS/DDI recalibration
│   ├── architecture-candidates/ # AC generation
│   ├── candidate-selection/     # ACS selection
│   ├── runtime-admission/       # RAD allow/deny
│   ├── execution-lifecycle/     # EXS/EXT/EXR lifecycle
│   ├── controlled-effectors/    # EFF tool policy enforcement
│   ├── effector-realization/    # EFFR safe_execute
│   ├── observability-feedback/  # OBS → SIG feedback
│   ├── meta-governance/         # PSR/GOVP/GOVD/GOVS
│   ├── policy-activation/       # GOVA/GOVR
│   ├── assurance-graph/         # Incident propagation graph
│   ├── runtime/                 # Trust scoring, invariant health
│   ├── task-routing/            # LLM task-kind → model routing
│   ├── gdk-ai/                  # AI client abstraction
│   ├── gdk-agent/               # Agent loop library
│   ├── gdk-ts/                  # TypeScript GDK utilities
│   ├── file-context/            # File structure extraction
│   ├── ff-context/              # Function-factory shared context helpers
│   ├── ff-arango/               # ArangoDB integration package
│   ├── intent-authoring/        # Intent Specification authoring helpers
│   ├── recursion-governance/    # Recursion depth governance
│   ├── artifact-validator/      # Artifact schema validation
│   ├── autonomous-scheduler/    # Autonomous task scheduling
│   ├── diff-engine/             # Diff computation engine
│   ├── function-synthesis/      # Function synthesis helpers
│   ├── harness-bridge/          # Test harness bridge
│   ├── learning/                # Learning transcript capture
│   ├── literate-tools/          # Literate programming utilities
│   ├── nlah/                    # Natural language artifact helpers
│   ├── ontology-loader/         # Ontology loading and registration
│   ├── selection-bias/          # Selection bias detection
│   ├── stream-types/            # Streaming type definitions
│   └── transmission-adapters/  # Transmission/messaging adapters
├── specs/                       # Live artifact storage (YAML files)
│   ├── signals/
│   ├── pressures/
│   ├── capabilities/
│   ├── intent-specifications/
│   ├── executable-specifications/
│   ├── verification-reports/
│   └── ...
├── docs/adr/                    # Architecture Decision Records
├── evidence/dogfood-runs/       # Dogfood execution evidence
├── harnesses/                   # Gas City formula templates
├── infra/                       # ArangoDB init scripts, launchd
└── scripts/                     # Ops and audit scripts
```

---

## Entry Points

| Entry Point | Role | Confidence |
|-------------|------|-----------|
| `workers/ff-pipeline/src/pipeline.ts` | `FactoryPipeline` — CF Workflow orchestrating all pipeline stages | 🟢 CONFIRMED |
| `workers/ff-pipeline/src/index.ts` | Worker export root + DO/Workflow binding re-exports; delegates queue and trigger-synthesis to extracted handlers | 🟢 CONFIRMED |
| `workers/ff-pipeline/src/queue-handler.ts` | **[2026-06-10 new]** Queue consumer logic extracted from barrel — clean import graph (type-only static imports) | 🟢 CONFIRMED |
| `workers/ff-pipeline/src/trigger-synthesis-handler.ts` | **[2026-06-10 new]** `/trigger-synthesis` route handler extracted from barrel — clean import graph | 🟢 CONFIRMED |
| `workers/gascity-supervisor/src/index.ts` | `GasCitySupervisor` Container + `FactoryStore` DO + fetch router | 🟢 CONFIRMED |
| `workers/ff-gates/src/index.ts` | `GatesService` — Coherence Verification via Service Binding | 🟢 CONFIRMED |
| `workers/ff-gateway/src/index.ts` | HTTP gateway (public-facing) | 🟢 CONFIRMED |
| `workers/ff-arango/src/index.ts` | ArangoDB proxy | 🟢 CONFIRMED |

---

## Key CI/CD and Infrastructure

| File | Purpose | Confidence |
|------|---------|-----------|
| `.github/workflows/` | GitHub Actions CI | 🟢 CONFIRMED |
| `docker-compose.yml` | Local dev environment | 🟢 CONFIRMED |
| `infra/arangodb/` | ArangoDB init scripts | 🟢 CONFIRMED |
| `infra/launchd/` | macOS launchd service config | 🟢 CONFIRMED |
| `pnpm-workspace.yaml` | Monorepo workspace | 🟢 CONFIRMED |
| `tsconfig.base.json` | Shared TypeScript config | 🟢 CONFIRMED |

---

## Test Coverage

| Metric | Value | Confidence |
|--------|-------|-----------|
| Test files | 160 | 🟢 CONFIRMED — `find` count |
| Source files | 424 | 🟢 CONFIRMED — `find` count |
| Test ratio | ~38% | 🟡 INFERRED — file count, not line count |
| Test framework | vitest | 🟢 CONFIRMED |
| Notable test gaps | `gascity-supervisor/` has limited unit tests | 🟡 INFERRED |

---

## D1 Schema (Worker Operational State — ff-factory)

`factory-store-do.ts` creates two tables in the worker's D1 binding:

```sql
documents(
  collection TEXT,
  key        TEXT,
  json       TEXT,
  created_at TEXT,
  PRIMARY KEY (collection, key)
)

edges(
  from_collection TEXT,
  from_key        TEXT,
  to_collection   TEXT,
  to_key          TEXT,
  label           TEXT
)
```

D1 stores live operational state (bead/artifact tracking inside `GasCitySupervisor`). ArangoDB remains the durable artifact store for the Discovery Core chain.

---

## ArangoDB Collections (Live Artifact Store)

| Collection | Artifact Type | Prefix |
|-----------|--------------|--------|
| `specs_signals` | External Signals | `SIG-` |
| `specs_pressures` | Pressure Artifacts | `PRS-` |
| `specs_capabilities` | Business Capabilities | `BC-` |
| `specs_functions` | Function Proposals | `FP-` |
| `executable_specifications` | Executable Specifications | `ES-` |
| `lineage_edges` | Provenance graph edges | — |
| `verification_reports` | VR (coherence, fidelity, semantic) | `VR-` |
| `execution_artifacts` | Code/test/synthesis summaries | `EA-` |
| `intent_anchors` | Crystallized intent anchors | `IA-` |
| `verification_status` | Latest gate pass/fail by family | — |
| `memory_episodic` | Episodic synthesis memory | `ep-` |

---

## External Integrations

| System | Protocol | Purpose | Confidence |
|--------|---------|---------|-----------|
| ArangoDB | HTTP/REST (arangosh-compatible) | Artifact persistence, lineage graph | 🟢 CONFIRMED |
| Workers AI | CF binding (`.run()`) | LLM model calls (planning, structured, synthesis) | 🟢 CONFIRMED |
| GitHub REST API | HTTPS | PR creation, file content fetch | 🟢 CONFIRMED |
| Gas City platform | HTTPS + HMAC | Molecule execution dispatch, webhook | 🟢 CONFIRMED |
| Cloudflare Queues | CF binding (`.send()`) | Stage-to-stage async dispatch | 🟢 CONFIRMED |
| Dolt / R2 | S3-compatible | Gas City bead store persistence | 🟢 CONFIRMED |

---

## Discovery Core Artifact Chain

The pipeline's primary "Discovery Core" artifact chain, in order:

```
Signal (SIG) → Pressure (PRS) → Capability (BC) → Function Proposal (FP)
  → Intent Specification → Executable Specification (ES/WG)
```

All artifacts are persisted to ArangoDB with lineage edges, forming a traversable provenance graph.

---

## KSP Layer — Incoming Packages

> Added by Reversa Scout forward run · 2026-06-10
> Specs dir: `/tmp/ksp-impl/ksp-impl-specs`
> Naming: all `@koales/` references in source specs are mapped to `@factory/` below per package naming rule.

These packages implement the **Knowing-State Prosthesis** architecture (SPEC-KSP-ARCH-001). They introduce two complementary DO-backed storage layers (artifact graph + bead graph) and a loop-closure bridge, then wire everything into the existing Factory execution substrate via `@factory/gears` and Flue workflows.

---

### @factory/artifact-graph

| Field | Value |
|-------|-------|
| Spec source | SPEC-KSP-ARTIFACT-GRAPH-001 |
| Package path | `packages/artifact-graph/` |
| Cloudflare primitives | **DO SQLite** (one DO per namespace `domain:org:scope`) |
| Implementation steps | Steps 1–9 (SPEC-KSP-ARCH-001 Phase 1, Table rows 1–9) |
| Key dependencies | none (base package) |

Domain-agnostic artifact graph substrate. Holds the lineage-authoritative record of the specification-execution cycle: Specification, Execution, ExecutionTrace, Divergence, Hypothesis, Amendment, ElucidationArtifact, VerificationProcess, Verdict nodes. Two-table SQLite schema (`nodes` + `edges`). Append-only by convention (INV-AG-001). Exports `ArtifactGraphDOBase<Env>` abstract class with six generic traversal contracts (`walkLineageBackward`, `walkLineageForward`, `walkBoundedPath`, `collectLineageIds`, plus node/edge CRUD).

---

### @factory/bead-graph

| Field | Value |
|-------|-------|
| Spec source | SPEC-KSP-BEAD-GRAPH-001 |
| Package path | `packages/bead-graph/` |
| Cloudflare primitives | **DO SQLite** (one DO per org) + **KV** hot cache (six key patterns, defined TTLs) |
| Implementation steps | Steps 10–20 (SPEC-KSP-ARCH-001 Phase 1, Table rows 8–16) |
| Key dependencies | none (base package, parallel with artifact-graph) |

Domain-agnostic Bead graph substrate. Holds the knowing-state content that governs execution: eight Bead types (PolicyBead, TrustBead, ExecutionBead, OutcomeBead, AmendmentBead, ConsentBead, EscalationBead, AuditBead). Content-addressed identity: `bead_id = SHA-256(type + canonical_json(content) + sorted(parent_ids))` (INV-BG-002). Write-once (INV-BG-001). AuditBead in every transaction (INV-BG-007). Fail-closed on retrieval failure: `autonomyFloor = SUGGEST` (INV-BG-008). Exports `BeadGraphDOBase<Env>` abstract class and `KnowingStateSDK` implementation enforcing I1–I4 prosthesis invariants. KV hot cache layer: six key patterns (`ks:`, `head:`, `consent:`, `policy:`, `session:`, `maintenance:`).

---

### @factory/ksp-sdk

| Field | Value |
|-------|-------|
| Spec source | SPEC-KSP-BEAD-GRAPH-001 §8 |
| Package path | `packages/ksp-sdk/` (formerly `knowing-state-sdk`) |
| Cloudflare primitives | none (re-export only) |
| Implementation steps | Step 21 (SPEC-KSP-ARCH-001 Phase 2, Table row 17) |
| Key dependencies | `@factory/bead-graph` |

Thin SDK re-export package. `src/index.ts` re-exports `KnowingStateSDK` interface and `Session` types from `@factory/bead-graph`. No domain-specific imports. Consumed by Factory (Mediation Agent DO), ComeFlow, CareTrace. Enforces: `retrieveKnowingState()` must be called before `writeExecutionBead()` (I2); failure sets `autonomyFloor = SUGGEST` (I4).

---

### @factory/loop-closure

| Field | Value |
|-------|-------|
| Spec source | SPEC-KSP-LOOP-CLOSURE-001 |
| Package path | `packages/loop-closure/` |
| Cloudflare primitives | none (coordinates writes across artifact-graph DO and bead-graph DO via injected stubs) |
| Implementation steps | Steps 22–26 (SPEC-KSP-ARCH-001 Phase 3, Table rows 18–21) |
| Key dependencies | `@factory/artifact-graph`, `@factory/bead-graph` |

Bridge between the two storage layers. Neither storage layer knows about the other; all cross-layer writes go through `LoopClosureService` (INV-LC-001). Implements five bridge points:

1. **Session open** — Specification governs ExecutionBead (`activeSpecificationId` stored in KV session)
2. **Execution write** — ExecutionBead → Execution node (artifact graph write precedes bead graph write; INV-LC-003)
3. **Execution trace** — ExecutionTrace + optional Divergence → OutcomeBead with `artifact_graph_divergence_id`
4. **Divergence triggers amendment** — Hypothesis + Amendment nodes → AmendmentBead with `artifact_graph_amendment_id`
5. **Amendment adoption** — new Specification + ElucidationArtifact (INV-LC-005) + new TrustBead/PolicyBead + KV invalidation (INV-LC-006)

Exports `LoopClosureService` taking three domain-injectable functions: `detectDivergences`, `buildHypothesis`, `verifyAmendment`.

---

### packages/factory-graph

| Field | Value |
|-------|-------|
| Spec source | SPEC-KSP-FACTORY-001 |
| Package path | `packages/factory-graph/` |
| Cloudflare primitives | inherits DO SQLite from artifact-graph and bead-graph base classes |
| Implementation steps | Steps 27–33 (SPEC-KSP-ARCH-001 Phase 4 + SPEC-KSP-FACTORY-001 §12 steps 1–9) |
| Key dependencies | `@factory/artifact-graph`, `@factory/bead-graph`, `@factory/loop-closure` |

Factory domain instantiation of both storage layers. Provides:

- `FACTORY_NODE_TYPES` — extends `CORE_NODE_TYPES` with `Signal`, `Pressure`, `Capability`, `FunctionProposal`, `PRD`, `WorkGraph`, `Invariant`, `CoverageReport`, `AtomDirective`, `TraceFragment`
- `FACTORY_REL_TYPES` — extends `CORE_REL_TYPES` with `source_ref`, `compiles_to`, `instantiates`, `addresses`, `derived_from`, `dispatched_as`, `produced_trace`, `gate_result`
- `FactoryArtifactGraphDO` extending `ArtifactGraphDOBase` with domain-specific query methods (`getDivergencesForSpecification`, `getAmendmentLoop`)
- `FactoryBeadGraphDO` extending `BeadGraphDOBase` with Factory Bead schemas: `ArchitectureDecisionBead` (PolicyBead), `PatternTrustBead` (TrustBead), `CommitBead` (ExecutionBead), `BuildOutcomeBead` (OutcomeBead), `ArchAmendmentBead` (AmendmentBead)
- `factoryDivergenceDetector`, `factoryHypothesisBuilder` (Claude Opus), `factoryAmendmentVerifier` — the three injectable loop closure functions
- `LoopClosureService` instantiated with Factory injectables

Consumed by: Mediation Agent DO, Commissioning Agent, Architect Agent DO, `@factory/gears` `CoordinatorDO`.

---

### @factory/gears

| Field | Value |
|-------|-------|
| Spec source | SPEC-FF-GEARS-001 |
| Package path | `packages/gears/` |
| Cloudflare primitives | **DO SQLite** (`CoordinatorDO` — one per WorkGraph execution, `runId = SHA-256(workGraphId + workGraphVersion)`), **D1** (cross-run bead audit log), **Container** (Sandbox class extending `@cloudflare/sandbox`), **KV** (via loop-closure), **WorkerLoader** (`LOADER` binding — required by `@cloudflare/think` `createExecuteTool`) |
| Implementation steps | Steps 34–44 (SPEC-FF-GEARS-001 §14 steps 1–16, parallel track with KSP packages) |
| Key dependencies | `@factory/schemas`, `@factory/ksp-sdk`, `@factory/artifact-graph`, `@factory/bead-graph`, `@factory/loop-closure`, `packages/factory-graph`, `@cloudflare/think`, `@cloudflare/sandbox`, `@mastra/core`, `@mastra/memory`, `@mastra/cloudflare-d1` |

Complete harness and execution substrate layer. Absorbs three previously separate concerns: atom execution (replaces `@factory/harness-bridge`, `@flue/runtime`, and Gas City), Execution-Trace Bead Graph (replaces `@factory/runtime` stub), Gear Registry (D1-backed Gear/GearFormula/GearMolecule). Key exports:

- `src/agents/think-executor.ts` — **[2026-06-13 new — Flue retirement ADR-014]** `ThinkExecutor extends Think<Env>`. Durable execution substrate only — does NOT own LLM loop. `executeAtom(directive)` calls `runFiber('atom-execution', ...)`, constructs `ConductingAgent` locally, calls `agent.generate()`, evaluates `successCondition`, then POSTs `/release` or `/fail` to `CoordinatorDO`. DO key: `think-${executableSpecificationId}-${atomId}`. Dispatched by ff-pipeline queue consumer via `POST /execute-atom`.
- `src/agents/conducting-agent.ts` — **[2026-06-13 new — Flue retirement ADR-014]** `buildConductingAgent()` factory. Mastra `Agent` owning LLM routing (`MODEL_BY_ROLE`), D1-backed observational memory (`@mastra/memory` + `@mastra/cloudflare-d1`), input processors (UnicodeNormalizer, PromptInjectionDetector, ModerationProcessor, PIIDetector), output processors (ConsentBeadAuditProcessor, ToolCallFilter, BatchPartsProcessor, PIIDetector). Tools: `createWorkspaceTools`, `createExecuteTool`, `createSandboxTools`.
- `src/agents/models.ts` — **[2026-06-13 new]** `MODEL_BY_ROLE` map. planner: `anthropic/claude-opus-4-6`. coder: `cloudflare/@cf/moonshotai/kimi-k2.6` (`bypassGateway: true`, `thinkingLevel: 'low'`). critic/tester/verifier: `openai/gpt-5.5`.
- `src/processors/consent-bead-audit-processor.ts` — **[2026-06-13 new]** `ConsentBeadAuditProcessor extends BaseProcessor`. I4 fail-closed consent enforcement. Fires at `processOutputStep` boundary (after LLM response, before tool dispatch). POSTs `/consent` to `CoordinatorDO` for every tool call (audit trail). Throws `ConsentDeniedError` if tool not in `directive.permittedTools`.
- `src/beads/coordinator-do.ts` — **[2026-06-10 updated]** `CoordinatorDO` with `seedBeads()` + `/seed` route, `initRun()` arms stale-bead alarm, `getNextReady()` throws on unseeded molecule, KV_KS binding fix, `recordOutcome()` non-fatal (BP3 HARD GATE not yet cleared). 🔴 GAP: `/consent` route not implemented (called by `ConsentBeadAuditProcessor`). 🔴 GAP: `claimBead` never called by `ThinkExecutor` before execution — `releaseBead`/`failBead` `WHERE assigned_to=?` will silently no-op.
- `src/beads/hook.ts` — `claimHook`, `releaseHook`, `failHook`, `getNextReady` consumed by ThinkExecutor
- `src/beads/d1-audit.ts` — **[2026-06-10 new]** D1 bead audit helpers: `insertBeadAudit()`, `queryBeadAudit()`, `BeadAuditRow` interface. Cross-run audit log in `factory-bead-audit` D1 database.
- `src/gears/` — `GearRegistry` (D1-backed), `GearFormula`, `GearMolecule` types

Retires: `@factory/harness-bridge` (deleted at step 47), `@factory/runtime` stub (deleted at step 47), Gas City dispatch, pi-coding-agent, `ff-flue` worker (merged into ff-pipeline + gears, 2026-06-10), **`@flue/runtime` + `src/flue/` directory** (deleted 2026-06-13, ADR-014 — replaced by `@cloudflare/think` + `@mastra/core`).

> **[2026-06-10 patch]** Flue atom-execution workflow moved from `.flue/workflows/atom-execution.ts` (standalone worker) into `packages/gears/src/flue/workflows/` (absorbed into gears substrate). Three fabricated workflows deleted — only `atom-execution` is specced. `@flue/runtime` real dep installed (was stub). `zod@^4.0.0` migration across all `@factory/*` packages.

> **[2026-06-13 patch — Flue retirement, ADR-014]** `src/flue/` directory deleted entirely (agents.ts, index.ts, sandbox.ts, workflows/atom-execution.ts, workflows/atom-execution-do.ts). Replaced by: `src/agents/` (ThinkExecutor, ConductingAgent, MODEL_BY_ROLE) and `src/processors/` (ConsentBeadAuditProcessor). `FlueAtomExecutionWorkflow` + `FlueRegistry` DOs retired — wrangler.jsonc v8 migration deletes them from CF migration tracker and registers `ThinkExecutor`. `THINK_EXECUTOR` DO binding + `LOADER` WorkerLoader binding added to wrangler.jsonc.

---

### Packages Deleted by This Implementation

| Package | Deleted at step | Reason |
|---------|----------------|--------|
| `packages/harness-bridge` | Step 47 (SPEC-FF-GEARS-001 §14 step 15) | Absorbed into `@factory/gears` — Flue wrapping + LLM routing now in `PROFILE_BY_ROLE` and `CoordinatorDO` |
| `packages/runtime` | Step 47 (SPEC-FF-GEARS-001 §14 step 15) | Stub only — replaced by `CoordinatorDO` bead store in `@factory/gears` |

---

### Build Order Summary

```
Phase 1 (parallel):  @factory/artifact-graph  (steps 1–9)
                     @factory/bead-graph       (steps 10–20)

Phase 2 (serial):    @factory/ksp-sdk          (step 21)   ← depends on bead-graph

Phase 3 (serial):    @factory/loop-closure     (steps 22–26) ← depends on artifact-graph + bead-graph

Phase 4 (serial):    packages/factory-graph    (steps 27–33) ← depends on all three base packages

Phase 5 (parallel):  @factory/gears            (steps 34–44, steps 1–12a independent of KSP)
                     ^^ step 12b requires Phase 3 complete ^^

Phase 6 (retired):   .flue/workflows           (steps 45–48) ← RETIRED 2026-06-13 (ADR-014)
                     Delete harness-bridge + runtime (step 47) ✅ done
                     Delete @flue/runtime + src/flue/ (2026-06-13) ✅ done
```
