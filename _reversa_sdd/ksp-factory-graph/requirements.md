# Requirements — @factory/factory-graph

**Module:** `packages/factory-graph`  
**SDD version:** 1.0  
**Date:** 2026-06-10  
**Source specs:** SPEC-KSP-FACTORY-001, SPEC-KSP-ARCH-001, SPEC-KSP-LOOP-CLOSURE-001

---

## 1. Functional Requirements

### FR-FG-001 — Factory Node Type Extension
🟢 **Confidence** (SPEC-KSP-FACTORY-001 §3)

`FACTORY_NODE_TYPES` must extend `CORE_NODE_TYPES` with the following ten additional types: `Signal`, `Pressure`, `Capability`, `FunctionProposal`, `PRD`, `WorkGraph`, `Invariant`, `CoverageReport`, `AtomDirective`, `TraceFragment`. The derived type `FactoryNodeType` must be exported.

**MoSCoW:** Must Have — downstream packages (`mediation-agent`, `commissioning`, `architect-agent`) depend on these literals at compile time.

---

### FR-FG-002 — Factory Relation Type Extension
🟢 **Confidence** (SPEC-KSP-FACTORY-001 §4)

`FACTORY_REL_TYPES` must extend `CORE_REL_TYPES` with eight additional types: `source_ref`, `compiles_to`, `instantiates`, `addresses`, `derived_from`, `dispatched_as`, `produced_trace`, `gate_result`. The derived type `FactoryRelType` must be exported.

**MoSCoW:** Must Have — edges in the artifact graph are validated against this constant.

---

### FR-FG-003 — Zod Schemas for All Factory Bead Types
🟢 **Confidence** (SPEC-KSP-FACTORY-001 §6)

`src/types.ts` must export Zod schemas for all five Factory Bead types:

| Schema | `type` literal | Universal structural type |
|--------|----------------|---------------------------|
| `ArchitectureDecisionBead` | `'arch_decision'` | PolicyBead |
| `PatternTrustBead` | `'pattern_trust'` | TrustBead |
| `CommitBead` | `'commit'` | ExecutionBead |
| `BuildOutcomeBead` | `'build_outcome'` | OutcomeBead |
| `ArchAmendmentBead` | `'arch_amendment'` | AmendmentBead |

Each schema must extend `BaseBead` from `@factory/bead-graph`. Bridge fields (`artifact_graph_*_id`) must be `z.string().optional()` — they are nullable by design (BR-KSP-10).

**MoSCoW:** Must Have

---

### FR-FG-004 — FactoryArtifactGraphDO — Durable Object Subclass
🟢 **Confidence** (SPEC-KSP-FACTORY-001 §13, code-analysis §1.1)

`FactoryArtifactGraphDO` must extend `ArtifactGraphDOBase<Env>` from `@factory/artifact-graph`. It provides the artifact graph Durable Object instantiated with Factory node/relation types. It must be exported from `src/artifact-do.ts` and re-exported from the barrel.

**MoSCoW:** Must Have

---

### FR-FG-005 — FactoryBeadGraphDO — Durable Object Subclass
🟢 **Confidence** (SPEC-KSP-FACTORY-001 §13, code-analysis §1.1)

`FactoryBeadGraphDO` must extend `BeadGraphDOBase<Env>` from `@factory/bead-graph`. It provides the Bead graph Durable Object instantiated with Factory Bead types. It must be exported from `src/bead-do.ts` and re-exported from the barrel.

**MoSCoW:** Must Have

---

### FR-FG-006 — factoryDivergenceDetector — Trace-to-Divergence Mapping
🟢 **Confidence** (SPEC-KSP-FACTORY-001 §8)

`factoryDivergenceDetector` must implement the `DivergenceDetector` interface from `@factory/loop-closure`. Its algorithm:
1. Read `TraceFragmentData` from the artifact graph node at `traceNodeId`.
2. For each `detector_firing`, map `severity` via `mapInvSeverity`: `'critical'` → `'critical'`, `'warning'` → `'medium'`, else `'low'`.
3. If `trace.outcome === 'failure'` and `trace.attempts_exhausted`, emit a severity `'high'` divergence keyed `claim-atom-outcome-{atom_id}`.
4. If `trace.outcome === 'timeout'` and `trace.attempts_exhausted`, emit a severity `'high'` divergence keyed `claim-atom-timeout-{atom_id}`.
5. Return `DetectedDivergence[]`. Return empty array if trace node is null.

**MoSCoW:** Must Have

---

### FR-FG-007 — factoryHypothesisBuilder — LLM-Driven Hypothesis Formation (stub-first)
🟢 **Confidence** (SPEC-KSP-FACTORY-001 §9)

`factoryHypothesisBuilder` must implement the `HypothesisBuilder` interface from `@factory/loop-closure`. Initial implementation must be a stub returning a hardcoded `HypothesisProposal` so that the type gate passes before Claude Opus wiring is added. The full implementation routes via `@factory/harness-bridge` with `taskKind: 'synthesis'` to Claude Opus, building a prompt from the `Divergence` node, the governing `Specification` node, and prior `ElucidationArtifact` nodes.

**MoSCoW:** Must Have (stub); Should Have (full LLM wiring)

---

### FR-FG-008 — factoryAmendmentVerifier — Coherence + Cross-Repo Pattern Score
🟢 **Confidence** (SPEC-KSP-FACTORY-001 §10)

`factoryAmendmentVerifier` must implement the `AmendmentVerifier` interface from `@factory/loop-closure`. It must:
1. Compute `coherenceScore` from the proposed change against the linked Divergence claims.
2. If `coherenceScore > 0.7`, call `architectAgentDO.checkCrossRepoPattern()` for `patternScore`; otherwise default `patternScore = 0.5`.
3. Return `passed: coherenceScore >= 0.75 && patternScore >= 0.5`.
4. The `gate` field must be `'compile'`.

If `coherenceScore < 0.75`, the `LoopClosureService` opens a CRP to the Architect Agent DO — this is a caller responsibility, not an internal one.

**MoSCoW:** Must Have

---

### FR-FG-009 — Barrel Export
🟢 **Confidence** (SPEC-KSP-FACTORY-001 §13)

`src/index.ts` must re-export all public symbols: `FactoryArtifactGraphDO`, `FactoryBeadGraphDO`, `factoryDivergenceDetector`, `factoryHypothesisBuilder`, `factoryAmendmentVerifier`, and `* from './types'`.

**MoSCoW:** Must Have

---

## 2. Non-Functional Requirements

### NFR-FG-001 — Compile-Clean at Every Step (Performance/Quality Gate)
🟢 **Confidence** (SPEC-KSP-FACTORY-001 §12 implementation table; SPEC-KSP-ARCH-001 §9)

`tsc --noEmit` must return zero errors after each of Steps 27–29, 31, and 33. Any TypeScript error in `@factory/factory-graph` propagates to all three consuming packages at build time.

---

### NFR-FG-002 — No Circular Dependencies on Base Packages (Architecture Constraint)
🟢 **Confidence** (SPEC-KSP-ARCH-001 §3, BR-KSP-15; domain.md BR-KSP-15)

`@factory/factory-graph` must not import from `@factory/ksp-sdk`. `@factory/ksp-sdk` has zero factory-specific imports by architectural invariant (ADR-KSP-005). The allowed dependency graph from `factory-graph` is: `@factory/artifact-graph`, `@factory/bead-graph`, `@factory/loop-closure`, `@factory/harness-bridge` (for hypothesis LLM routing only).

---

### NFR-FG-003 — Fail-Closed on Missing KnowingState (Availability)
🟢 **Confidence** (SPEC-KSP-ARCH-001 I4; code-analysis §1.3)

When `retrieveKnowingState()` throws in a Conducting Agent session, `session.autonomyFloor` must degrade to `'SUGGEST'`. Execution-level calls must throw `AutonomyDegradedError`. The package's DO classes must not mask this failure.

---

### NFR-FG-004 — Append-Only — Both Layers (Correctness Invariant)
🟢 **Confidence** (BR-KSP-05; SPEC-KSP-ARCH-001 INV-KSP-001)

Neither `FactoryArtifactGraphDO` nor `FactoryBeadGraphDO` may expose update-in-place operations on existing nodes or Beads. Succession creates new nodes; the old node is never mutated.

---

### NFR-FG-005 — AuditBead in Every Bead Write (Audit)
🟢 **Confidence** (BR-KSP-07; SPEC-KSP-ARCH-001 INV-KSP-005; SPEC-KSP-BEAD-GRAPH-001 INV-BG-007)

Every call to `beadGraphDO.writeBead()` must pass an `AuditBead` as the second argument. Callers that omit the audit bead violate INV-BG-007. The `FactoryBeadGraphDO` may enforce this at the type level.

---

### NFR-FG-006 — Cloudflare-Only Runtime (Single-Host Constraint)
🟢 **Confidence** (architecture.md § Single-Host Constraint)

`@factory/factory-graph` must not import Node.js built-ins or assume Node.js availability. All Durable Object classes target the CF Workers runtime.

---

### NFR-FG-007 — Phase-4 Dependency Gate (Sequencing)
🟢 **Confidence** (BR-KSP-14; architecture.md § Package Build Order)

`@factory/factory-graph` may not be compiled or tested until all five bridge point tests in `@factory/loop-closure` pass. This is a hard gate, not advisory.

---

## 3. Acceptance Criteria

### AC-FG-001 — Happy Path: Node and Relation Types Compile

**Given** the package `@factory/factory-graph` is built  
**When** `tsc --noEmit` is run against `src/types.ts`  
**Then** zero TypeScript errors are emitted, `FACTORY_NODE_TYPES.includes('WorkGraph')` is true, and `FACTORY_REL_TYPES.includes('compiles_to')` is true.

---

### AC-FG-002 — Failure Path: Null Trace Returns Empty Divergences

**Given** `factoryDivergenceDetector` is invoked with a `traceNodeId` that does not exist in the artifact graph  
**When** `artifactGraph.getNode(traceNodeId)` returns `null`  
**Then** the function returns `[]` without throwing.

---

### AC-FG-003 — Happy Path: Detector Firing Maps to Blocking Severity

**Given** a `TraceFragmentData` with a single `detector_firing` where `firing.severity === 'critical'`  
**When** `factoryDivergenceDetector` processes the trace  
**Then** exactly one `DetectedDivergence` is returned with `severity === 'critical'` and `claimId === firing.inv_id`.

---

### AC-FG-004 — Failure Path: Amendment Verifier Fails Below Threshold

**Given** `factoryAmendmentVerifier` is invoked and `evaluateCoherence()` returns `0.60`  
**When** the verifier computes its result  
**Then** `passed === false`, `gate === 'compile'`, and `score < 0.75`.

---

### AC-FG-005 — Happy Path: Hypothesis Builder Stub Returns Valid Shape

**Given** `factoryHypothesisBuilder` stub implementation  
**When** called with any `divergenceId` and a mock artifact graph  
**Then** returns a `HypothesisProposal` with all required fields present and `tsc --noEmit` reports zero errors.

---

## 4. MoSCoW Summary

| Requirement | Priority | Rationale |
|-------------|----------|-----------|
| FR-FG-001 Node types | Must Have | Compile-time contract for all consumers |
| FR-FG-002 Relation types | Must Have | Artifact graph edge validation |
| FR-FG-003 Zod schemas | Must Have | Runtime Bead validation in both DOs |
| FR-FG-004 FactoryArtifactGraphDO | Must Have | CF DO binding required by Mediation Agent |
| FR-FG-005 FactoryBeadGraphDO | Must Have | CF DO binding required by Mediation Agent |
| FR-FG-006 factoryDivergenceDetector | Must Have | Loop cannot close without divergence detection |
| FR-FG-007 factoryHypothesisBuilder (stub) | Must Have | Type gate; full LLM wiring is Should Have |
| FR-FG-008 factoryAmendmentVerifier | Must Have | Amendment adoption gate |
| FR-FG-009 Barrel export | Must Have | Package API surface |
| NFR-FG-001 tsc clean | Must Have | Propagates build failures to all consumers |
| NFR-FG-002 No circular deps | Must Have | ADR-KSP-005 architectural invariant |
| NFR-FG-003 Fail-closed | Must Have | I4 invariant |
| NFR-FG-007 Phase-4 gate | Must Have | BR-KSP-14 hard sequencing gate |
