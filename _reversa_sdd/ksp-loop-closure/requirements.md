# Requirements — @factory/loop-closure (ksp-loop-closure)

> Reversa SDD · doc_level: completo · Generated 2026-06-10
> Source: SPEC-KSP-LOOP-CLOSURE-001.md, code-analysis.md §ksp-loop-closure, domain.md §KSP

---

## Functional Requirements

### FR-01 — Bridge Point 1: Session Open (Specification governs ExecutionBead)

🟢 Confidence | Source: SPEC-KSP-LOOP-CLOSURE-001 §2 Bridge Point 1

`LoopClosureService.openSession(orgId, roleId, agentId, ns)` must:

1. Call `beadGraphDO.retrieveKnowingState(orgId, roleId, category)` to load the current knowing-state for the session scope.
2. Call `artifactGraphDO.getActiveSpecification(ns, domain)` to resolve the active Specification governing this namespace.
3. Write a session record to `kvStore` under key `session:{sessionId}` with: `{ orgId, roleId, agentId, ksRetrievedAt: Date.now(), activeSpecificationId, autonomyFloor }`.
4. Set `autonomyFloor` to `SUGGEST` if `retrieveKnowingState` fails (I4 — fail-closed).
5. Return a `Session` object carrying both the active Specification ID and the autonomy floor.

**MoSCoW**: MUST — required by every domain at session open; gateway to all subsequent bridge points.

**Acceptance Criteria:**

- **Happy path** — Given a valid `orgId`, `roleId`, `agentId`, and `ns` with an active Specification in the artifact graph:
  When `openSession` is called,
  Then the returned `Session.activeSpecificationId` matches the artifact graph's current head Specification ID, AND a KV entry at `session:{sessionId}` is written with `ksRetrievedAt` set.

- **Failure path** — Given `beadGraphDO.retrieveKnowingState` throws (DO unavailable):
  When `openSession` is called,
  Then the returned `Session.autonomyFloor` is `'SUGGEST'`, AND the method does not throw (fail-closed per I4).

---

### FR-02 — Bridge Point 2: Execution Write (ExecutionBead → Execution node)

🟢 Confidence | Source: SPEC-KSP-LOOP-CLOSURE-001 §2 Bridge Point 2; INV-LC-003

`LoopClosureService.recordExecution(sessionId, payload)` must:

1. Write an `Execution` node to `artifactGraphDO` with `{ session_id, agent_id, started, domain }`.
2. Write a `governed_by` edge in the artifact graph: `Execution → Specification` (using `session.activeSpecificationId`).
3. Write an `ExecutionBead` to `beadGraphDO` with bridge field `artifact_graph_execution_id` set to the Execution node ID created in step 1.
4. Write the `ExecutionBead` and its `AuditBead` atomically in a single `BEGIN/COMMIT` transaction.
5. Return `{ executionBeadId, executionNodeId }`.

**Write sequence is strict**: artifact graph write (steps 1–2) precedes bead graph write (step 3). This is enforced by INV-LC-003.

**Partial failure recovery**: If step 1–2 succeed and step 3 fails, an orphan Execution node remains in the artifact graph. On the next session operation, the SDK retries step 3 idempotently (`INSERT OR IGNORE`). The orphan Execution node is not harmful.

**MoSCoW**: MUST — every execution must be traceable to its governing Specification.

**Acceptance Criteria:**

- **Happy path** — Given a valid `sessionId` referencing a session with `activeSpecificationId` set:
  When `recordExecution` is called with a payload,
  Then an `Execution` node exists in the artifact graph with a `governed_by` edge pointing to the active Specification, AND the returned `ExecutionBead` has `artifact_graph_execution_id` matching the Execution node ID.

- **Failure path** — Given `artifactGraphDO.upsertNode` succeeds and `beadGraphDO.writeBead` throws on first attempt:
  When `recordExecution` is called again with the same payload (retry),
  Then the Execution node is NOT duplicated (idempotent `upsertNode`), AND the `ExecutionBead` is successfully written on the second attempt.

---

### FR-03 — Bridge Point 3: Execution Trace Write (ExecutionTrace → OutcomeBead)

🟢 Confidence | Source: SPEC-KSP-LOOP-CLOSURE-001 §2 Bridge Point 3

`LoopClosureService.recordOutcome(sessionId, executionBeadId, outcome)` must:

1. Write an `ExecutionTrace` node to the artifact graph with `{ session_id, tool_calls, outcome, summary }`.
2. Write a `produces` edge: `Execution → ExecutionTrace`.
3. Call `detectDivergences(traceId, activeSpecificationId, artifactGraphDO)` (domain-provided function).
4. If divergences are detected: write a `Divergence` node with `{ claim_id, description, severity, detected_at }`, plus `evidences` edge (`ExecutionTrace → Divergence`) and `diverges_from` edge (`ExecutionTrace → Specification`).
5. Write an `OutcomeBead` to the bead graph with bridge field `artifact_graph_divergence_id` set to the Divergence node ID (null if no divergence).
6. Return `{ divergenceId?, outcomeBeadId }`.

**MoSCoW**: MUST — closing execution records is the primary input to the amendment loop.

**Acceptance Criteria:**

- **Happy path (no divergence)** — Given an execution that completed successfully with no spec violations:
  When `recordOutcome` is called,
  Then an `ExecutionTrace` node exists in the artifact graph, AND the returned `OutcomeBead.artifact_graph_divergence_id` is null/undefined, AND `divergenceId` is not present in the return.

- **Failure path (divergence detected)** — Given an execution trace that violates a Specification claim:
  When `recordOutcome` is called,
  Then a `Divergence` node exists in the artifact graph with an `evidences` edge from the ExecutionTrace, AND the returned `OutcomeBead.artifact_graph_divergence_id` is set to the Divergence node ID.

---

### FR-04 — Bridge Point 4: Divergence Triggers AmendmentBead

🟢 Confidence | Source: SPEC-KSP-LOOP-CLOSURE-001 §2 Bridge Point 4

`LoopClosureService.proposeAmendment(divergenceId, outcomeBeadId, orgId)` must:

1. Write a `Hypothesis` node to the artifact graph with `{ fault_attribution, explanation, confidence }` (built by `buildHypothesis` — domain-provided).
2. Write an `evidence_for` edge: `Divergence → Hypothesis`.
3. Write an `Amendment` node to the artifact graph with `{ proposed_change, status: 'candidate' }`.
4. Write a `motivates` edge: `Hypothesis → Amendment`.
5. Write a `proposes_modification_of` edge: `Amendment → Specification`.
6. Write an `AmendmentBead` to the bead graph with bridge field `artifact_graph_amendment_id` set to the Amendment node ID.
7. Return `{ amendmentId, amendmentBeadId }`.

**MoSCoW**: MUST — the amendment loop cannot begin without this bridge point.

**Acceptance Criteria:**

- **Happy path** — Given a `divergenceId` that exists in the artifact graph and an `outcomeBeadId`:
  When `proposeAmendment` is called,
  Then a `Hypothesis` node and an `Amendment` node (status `'candidate'`) exist in the artifact graph, AND the returned `AmendmentBead` has `artifact_graph_amendment_id` set to the Amendment node ID.

- **Failure path** — Given `artifactGraphDO.upsertNode` throws on Hypothesis creation:
  When `proposeAmendment` is called,
  Then no `AmendmentBead` is written to the bead graph (no partial state), AND the error is propagated to the caller.

---

### FR-05 — Bridge Point 5: Amendment Adoption (new Specification + new TrustBead/PolicyBead)

🟢 Confidence | Source: SPEC-KSP-LOOP-CLOSURE-001 §2 Bridge Point 5; INV-LC-004; INV-LC-005; INV-LC-006

`LoopClosureService.adoptAmendment(amendmentId, amendmentBeadId, reviewer, verificationResult)` must execute all six steps atomically at the semantic level:

1. **Verification** — write `VerificationProcess` and `Verdict` nodes; write `produces_verdict` and `subject_to` edges. If `verificationResult.passed === false`, call `rejectAmendment()` and return `{ rejected: true }` immediately.
2. **New Specification** — write a new `Specification` node (version incremented, `explicitness: 'derived'`); write `version_of` edge to prior Specification and `if_adopted_produces` edge from Amendment.
3. **ElucidationArtifact** — write `ElucidationArtifact` node with `{ selected_option, rejected_options, assumptions, risks_accepted }`; write `produced_at` edge. This step is UNCONDITIONAL — skipping it is a structural error (Axiom A9, INV-LC-005).
4. **New TrustBead or PolicyBead** — write the new bead to the bead graph with bridge field `artifact_graph_specification_id` set to the new Specification node ID; write `supersedes` edge in bead graph pointing to the prior bead.
5. **KV invalidation** — invalidate `ks:{orgId}:*`, `head:{orgId}:*`, and `maintenance:{orgId}` keys before returning.
6. **Amendment status update** — write an approved `AmendmentBead` (status `'APPROVED'`, `reviewed_by`, `reviewed_at`, `if_approved_produces`).

If any step fails after step 2, `session.activeSpecificationId` must remain the prior version until all steps complete.

**MoSCoW**: MUST — this is the loop closure itself; without it the amendment cycle never produces updated knowing-state.

**Acceptance Criteria:**

- **Happy path** — Given a valid amendment with `verificationResult.passed === true`:
  When `adoptAmendment` is called,
  Then a new `Specification` node exists in the artifact graph with a `version_of` edge to the prior Specification, AND a new TrustBead/PolicyBead exists in the bead graph with a `supersedes` edge, AND an `ElucidationArtifact` node exists, AND all KV keys for the org are invalidated, AND the return value is `{ newSpecId, newBeadId }`.

- **Failure path (verification fails)** — Given `verificationResult.passed === false`:
  When `adoptAmendment` is called,
  Then no new `Specification` node is written, no new TrustBead/PolicyBead is written, no `ElucidationArtifact` is written, no KV is invalidated, AND the return value is `{ rejected: true }`.

---

### FR-06 — Domain-Injectable Divergence Detector

🟢 Confidence | Source: SPEC-KSP-LOOP-CLOSURE-001 §5

The service must accept a `detectDivergences: DivergenceDetector` function at construction time. This function has the contract:

```typescript
type DivergenceDetector = (
  traceNodeId:     string,
  specificationId: string,
  artifactGraph:   ArtifactGraphDOBase<unknown>
) => Promise<DetectedDivergence[]>;
```

The service must not contain any domain-specific divergence detection logic. Domain implementations (Factory, ComeFlow, CareTrace) supply this function.

**MoSCoW**: MUST — the service is domain-neutral by design.

---

### FR-07 — Domain-Injectable Hypothesis Builder

🟢 Confidence | Source: SPEC-KSP-LOOP-CLOSURE-001 §7

The service must accept a `buildHypothesis: HypothesisBuilder` function at construction time. The function maps a `DetectedDivergence` to a `Hypothesis` object (with `fault_attribution`, `explanation`, `confidence`).

**MoSCoW**: MUST — hypothesis construction may use LLM (e.g., Claude Opus for Factory); must be domain-injectable.

---

### FR-08 — Domain-Injectable Amendment Verifier

🟢 Confidence | Source: SPEC-KSP-LOOP-CLOSURE-001 §7

The service must accept a `verifyAmendment: AmendmentVerifier` function at construction time. The function runs the domain's `VerificationProcess` and returns a `VerificationResult` (`{ passed, gate, score }`).

**MoSCoW**: MUST — verification logic varies by domain and must be injectable.

---

## Non-Functional Requirements

### NFR-01 — No Direct Storage Coupling (INV-LC-001)

🟢 Confidence | Source: SPEC-KSP-LOOP-CLOSURE-001 INV-LC-001

`ArtifactGraphDOBase` and `BeadGraphDOBase` must never call each other directly. All cross-layer writes go through `LoopClosureService`. Enforced by package dependency graph: neither `@factory/artifact-graph` nor `@factory/bead-graph` imports the other.

**Classification**: Architecture invariant — any violation breaks the two-layer isolation that the KSP design relies on.

---

### NFR-02 — Bridge Fields Are Optional (INV-LC-002)

🟢 Confidence | Source: SPEC-KSP-LOOP-CLOSURE-001 INV-LC-002

Bead graph storage invariants (INV-BG-001 through INV-BG-008) hold regardless of whether bridge fields (`artifact_graph_*_id`) are present. Beads written before loop closure was implemented are valid. The service must not reject a Bead on the basis of a missing bridge field.

**Classification**: Data compatibility — allows incremental rollout and backfill without breaking existing Beads.

---

### NFR-03 — Write Sequence Enforced at Bridge Point 2 (INV-LC-003)

🟢 Confidence | Source: SPEC-KSP-LOOP-CLOSURE-001 INV-LC-003

At Bridge Point 2, the artifact graph write (Execution node + `governed_by` edge) must precede the bead graph write (ExecutionBead). Both writes are idempotent (`upsertNode` / `INSERT OR IGNORE`) so that retry recovers from partial failure without duplication.

**Classification**: Availability — ensures that a partial write always recovers to a consistent state on retry.

---

### NFR-04 — Amendment Adoption Atomic at Semantic Level (INV-LC-004)

🟢 Confidence | Source: SPEC-KSP-LOOP-CLOSURE-001 INV-LC-004

All six steps of Bridge Point 5 must complete before the new Specification is considered active. If any step fails, `session.activeSpecificationId` remains the prior version. There is no partial adoption state visible to any caller.

**Classification**: Consistency — the amendment cycle either fully commits or fully rolls back from the session's perspective.

---

### NFR-05 — ElucidationArtifact Written on Every Adoption (INV-LC-005)

🟢 Confidence | Source: SPEC-KSP-LOOP-CLOSURE-001 INV-LC-005; Axiom A9

Every Amendment adoption is a DispositionEvent with candidate-set cardinality > 1. The `ElucidationArtifact` node must be written to the artifact graph unconditionally. Skipping this write is a structural error (not a recoverable failure).

**Classification**: Compliance — required by Axiom A9 (Elucidation Obligation); every Disposition Event must record what was foreclosed.

---

### NFR-06 — KV Invalidated Before Adoption Returns (INV-LC-006)

🟢 Confidence | Source: SPEC-KSP-LOOP-CLOSURE-001 INV-LC-006

Bridge Point 5 Step 5 (KV invalidation) must complete before the adoption result is returned. A new session opened after adoption must not get stale KV data for the amended knowing-state. The fallback for cache misses is the DO SQLite head-bead lookup (always correct).

**Classification**: Correctness — sessions opening after adoption must see the new Specification as active.

---

### NFR-07 — Zero Factory-Specific Imports

🟢 Confidence | Source: domain.md BR-KSP-15; SPEC-KSP-ARCH-001 §3

`@factory/loop-closure` must not import any `@factory/*` package that is specific to the Factory domain (e.g., `@factory/factory-graph`, `@factory/gears`). It may only import from `@factory/artifact-graph`, `@factory/bead-graph`, and Cloudflare standard types. The `tsc --noEmit` gate at Step 26 verifies this.

**Classification**: Portability — the package must deploy unchanged to ComeFlow and CareTrace domains.

---

### NFR-08 — Cloudflare-Only Runtime

🟢 Confidence | Source: architecture.md §KSP Layer — Single-Host Constraint

The module runs exclusively on Cloudflare Workers infrastructure. No external database connections, no self-hosted nodes. Storage is mediated through the DO references passed in `LoopClosureConfig`.

**Classification**: Infrastructure constraint — baked into the architectural thesis (ADR-KSP-002).

---

## MoSCoW Summary

| ID | Requirement | Classification |
|----|------------|---------------|
| FR-01 | Bridge Point 1 — openSession | MUST |
| FR-02 | Bridge Point 2 — recordExecution (artifact-first write) | MUST |
| FR-03 | Bridge Point 3 — recordOutcome + divergence detection | MUST |
| FR-04 | Bridge Point 4 — proposeAmendment | MUST |
| FR-05 | Bridge Point 5 — adoptAmendment (6-step atomic) | MUST |
| FR-06 | Domain-injectable DivergenceDetector | MUST |
| FR-07 | Domain-injectable HypothesisBuilder | MUST |
| FR-08 | Domain-injectable AmendmentVerifier | MUST |
| NFR-01 | No direct storage coupling | MUST |
| NFR-02 | Bridge fields optional | MUST |
| NFR-03 | Write sequence enforced at BP2 | MUST |
| NFR-04 | Amendment adoption atomic | MUST |
| NFR-05 | ElucidationArtifact unconditional | MUST |
| NFR-06 | KV invalidated before return | MUST |
| NFR-07 | Zero factory-specific imports | MUST |
| NFR-08 | Cloudflare-only runtime | MUST |
