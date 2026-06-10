# Architecture — function-factory

> Phase 4 · Architect · Generated 2026-06-08 · Updated 2026-06-10

---

## System Overview

Function Factory is a **domain-neutral, closed-loop compiler** that transforms Signals (raw observations) into trustworthy executable Functions, then feeds runtime observations back as new Signals. It runs entirely on Cloudflare Workers infrastructure.

The system has two distinct pipeline sections:
1. **Discovery Core** (documented here in depth): Signal → Pressure → Capability → FunctionProposal → IntentSpecification → ExecutableSpecification
2. **Execution Core** (partially implemented): Synthesis, Effectors, Observability, Feedback

---

## C4 Context (Level 1)

See `c4-context.md` for Mermaid diagram.

**Actors and systems:**
- **Architect (human)** — approves Function Proposals via event API (7-day window)
- **ff-pipeline** — the core system; receives signals, orchestrates compilation, dispatches synthesis
- **D1 (ff-factory)** — Cloudflare serverless SQLite for worker operational state (keepalive, dispatch logs, bead metadata)
- **ArangoDB** — artifact graph (signals, pressures, capabilities, ES, lineage)
- **Gas City** — external molecule execution platform receiving dispatched functions
- **GitHub** — PR creation destination; source of file context for compilation
- **Workers AI** — LLM provider (llama-70b, kimi-k2.6) for all AI passes
- **Cloudflare Queues** — async decoupling between Workflow ↔ DOs ↔ Workers

---

## C4 Containers (Level 2)

See `c4-containers.md` for Mermaid diagram.

| Container | Technology | Responsibility |
|-----------|-----------|---------------|
| `ff-pipeline` Worker | CF Worker + WorkflowEntrypoint | Main Workflow: stages 1-5, coherence gate, synthesis dispatch |
| `SynthesisCoordinator` DO | CF DurableObject (Agent) | Agent graph: Architect/Planner/Coder/Critic/Tester/Verifier |
| `AtomExecutor` DO | CF DurableObject | Per-atom execution DO (vertical slicing) |
| `ff-gates` Worker | CF WorkerEntrypoint | Coherence Verification service binding |
| `GasCitySupervisor` Container | CF Container | Gas City daemon hosting, bead store proxy |
| `FactoryStore` DO | CF DurableObject (SQLite) | SQLite-backed bead/spec store for Gas City |
| `ff-gateway` Worker | CF Worker | Public HTTP gateway / routing layer |
| `ff-arango` Worker | CF Container Worker | ArangoDB proxy container |
| `@factory/packages` | pnpm library packages | Domain logic: schemas, compiler, verification, signal-hygiene, db-client (renamed from arango-client, PR #79), task-routing, file-context, etc. |

---

## Key Architectural Decisions

### AD-01: Cloudflare Workflow for Durable Orchestration
The pipeline uses CF Workflows (`WorkflowEntrypoint`) for durable, step-based execution with built-in retry, step deduplication (by name), and waitForEvent for human-in-the-loop gates.

**Consequence:** Steps are idempotent by name — replayed steps return cached results. All step functions must be pure-serializable (hence `toStep()` JSON normalization).

### AD-02: Queue-Decoupled DO↔Workflow Communication
DOs cannot self-fetch their Worker URL (CF error 1042). The pipeline uses Queues as the communication channel: Workflow enqueues synthesis request → queue consumer calls DO → DO publishes result to `SYNTHESIS_RESULTS` queue → queue consumer calls `workflow.sendEvent()`.

Origin: `pipeline.ts` comments in enqueue-synthesis and synthesis-complete sections.

**Addendum:** keepalive lifecycle (POST /v0/keepalive/start on dispatch, /stop on RELEASE or amendment_halted) was added in PR #84.

### AD-03: Minimal-Context Per Compilation Pass (Anti-Corruption)
Each compilation pass receives only the fields it needs. File paths are stripped from atom contexts sent to dependency/invariant/interface/binding/validation passes to prevent models confusing file paths with atom IDs.

Origin: `compile.ts:runLivePass` context slicing comments.

### AD-04: IntentAnchor Crystallization as a Probe Layer
Before compilation, 3-6 binary yes/no checkpoints are crystallized from the signal's intent and persisted. The probe runs in an isolated LLM call with different context to prevent cuing from the generation context.

Origin: `crystallize-intent.ts`, `intent-probe.ts`

### AD-05: Fail-Open Feature Flags
Crystallizer, learning capture, and observations are fail-open: errors are suppressed and the feature degrades gracefully rather than blocking the pipeline. Only Coherence Verification is fail-closed.

Origin: Multiple `catch(() => {})` patterns in pipeline.ts

### AD-06: specContent as Ground Truth Mode
When a Signal carries `specContent`, the entire pipeline switches from generative to extractive mode. All LLM prompts change to treat specContent as the sole source of truth, preventing hallucination.

Origin: `propose-function.ts:SPEC_GROUNDED_PROMPT`

### AD-07: Graph Path Deprecation (ADR-009)
The SynthesisCoordinator's in-DO synthesis execution path was deprecated. A deliberate `throw new Error('[DEPRECATED]...')` prevents any execution. All synthesis now routes through the harness path (`/trigger-harness`). The coordinator code structure remains for context and crash recovery infrastructure.

Origin: `coordinator.ts:synthesize()` DEPRECATED throw

### AD-08: D1 / ArangoDB Split
D1 (Cloudflare serverless SQLite) was introduced for operational state that lives within a single worker lifecycle. ArangoDB continues to hold the artifact graph spanning the full pipeline. This split avoids ArangoDB connections in high-frequency operational paths.

Origin: PR #79 (arango-client → db-client rename), PR #80 (ff-factory D1 schema applied)

---

## Package Dependency Principles

1. `@factory/schemas` is the sole shared dependency — all packages depend on it directly
2. `@factory/compiler` is the only package with a two-level chain: `compiler → verification → schemas`
3. All other packages depend only on `schemas` (no internal package cycles)
4. External dependencies are minimal: `zod` (validation), `yaml` (serialization)

---

## KSP Layer

The Knowing-State Prosthesis (KSP) layer is the structural substrate beneath the Gas City execution surface. It externalizes, retrieves, maintains, and fail-closes the knowing-state that governs agent execution across every domain instantiation of Function Factory.

### Architectural Thesis

Every domain where an executing agent must act under a knowing-state it cannot reliably bear has the same structural problem. The agent needs externalized, retrievable, maintained, fail-closed access to the conceptual content that governs its actions. The KSP architecture solves governance — not retrieval alone. Four implementation invariants hold across every domain:

| Invariant | Requirement |
|-----------|-------------|
| **I1 — Externalization** | Knowing-state content held in a substrate distinct from the executing agent |
| **I2 — Retrieval enforcement** | Agent retrieves from the prosthesis at the moment of execution; enforced by architecture |
| **I3 — Continuous maintenance** | Prosthesis decays without active upkeep; maintenance is an ongoing relation |
| **I4 — Fail-closed coupling** | When the prosthesis fails to mediate, execution does not proceed unprotected |

### Two-Layer Design

The KSP layer splits knowing-state governance across two complementary storage layers:

**Artifact Graph** (`@factory/artifact-graph`) — the lineage-authoritative record of the specification-execution cycle. Holds what was specified, what was executed, what diverged, what was proposed to fix it, what verified correctness. One Durable Object per namespace (`domain:org:scope`). Append-only by convention.

**Bead Graph** (`@factory/bead-graph`) — the knowing-state content that makes executions lawful. Holds policy, trust, execution records, outcomes, amendments, consent, escalations, and audit trail. One Durable Object per org. Content-addressed append-only DAG. Eight Bead types. Four prosthesis invariants enforced at SDK layer.

The two layers are connected by five bridge points implemented in `@factory/loop-closure`. Neither storage layer knows about the other. Bridge fields in Bead content (`artifact_graph_execution_id`, `artifact_graph_divergence_id`, `artifact_graph_amendment_id`, `artifact_graph_specification_id`) carry cross-layer references.

### Package Build Order

Packages must be built in this sequence — each phase depends on the prior phase compiling clean:

```
Phase 1 (no dependencies between them):
  @factory/artifact-graph  →  @factory/bead-graph

Phase 2 (depends on bead-graph):
  @factory/ksp-sdk

Phase 3 (depends on artifact-graph + bead-graph):
  @factory/loop-closure

Phase 4 (depends on all three base packages):
  @factory/factory-graph  →  @factory/gears

Phase 5 (depends on factory-graph + gears):
  .flue/workflows  (Flue workflow layer)
```

Typecheck gate (`tsc --noEmit` zero errors) must pass at each step before proceeding to the next package.

### Single-Host Constraint

The entire KSP layer runs on Cloudflare infrastructure only. No external database services, no self-hosted nodes, no ArangoDB for new instantiations. The constraint is architectural: Cloudflare Durable Object SQLite provides the single-writer serialization guarantee required by INV-KSP-003.

### Cloudflare Stack

| Service | Role in KSP |
|---------|-------------|
| **CF Workers** | Request routing, loop-closure coordination, namespace extraction, DO routing |
| **CF Durable Objects (SQLite)** | ArtifactGraphDO (per namespace) + BeadGraphDO (per org); 10 GB per DO; primary persistent store |
| **CF KV** | Hot cache for knowing-state (`ks:{orgId}:{roleId}:{category}` TTL 300 s); TTL-based invalidation on amendment adoption |
| **CF D1** | Cross-run audit log only (`factory-bead-audit`); not a primary store |
| **CF R2** | DO SQLite WAL snapshots (managed by CF); 30-day PITR |
| **CF Containers / Sandbox** | Gas City daemon (existing); PI container execution (existing); not KSP-specific |

### Key Architectural Decisions

| ADR | Decision |
|-----|---------|
| **ADR-KSP-001** | Two-layer storage split: artifact graph (lineage provenance) vs Bead graph (knowing-state content). Neither layer is a superset of the other. |
| **ADR-KSP-002** | Cloudflare DO SQLite as the exclusive storage substrate for both layers. One DO per namespace (artifact graph) or per org (Bead graph). Eliminates ArangoDB for new KSP instantiations. |
| **ADR-KSP-003** | CF KV hot cache with defined TTL patterns and mandatory invalidation on amendment adoption. Hot cache is a performance optimization — it is never the source of truth. |
| **ADR-KSP-004** | Content-addressed Bead identity: `bead_id = SHA-256(type + canonical_json(content) + sorted(parent_ids))`. Computed before every write. Mismatch throws `BeadIntegrityError`. |
| **ADR-KSP-005** | `@factory/ksp-sdk` isolation: the SDK package re-exports the `KnowingStateSDK` interface from `bead-graph` with zero factory-specific imports. Domain consumers depend on the SDK, not on the storage layer directly. |

---

## Technical Debt

| Debt Item | Location | Severity |
|-----------|---------|---------|
| Semantic review miscast does not block pipeline (only advisory) | `pipeline.ts` TODO comment | Medium |
| Instruction Tuning step permanently blocked (Trellis path removed) | `pipeline.ts:instruction-tuning` | High — always returns 'blocked', always persists VR failure |
| SynthesisCoordinator graph path deprecated but code retained | `coordinator.ts` | Low — code debt, no runtime impact |
| AQL collection creation is on-demand with `catch(() => {})` | `pipeline.ts:persist-intent-anchors` | Medium — silent failures possible |
| `data-dictionary.md` for FactoryStore SQLite schema not yet extracted | `factory-store-do.ts` | Low |
| No migration system for ArangoDB schema evolution | All stages | Medium — applies to artifact graph only; D1 operational schema (ff-factory) uses applied migrations per AD-08 |
