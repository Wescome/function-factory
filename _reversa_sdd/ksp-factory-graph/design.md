# Design — @factory/factory-graph

**Module:** `packages/factory-graph`  
**SDD version:** 1.0  
**Date:** 2026-06-10  
**Source specs:** SPEC-KSP-FACTORY-001, SPEC-KSP-ARCH-001

---

## 1. Package Structure

```
packages/factory-graph/
├── package.json
├── tsconfig.json
├── src/
│   ├── types.ts          # FACTORY_NODE_TYPES, FACTORY_REL_TYPES, all Zod schemas
│   ├── artifact-do.ts    # FactoryArtifactGraphDO extends ArtifactGraphDOBase
│   ├── bead-do.ts        # FactoryBeadGraphDO extends BeadGraphDOBase
│   ├── detectors.ts      # factoryDivergenceDetector (injectable DivergenceDetector)
│   ├── hypothesis.ts     # factoryHypothesisBuilder (stub-first, then Claude Opus)
│   ├── verifier.ts       # factoryAmendmentVerifier (Coherence + Cross-Repo score)
│   └── index.ts          # barrel — all public exports
└── tests/
    ├── detectors.test.ts
    └── verifier.test.ts
```

### File Responsibilities

| File | Responsibility |
|------|----------------|
| `types.ts` | Extends core constants; defines all Factory-domain Zod schemas for Bead types; exports `FactoryNodeType` and `FactoryRelType` |
| `artifact-do.ts` | CF Durable Object subclass bound to Factory node/relation types; exposes artifact graph DO for Mediation Agent + Commissioning Agent wiring |
| `bead-do.ts` | CF Durable Object subclass bound to Factory Bead types; exposes Bead graph DO for Mediation Agent wiring |
| `detectors.ts` | Pure injectable function; maps `TraceFragmentData` detector firings to `DetectedDivergence[]`; handles all severity mappings |
| `hypothesis.ts` | Stub returns hardcoded `HypothesisProposal`; full impl routes to Claude Opus via `@factory/harness-bridge` dispatcher |
| `verifier.ts` | Implements Coherence Verification-Process; calls `architectAgentDO.checkCrossRepoPattern()` for cross-repo pattern score |
| `index.ts` | Re-exports all five symbols + `* from './types'`; this is the only import surface for consuming packages |

---

## 2. Key Algorithms and Data Flows

### 2.1 factoryDivergenceDetector — Severity Mapping

```
Input:  traceNodeId (string)
        specificationId (string)
        artifactGraph (ArtifactGraphDOBase)
Output: DetectedDivergence[]

1. getNode(traceNodeId) → traceNode
   └─ if null → return []

2. Cast traceNode.data as TraceFragmentData

3. For each firing in trace.detector_firings:
   severity = mapInvSeverity(firing.severity)
     'critical' → 'critical'
     'warning'  → 'medium'
     *          → 'low'
   push { claimId: firing.inv_id, description: firing.message, severity }

4. If outcome === 'failure' AND attempts_exhausted:
   push { claimId: `claim-atom-outcome-${trace.atom_id}`, severity: 'high' }

5. If outcome === 'timeout' AND attempts_exhausted:
   push { claimId: `claim-atom-timeout-${trace.atom_id}`, severity: 'high' }

6. return divergences[]
```

**Severity routing note (from Commissioning Agent, not this package):**

| DetectedDivergence severity | Loop action |
|-----------------------------|-------------|
| `critical` (from INV-* spec with `severity: 'critical'`) | Promotes unconditionally to `blocking`; bypasses retry evaluation |
| `high` (atom failure/timeout exhausted) | Mapped to `blocking` by Commissioning Agent |
| `medium` / `low` | Mapped to `advisory` / `informational` by Commissioning Agent |

The severity-to-blocking mapping lives in the Commissioning Agent (`workers/commissioning/`), not in this package. `factoryDivergenceDetector` only produces `DetectedDivergence` with `severity` from the detector spec.

### 2.2 Divergence Severity → Loop Routing (Commissioning Agent)

This table is included here as design context for the verifier and detector — the routing is owned by the Commissioning Agent but shapes the semantics of what this package produces.

| Divergence Severity | Commissioning Agent | Architect Agent DO | We-layer |
|--------------------|---------------------|--------------------|----------|
| `blocking` | Suspend counter + amendment loop | CRP if Coherence Verification fails | EscalationBead at auto-suspend threshold |
| `advisory` | Amendment loop at next poll | No CRP | No escalation |
| `informational` | Log only | Anomaly scan (D4) | No escalation |

**Promotion rule:** Any INV-* detector spec with `severity: 'critical'` fires → `blocking` unconditionally, bypassing retry evaluation.

### 2.3 factoryAmendmentVerifier — Coherence + Cross-Repo Score

```
Input:  amendmentId (string)
        artifactGraph (ArtifactGraphDOBase)
Output: VerificationResult { passed, gate, score, details }

1. getNode(amendmentId) → amdNode
2. Cast amdNode.data as AmendmentNodeData
3. getLinkedDivergences(amendmentId, artifactGraph) → divergenceIds[]
4. For each divergenceId: walkBoundedPath(id, [{rel:'concerns', targetType:'Claim'}]) → claims
5. coherenceScore = evaluateCoherence(amendment.proposed_change, claims.flat())
6. If coherenceScore > 0.7:
   patternScore = architectAgentDO.checkCrossRepoPattern(amendment.proposed_change)
   Else: patternScore = 0.5 (noise avoidance default)
7. passed = coherenceScore >= 0.75 AND patternScore >= 0.5
8. return { passed, gate: 'compile', score: (coherenceScore + patternScore) / 2, details }
```

**Threshold table:**

| Threshold | Value | Effect |
|-----------|-------|--------|
| `coherenceScore` gate | 0.75 | Below → `passed: false`; Commissioning Agent opens CRP |
| Cross-repo scan trigger | 0.70 | Below → skip `architectAgentDO` call (avoids noise) |
| `patternScore` gate | 0.50 | Below → `passed: false` |

### 2.4 factoryHypothesisBuilder — Stub-First Implementation Pattern

The initial stub must return a structurally valid `HypothesisProposal` with hardcoded content. This allows `FactoryBeadGraphDO` and the Commissioning Agent to wire against the type signature before the LLM routing is complete.

Full implementation flow (post-stub):
```
1. getNode(divergenceId) → divNode
2. getGoverningSpecification(divNode, artifactGraph) → specNode
3. walkBoundedPath to find prior ElucidationArtifacts on same claim
4. dispatcher.dispatch({
     taskKind: 'synthesis',
     systemPrompt: HYPOTHESIS_SYSTEM_PROMPT,
     userPrompt: buildHypothesisPrompt(divNode.data, specNode?.data, elucidationArts),
   }) via @factory/harness-bridge
5. Map response → HypothesisProposal
```

---

## 3. Cloudflare Primitives Used and Why

| Primitive | Usage in this package | Rationale |
|-----------|----------------------|-----------|
| **CF Durable Objects (SQLite)** | `FactoryArtifactGraphDO`, `FactoryBeadGraphDO` | Single-writer serialization (INV-KSP-003). DO SQLite is the exclusive storage substrate by ADR-KSP-002. |
| **CF KV** (indirect, via consumers) | Not used directly by `factory-graph` | KV hot cache is maintained by `@factory/bead-graph` SDK; `factory-graph` only extends the DO base classes. |
| **CF R2** (indirect, via base classes) | SQLite WAL snapshots | Provided by `@factory/artifact-graph` and `@factory/bead-graph` base classes; not referenced directly in `factory-graph`. |

This package does **not** bind CF KV or R2 directly. It only subclasses the DO base classes. All KV read/write logic lives in `@factory/bead-graph` and `@factory/ksp-sdk`.

---

## 4. Integration Points

### What this package calls

| Symbol | Source package | Call site |
|--------|---------------|-----------|
| `ArtifactGraphDOBase<Env>` | `@factory/artifact-graph` | `FactoryArtifactGraphDO extends ArtifactGraphDOBase` |
| `walkBoundedPath()` | `@factory/artifact-graph` | `factoryAmendmentVerifier`, `factoryHypothesisBuilder` |
| `PathStep` | `@factory/artifact-graph` | Type used in `walkBoundedPath` calls |
| `BeadGraphDOBase<Env>` | `@factory/bead-graph` | `FactoryBeadGraphDO extends BeadGraphDOBase` |
| `computeBeadId()` | `@factory/bead-graph` | Called in Bead construction helpers |
| `BaseBead` | `@factory/bead-graph` | Extended by all Zod schemas in `types.ts` |
| `DivergenceDetector` | `@factory/loop-closure` | Interface satisfied by `factoryDivergenceDetector` |
| `HypothesisBuilder` | `@factory/loop-closure` | Interface satisfied by `factoryHypothesisBuilder` |
| `AmendmentVerifier` | `@factory/loop-closure` | Interface satisfied by `factoryAmendmentVerifier` |
| `dispatcher.dispatch()` | `@factory/harness-bridge` | Full LLM routing in `factoryHypothesisBuilder` (post-stub) |

### What calls this package

| Consumer | What it imports |
|----------|----------------|
| `packages/mediation-agent` | `FactoryBeadGraphDO`, `FactoryArtifactGraphDO` — wired as DO binding targets; also imports detector/hypothesis/verifier injectables for `LoopClosureService` config |
| `workers/commissioning` | `FactoryArtifactGraphDO`, `ArchAmendmentBead`, `ArchitectureDecisionBead` — reads Specification nodes; writes Amendment Beads |
| `packages/architect-agent` | `FactoryArtifactGraphDO`, `ArchAmendmentBead` — reads Amendment nodes for CRP resolution; writes new Specification on resolution |

**Does not export** anything consumed by `@factory/harness-bridge` or `@factory/ksp-sdk`. Those packages depend on generic base packages only (ADR-KSP-005, BR-KSP-15).

---

## 5. Artifact Graph Node Schema (Factory Loop)

These are the artifact graph node types written during the Factory KSP loop. They are governed by `FactoryArtifactGraphDO`.

| Node type | ID pattern | Created at loop step | Written by |
|-----------|------------|---------------------|-----------|
| `Specification` (WorkGraph) | `spec-wg-{id}-v{n}` | Pre-existing; new at Step 7 adoption | Commissioning Agent |
| `Execution` | `exec-atom-{id}-attempt-{n}` | Step 3 — atom dispatch | Mediation Agent (via `LoopClosureService`) |
| `ExecutionTrace` | `trace-atom-{id}` | Step 4 — atom outcome | Mediation Agent |
| `Divergence` | `div-{n}` | Step 4b — detector firing | Mediation Agent |
| `Hypothesis` | `hyp-{n}` | Step 5 — LLM synthesis | Commissioning Agent |
| `Amendment` | `amd-{n}` | Step 5 — proposed fix | Commissioning Agent |
| `VerificationProcess` | `vp-{n}` | Step 6 — coherence gate | Commissioning Agent |
| `Verdict` | `verdict-{n}` | Step 6 — coherence result | Commissioning Agent |
| `ElucidationArtifact` | `ea-{n}` | Step 7 — adoption (INV-KSP-004, unconditional) | `LoopClosureService.adoptAmendment()` |

### Artifact Graph Edges Written in Factory Loop

| Edge type | Source → Target | Created at step |
|-----------|-----------------|----------------|
| `governs` | Specification → Execution | Step 3 |
| `produces` | Execution → ExecutionTrace | Step 4 |
| `diverges_from` | ExecutionTrace → Specification | Step 4b |
| `evidences` | ExecutionTrace → Divergence | Step 4b |
| `evidence_for` | Divergence → Hypothesis | Step 5 |
| `motivates` | Hypothesis → Amendment | Step 5 |
| `proposes_modification_of` | Amendment → Specification | Step 5 |
| `subject_to` | Amendment → VerificationProcess | Step 6 |
| `produces_verdict` | VerificationProcess → Verdict | Step 6 |
| `version_of` | new Specification → old Specification | Step 7 |
| `if_adopted_produces` | Amendment → new Specification | Step 7 |
| `produced_at` | ElucidationArtifact → DispositionEvent | Step 7 |

---

## 6. Bead Graph Schema (Factory Domain)

### 6.1 Bead Topology

```
ArchitectureDecisionBead   (PolicyBead — WorkGraph head)
  └─▶ EngineerRoleBead     (written by Commissioning Agent to identify Conducting Agent session)
        └─▶ PatternTrustBead  (TrustBead — Verdict state, scoped to WorkGraph version)
              └─▶ CommitBead  (ExecutionBead — per dispatched atom)
                    └─▶ BuildOutcomeBead  (OutcomeBead — per atom result)
                          └─▶ ArchAmendmentBead  (if Divergence opened)
                                └─▶ PatternTrustBead  (new — supersedes old)

AuditBead ──▶ every Bead write (written in same transaction, INV-BG-007)
```

### 6.2 Bridge Fields

Bead content fields linking Bead graph records to artifact graph nodes. All optional (BR-KSP-10).

| Bridge field | Present in | Links to |
|-------------|-----------|---------|
| `artifact_graph_specification_id` | `ArchitectureDecisionBead`, `PatternTrustBead` | `Specification` node in artifact graph |
| `artifact_graph_execution_id` | `CommitBead` | `Execution` node in artifact graph |
| `artifact_graph_divergence_id` | `BuildOutcomeBead` | `Divergence` node in artifact graph |
| `artifact_graph_amendment_id` | `ArchAmendmentBead` | `Amendment` node in artifact graph |

### 6.3 KV Key Patterns

| Key pattern | Value | Written by | Invalidated by |
|-------------|-------|-----------|---------------|
| `head:{repoId}:arch_decision` | `bead_id` (string) | Commissioning Agent (Step 1) | `adoptAmendment()` (Step 7) |
| `ks:{repoId}:conducting-agent:*` | KnowingState payload | Mediation Agent SDK | `adoptAmendment()` (Step 7) |
| `maintenance:{repoId}` | Health score | Mediation Agent | `adoptAmendment()` (Step 7) |

KV invalidation on amendment adoption is atomic at semantic level (BR-KSP-20). The three DELETE operations are issued together in `LoopClosureService.adoptAmendment()`.

---

## 7. SQLite Schemas

`FactoryArtifactGraphDO` and `FactoryBeadGraphDO` inherit their SQLite schemas from the base classes in `@factory/artifact-graph` and `@factory/bead-graph` respectively. This package adds no new tables. The base schemas are:

**Artifact Graph (from `@factory/artifact-graph`):**
- `nodes` — `(id TEXT PK, type TEXT, data JSON, created_at INTEGER)`
- `edges` — `(source TEXT, target TEXT, rel TEXT, UNIQUE(source, target, rel))`

**Bead Graph (from `@factory/bead-graph`):**
- `beads` — `(bead_id TEXT PK, org_id TEXT, type TEXT, content JSON, parent_ids JSON, written_by TEXT, ts INTEGER)`
- `bead_edges` — `(child_id TEXT, parent_id TEXT, rel TEXT DEFAULT 'parent')`
- `audit_log` — `(audit_bead_id TEXT, subject_bead_id TEXT, session_id TEXT, ts INTEGER)`
