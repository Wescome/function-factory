# Tasks — @factory/factory-graph

**Module:** `packages/factory-graph`  
**SDD version:** 1.0  
**Date:** 2026-06-10  
**Source:** SPEC-KSP-FACTORY-001 §12–13; CLAUDE.md Steps 27–33

> **Prerequisite gate (BR-KSP-14):** All five bridge point tests in `@factory/loop-closure` must pass before any task in this file begins. This is a hard sequencing gate, not advisory.

---

## Step 27 — `src/types.ts`

**File:** `packages/factory-graph/src/types.ts`

**What to implement:**
- Import `CORE_NODE_TYPES` from `@factory/artifact-graph` and spread into `FACTORY_NODE_TYPES` const, adding: `Signal`, `Pressure`, `Capability`, `FunctionProposal`, `PRD`, `WorkGraph`, `Invariant`, `CoverageReport`, `AtomDirective`, `TraceFragment`
- Import `CORE_REL_TYPES` from `@factory/artifact-graph` and spread into `FACTORY_REL_TYPES` const, adding: `source_ref`, `compiles_to`, `instantiates`, `addresses`, `derived_from`, `dispatched_as`, `produced_trace`, `gate_result`
- Export derived types `FactoryNodeType` and `FactoryRelType`
- Import `BaseBead` from `@factory/bead-graph` and export Zod schemas for all five Factory Bead types:
  - `ArchitectureDecisionBead` (type literal: `'arch_decision'`) — includes `repo_id`, `work_graph_id`, `work_graph_version`, `atoms`, `detector_specs`, `agents_md`, `source_refs`, `autonomy` enum, `committed_at`, optional `artifact_graph_specification_id`
  - `PatternTrustBead` (type literal: `'pattern_trust'`) — includes `repo_id`, `work_graph_id`, verdict enums, optional scores, `open_divergences`, `last_verified_at`, optional `artifact_graph_specification_id`
  - `CommitBead` (type literal: `'commit'`) — includes `repo_id`, `atom_id`, `atom_directive`, `session_id`, `attempt`, `dispatched_at`, `autonomy_level` enum, `arch_decision_bead_id`, optional `artifact_graph_execution_id`
  - `BuildOutcomeBead` (type literal: `'build_outcome'`) — includes `repo_id`, `commit_bead_id`, `atom_id`, `status` (`BuildOutcomeStatus` enum), `duration_ms`, optional `exit_code`, `detector_firings`, `triggers_amendment`, optional `divergence_severity` enum, optional `artifact_graph_divergence_id`
  - `ArchAmendmentBead` (type literal: `'arch_amendment'`) — includes `repo_id`, `target_bead_id`, `target_type` enum, `proposed_change`, `rationale`, `triggered_by`, `status` (`AmendmentStatus`), optional `reviewed_by`/`reviewed_at`, optional `if_approved_produces`, `escalated_to_we_layer` (default false), optional `artifact_graph_amendment_id`
- Export `BuildOutcomeStatus = z.enum(['success', 'failure', 'timeout', 'partial'])`

**Gate:** `tsc --noEmit` zero errors  
**Done criterion:** Gate passes; `FACTORY_NODE_TYPES.includes('WorkGraph')` and `FACTORY_REL_TYPES.includes('compiles_to')` are statically accessible.  
**Confidence:** 🟢 (all schemas defined verbatim in SPEC-KSP-FACTORY-001 §6)

---

## Step 28 — `src/artifact-do.ts`

**File:** `packages/factory-graph/src/artifact-do.ts`

**What to implement:**
- Import `ArtifactGraphDOBase` from `@factory/artifact-graph`
- Declare and export `FactoryArtifactGraphDO extends ArtifactGraphDOBase<Env>` where `Env` is the Cloudflare Worker environment type for this package
- Pass `FACTORY_NODE_TYPES` and `FACTORY_REL_TYPES` (from `./types`) to the base class constructor or static config so the base class validates nodes and edges against Factory types
- No additional methods are required beyond what `ArtifactGraphDOBase` provides; the value is in the typed instantiation
- Export the `Env` interface with required Cloudflare bindings: `ARTIFACT_GRAPH: DurableObjectNamespace<FactoryArtifactGraphDO>`, `BEAD_GRAPH: DurableObjectNamespace<FactoryBeadGraphDO>` (forward-declare or import from `bead-do.ts`)

**Gate:** `tsc --noEmit` zero errors  
**Done criterion:** Gate passes; `FactoryArtifactGraphDO` is importable from the barrel without TypeScript errors.  
**Confidence:** 🟢 (SPEC-KSP-FACTORY-001 §13; code-analysis §1.1 confirms class shape)

---

## Step 29 — `src/bead-do.ts`

**File:** `packages/factory-graph/src/bead-do.ts`

**What to implement:**
- Import `BeadGraphDOBase` from `@factory/bead-graph`
- Declare and export `FactoryBeadGraphDO extends BeadGraphDOBase<Env>`
- Pass Factory Bead type literals or discriminated union to the base class so `writeBead()` validates incoming Bead schemas against `ArchitectureDecisionBead | PatternTrustBead | CommitBead | BuildOutcomeBead | ArchAmendmentBead`
- No additional methods required beyond what `BeadGraphDOBase` provides
- The `Env` type should reference `KV_CACHE: KVNamespace` for the hot-cache binding

**Gate:** `tsc --noEmit` zero errors  
**Done criterion:** Gate passes; `FactoryBeadGraphDO` is importable; the base class `writeBead()` type accepts all five Factory Bead schemas.  
**Confidence:** 🟢 (SPEC-KSP-FACTORY-001 §13; code-analysis §1.1)

---

## Step 30 — `src/detectors.ts`

**File:** `packages/factory-graph/src/detectors.ts`

**What to implement:**
- Import `DivergenceDetector`, `DetectedDivergence` from `@factory/loop-closure`
- Import `ArtifactGraphDOBase` from `@factory/artifact-graph`
- Define and export `factoryDivergenceDetector: DivergenceDetector`
- Implement `mapInvSeverity(s: string): DetectedDivergence['severity']` as a private helper:
  - `'critical'` → `'critical'`
  - `'warning'` → `'medium'`
  - else → `'low'`
- Main function body (see design.md §2.1 for full algorithm):
  1. `getNode(traceNodeId)` — return `[]` if null
  2. Iterate `trace.detector_firings`, map severity, push `DetectedDivergence`
  3. Handle `outcome === 'failure'` + `attempts_exhausted` → severity `'high'`
  4. Handle `outcome === 'timeout'` + `attempts_exhausted` → severity `'high'`
  5. Return `divergences[]`

**Gate:** Unit tests pass  
**Tests to write:** `tests/detectors.test.ts`
- null trace → returns `[]`
- `severity: 'critical'` firing → `DetectedDivergence.severity === 'critical'`
- `severity: 'warning'` firing → `'medium'`
- unknown severity → `'low'`
- `outcome: 'failure'` + `attempts_exhausted: true` → adds `'high'` divergence with correct `claimId`
- `outcome: 'timeout'` + `attempts_exhausted: true` → adds `'high'` divergence with correct `claimId`
- empty `detector_firings` + successful outcome → returns `[]`

**Done criterion:** All unit tests pass with zero failures.  
**Confidence:** 🟢 (algorithm defined verbatim in SPEC-KSP-FACTORY-001 §8)

---

## Step 31 — `src/hypothesis.ts`

**File:** `packages/factory-graph/src/hypothesis.ts`

**What to implement (stub first):**
- Import `HypothesisBuilder`, `HypothesisProposal` from `@factory/loop-closure`
- Export `factoryHypothesisBuilder: HypothesisBuilder`
- Stub body: return a hardcoded `HypothesisProposal` with all required fields:
  ```typescript
  return {
    faultAttribution: 'specification',
    explanation: 'Stub hypothesis — LLM wiring pending',
    confidence: 0.5,
    alternativesConsidered: [],
    assumptions: [],
    risksAccepted: [],
  };
  ```
- The stub must satisfy the full `HypothesisBuilder` interface type (async function, correct parameter types)

**Full implementation (separate task, after stub gate passes):**
- Import `dispatcher` from `@factory/harness-bridge`
- `getGoverningSpecification(divNode, artifactGraph)` — walk artifact graph from Divergence to its Specification
- `walkBoundedPath` to collect prior `ElucidationArtifact` nodes on same claim
- `dispatcher.dispatch({ taskKind: 'synthesis', systemPrompt: HYPOTHESIS_SYSTEM_PROMPT, userPrompt: buildHypothesisPrompt(...) })`
- Map response fields to `HypothesisProposal`

**Gate:** `tsc --noEmit` zero errors (stub); unit test with stub passes  
**Done criterion:** Gate passes; `tsc --noEmit` reports zero errors on the stub. Full LLM wiring gate: unit test passes with a mock dispatcher.  
**Confidence:** 🟢 (stub shape confirmed by SPEC-KSP-FACTORY-001 §9 and §12 Step 5)

---

## Step 32 — `src/verifier.ts`

**File:** `packages/factory-graph/src/verifier.ts`

**What to implement:**
- Import `AmendmentVerifier`, `VerificationResult` from `@factory/loop-closure`
- Import `ArtifactGraphDOBase` from `@factory/artifact-graph`
- Export `factoryAmendmentVerifier: AmendmentVerifier`
- Implement (see design.md §2.3 for full algorithm):
  1. `getNode(amendmentId)` → cast as `AmendmentNodeData`
  2. `getLinkedDivergences(amendmentId, artifactGraph)` — helper: walk `proposes_modification_of` edges backward, then `evidences` edges to find linked Divergence nodes
  3. Walk each divergence to its `Claim` nodes via `walkBoundedPath(id, [{rel:'concerns', targetType:'Claim'}])`
  4. `coherenceScore = evaluateCoherence(amendment.proposed_change, claims.flat())`
  5. If `coherenceScore > 0.7`: `patternScore = await architectAgentDO.checkCrossRepoPattern(amendment.proposed_change)` else `patternScore = 0.5`
  6. Return `{ passed: coherenceScore >= 0.75 && patternScore >= 0.5, gate: 'compile', score: (coherenceScore + patternScore) / 2, details: { coherenceScore, patternScore } }`

**Gate:** Unit tests pass  
**Tests to write:** `tests/verifier.test.ts`
- `coherenceScore = 0.60` → `passed: false`, `gate: 'compile'`
- `coherenceScore = 0.80`, `patternScore = 0.60` → `passed: true`
- `coherenceScore = 0.80`, `patternScore = 0.40` → `passed: false`
- `coherenceScore = 0.68` → `patternScore` not called (cross-repo scan skipped)
- `coherenceScore = 0.71` → cross-repo scan triggered

**Done criterion:** All unit tests pass; `coherenceScore < 0.75` always yields `passed: false`.  
**Confidence:** 🟢 (thresholds defined in SPEC-KSP-FACTORY-001 §10; code-analysis §2.2)

---

## Step 33 — `src/index.ts`

**File:** `packages/factory-graph/src/index.ts`

**What to implement:**
```typescript
export { FactoryArtifactGraphDO } from './artifact-do';
export { FactoryBeadGraphDO } from './bead-do';
export { factoryDivergenceDetector } from './detectors';
export { factoryHypothesisBuilder } from './hypothesis';
export { factoryAmendmentVerifier } from './verifier';
export * from './types';
```

No logic. Pure barrel.

**Gate:** `tsc --noEmit` zero errors  
**Done criterion:** Gate passes; all six export paths resolve without TypeScript errors; no circular import warnings.  
**Confidence:** 🟢 (exports enumerated verbatim in SPEC-KSP-FACTORY-001 §13)

---

## Integration Tasks (post-Step 33)

These tasks are not in the scope of `packages/factory-graph` itself but must be scheduled after Step 33 passes.

### Step 34 — Wire LoopClosureService in Mediation Agent DO

**File:** `packages/mediation-agent/src/loop-wiring.ts` (or equivalent)  
**What:** Instantiate `LoopClosureService` from `@factory/loop-closure` with the three Factory injectables: `factoryDivergenceDetector`, `factoryHypothesisBuilder`, `factoryAmendmentVerifier`  
**Gate:** Integration test — Steps 3–7 of SPEC-KSP-FACTORY-001 §7 trace correctly  
**Confidence:** 🟢 (SPEC-KSP-FACTORY-001 §12 Step 7)

### Step 35 — Wire Commissioning Agent to LoopClosureService

**File:** `workers/commissioning/`  
**What:** Wire `LoopClosureService.proposeAmendment()` and `adoptAmendment()` in the Commissioning Agent  
**Gate:** Full loop integration test (§7 Steps 1–7)  
**Confidence:** 🟢 (SPEC-KSP-FACTORY-001 §12 Steps 8–9)

---

## Task Dependency Graph

```
[BR-KSP-14 gate: loop-closure tests pass]
        │
        ▼
Step 27 (types.ts)
        │
        ├──▶ Step 28 (artifact-do.ts)
        │
        ├──▶ Step 29 (bead-do.ts)
        │
        ├──▶ Step 30 (detectors.ts) ─── unit tests
        │
        ├──▶ Step 31 (hypothesis.ts stub) ─── tsc
        │
        └──▶ Step 32 (verifier.ts) ─── unit tests

Steps 28 + 29 + 30 + 31 + 32 all complete
        │
        ▼
Step 33 (index.ts barrel) ─── tsc
        │
        ▼
Step 34 (Mediation Agent wiring) ─── integration test
        │
        ▼
Step 35 (Commissioning Agent wiring) ─── full loop test
```

Steps 28–32 can be run in parallel after Step 27 passes.
