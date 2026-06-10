# Design — @factory/loop-closure (ksp-loop-closure)

> Reversa SDD · doc_level: completo · Generated 2026-06-10
> Source: SPEC-KSP-LOOP-CLOSURE-001.md, code-analysis.md §ksp-loop-closure, architecture.md §KSP Layer

---

## Package Structure

```
packages/loop-closure/
  src/
    types.ts            — All TypeScript interfaces and injectable function types
    bridge-fields.ts    — Helper functions that build bridge-field-annotated content objects
    service.ts          — LoopClosureService class (five bridge point methods)
  index.ts              — Public re-exports
  package.json          — @factory/loop-closure, depends on @factory/artifact-graph + @factory/bead-graph
  tsconfig.json         — TypeScript project config
```

### File Responsibilities

| File | Responsibility |
|------|---------------|
| `src/types.ts` | `LoopClosureConfig`, `Session`, `ExecutionContent`, `OutcomeContent`, `DetectedDivergence`, `DivergenceDetector`, `HypothesisBuilder`, `AmendmentVerifier`, `VerificationResult`, `Hypothesis`. No domain-specific types. |
| `src/bridge-fields.ts` | Pure helper functions: `buildExecutionBeadContent(payload, executionNodeId)`, `buildOutcomeBeadContent(payload, divergenceId)`, `buildAmendmentBeadContent(payload, amendmentNodeId)`, `buildNewBeadContent(payload, newSpecId)`. Each annotates the content object with the appropriate `artifact_graph_*_id` bridge field. |
| `src/service.ts` | `LoopClosureService` class. Stateless between requests — all DO references are injected via `LoopClosureConfig`. Five public methods: `openSession`, `recordExecution`, `recordOutcome`, `proposeAmendment`, `adoptAmendment`. |
| `index.ts` | Re-exports `LoopClosureService`, `LoopClosureConfig`, all types from `src/types.ts`, and bridge-field helpers from `src/bridge-fields.ts`. |

---

## Key Algorithms and Data Flows

### The Two-Layer Architecture

```
Artifact Graph DO (per namespace)          Bead Graph DO (per org)
─────────────────────────────────          ──────────────────────
Specification ─────────────────────────→  policy_bead_id (session ref)
Execution ←────────────────────────────   artifact_graph_execution_id (bridge field in ExecutionBead)
ExecutionTrace ─────────────────────────→ artifact_graph_divergence_id (bridge field in OutcomeBead)
Amendment ─────────────────────────────→  artifact_graph_amendment_id  (bridge field in AmendmentBead)
Specification (new) ────────────────────→ artifact_graph_specification_id (bridge field in TrustBead/PolicyBead)
```

Neither DO calls the other. `LoopClosureService` is the only code that writes to both.

### Bridge Point 1 — openSession

```
Input: orgId, roleId, agentId, ns

1. beadGraphDO.retrieveKnowingState(orgId, roleId, 'default')
   → KnowingState<TrustContent, PolicyContent> | throws
   [on throw] → set autonomyFloor = 'SUGGEST'

2. artifactGraphDO.getActiveSpecification(ns, domain)
   → activeSpecificationId: string
   // Q-12: abstract method on ArtifactGraphDOBase — implemented by FactoryArtifactGraphDO

3. sessionId = crypto.randomUUID()
4. kvStore.put(`session:${sessionId}`, JSON.stringify({
     orgId, roleId, agentId,
     ksRetrievedAt: Date.now(),
     activeSpecificationId,
     autonomyFloor
   }), { expirationTtl: 86400 })  // 24h

5. return Session { sessionId, orgId, roleId, agentId, ksRetrievedAt, activeSpecificationId, autonomyFloor }
```

### Bridge Point 2 — recordExecution

```
Input: sessionId, payload: ExecutionContent

1. Read session from kvStore.get(`session:${sessionId}`)
   → { orgId, agentId, activeSpecificationId, autonomyFloor }

2. executionNodeId = generateId('execution')   // e.g. 'exec-{ulid}'
3. artifactGraphDO.upsertNode(executionNodeId, 'Execution', {
     session_id: sessionId,
     agent_id:   agentId,
     started:    Date.now(),
     domain:     payload.domain
   })

4. artifactGraphDO.upsertEdge(
     activeSpecificationId, executionNodeId, 'governs'
   )

5. beadContent = buildExecutionBeadContent(payload, executionNodeId)
   // adds artifact_graph_execution_id: executionNodeId

6. beadId = computeBeadId('execution', beadContent, [session.policyBeadId, session.trustBeadId])
7. auditBead = buildAuditBead(execBead, sessionId)
8. beadGraphDO.writeBead(execBead, auditBead)  // BEGIN/COMMIT transaction

9. return { executionBeadId: beadId, executionNodeId }
```

**Partial failure**: Steps 3–4 succeed, step 8 throws. The Execution node is an orphan. On next session call, the caller may retry `recordExecution` with the same payload. Both `upsertNode` and `upsertEdge` use `INSERT OR IGNORE`, so the retry produces no duplicate.

### Bridge Point 3 — recordOutcome

```
Input: sessionId, executionBeadId, outcome: OutcomeContent

1. Read session (sessionId → executionNodeId via prior session state or re-fetch)
2. traceId = generateId('trace')
3. artifactGraphDO.upsertNode(traceId, 'ExecutionTrace', {
     session_id:  sessionId,
     tool_calls:  outcome.toolCallCount,
     outcome:     outcome.status,
     summary:     outcome.summary
   })
4. artifactGraphDO.upsertEdge(executionNodeId, traceId, 'produces')

5. divergences = await config.detectDivergences(traceId, session.activeSpecificationId, artifactGraphDO)

6. divergenceId = undefined
   if divergences.length > 0:
     divergenceId = generateId('divergence')
     artifactGraphDO.upsertNode(divergenceId, 'Divergence', {
       claim_id:    divergences[0].claimId,
       description: divergences[0].description,
       severity:    divergences[0].severity,
       detected_at: Date.now()
     })
     artifactGraphDO.upsertEdge(traceId, divergenceId, 'evidences')
     artifactGraphDO.upsertEdge(traceId, session.activeSpecificationId, 'diverges_from')

7. outcomeContent = buildOutcomeBeadContent(outcome, divergenceId)
   // adds artifact_graph_divergence_id: divergenceId (or null)
8. outcomeBead = buildOutcomeBead(outcomeContent, orgId, agentId)
9. auditBead = buildAuditBead(outcomeBead, sessionId)
10. beadGraphDO.writeBead(outcomeBead, auditBead)

11. return { divergenceId, outcomeBeadId: outcomeBead.bead_id }
```

### Bridge Point 4 — proposeAmendment

```
Input: divergenceId, outcomeBeadId, orgId

1. hypothesis = await config.buildHypothesis(divergenceId, artifactGraphDO)

2. hypothesisId = generateId('hypothesis')
   artifactGraphDO.upsertNode(hypothesisId, 'Hypothesis', {
     fault_attribution: hypothesis.attribution,
     explanation:       hypothesis.explanation,
     confidence:        hypothesis.confidence
   })
   artifactGraphDO.upsertEdge(divergenceId, hypothesisId, 'evidence_for')

3. amendmentId = generateId('amendment')
   artifactGraphDO.upsertNode(amendmentId, 'Amendment', {
     proposed_change: hypothesis.proposedChange,
     status: 'candidate'
   })
   artifactGraphDO.upsertEdge(hypothesisId, amendmentId, 'motivates')
   artifactGraphDO.upsertEdge(amendmentId, session.activeSpecificationId, 'proposes_modification_of')

4. amendmentBeadContent = buildAmendmentBeadContent({
     target_bead_id:  hypothesis.targetBeadId,
     target_type:     hypothesis.targetType,
     proposed_change: hypothesis.proposedChange,
     rationale:       hypothesis.explanation,
     triggered_by:    outcomeBeadId,
     status:          'PENDING'
   }, amendmentId)
   // adds artifact_graph_amendment_id: amendmentId

5. amendmentBead = buildAmendmentBead(amendmentBeadContent, orgId, agentId)
6. auditBead = buildAuditBead(amendmentBead, sessionId)
7. beadGraphDO.writeBead(amendmentBead, auditBead)

8. return { amendmentId, amendmentBeadId: amendmentBead.bead_id }
```

### Bridge Point 5 — adoptAmendment (six-step sequence)

```
Input: amendmentId, amendmentBeadId, reviewer, verificationResult: VerificationResult

--- Step 1: Verification ---
vpId = generateId('verification-process')
verdictId = generateId('verdict')
artifactGraphDO.upsertNode(vpId, 'VerificationProcess', { gate, evaluated_at })
artifactGraphDO.upsertNode(verdictId, 'Verdict', {
  outcome: verificationResult.passed ? 'favorable' : 'unfavorable',
  gate, score
})
artifactGraphDO.upsertEdge(vpId, verdictId, 'produces_verdict')
artifactGraphDO.upsertEdge(amendmentId, vpId, 'subject_to')

if (!verificationResult.passed):
  → rejectAmendment(amendmentId, amendmentBeadId, ...)
  → return { rejected: true }    // ← EARLY EXIT; no further writes

--- Step 2: New Specification ---
newSpecId = generateId('specification')
artifactGraphDO.upsertNode(newSpecId, 'Specification', {
  artifact_id:  amendment.targetArtifactId,
  version:      incrementVersion(priorSpec.data.version),
  content_hash: computeContentHash(amendment.proposedChange),
  explicitness: 'derived',
  source_refs:  [priorSpecId, amendmentId]
})
artifactGraphDO.upsertEdge(newSpecId, priorSpecId, 'version_of')
artifactGraphDO.upsertEdge(amendmentId, newSpecId, 'if_adopted_produces')

--- Step 3a: DispositionEvent (§4B.4 — moment of possibility-space collapse) ---
// Q-13 resolution: must be created here; dispositionEventId is not passed in nor pre-existing
dispositionEventId = generateId('disposition-event')
artifactGraphDO.upsertNode(dispositionEventId, 'DispositionEvent', {
  occurred_at:  Date.now(),
  context:      'amendment_adoption',
  amendment_id: amendmentId
})

--- Step 3b: ElucidationArtifact (MANDATORY — Axiom A9) ---
eaId = generateId('elucidation-artifact')
artifactGraphDO.upsertNode(eaId, 'ElucidationArtifact', {
  selected_option:  amendment.proposedChange,
  rejected_options: amendment.alternativesConsidered ?? [],
  assumptions:      amendment.assumptions ?? [],
  risks_accepted:   amendment.risksAccepted ?? []
})
artifactGraphDO.upsertEdge(eaId, dispositionEventId, 'produced_at')

--- Step 4: New TrustBead or PolicyBead ---
newBeadContent = buildNewBeadContent(amendment.proposedChange, newSpecId)
  // adds artifact_graph_specification_id: newSpecId
newBeadId = computeBeadId(amendment.targetType, newBeadContent, [amendment.targetBeadId])
newBead = buildTrustOrPolicyBead(amendment.targetType, newBeadContent, orgId, agentId)
auditBead = buildAuditBead(newBead, sessionId)
beadGraphDO.writeBead(newBead, auditBead)
beadGraphDO.sql.exec(
  'INSERT OR IGNORE INTO bead_edges (child_id, parent_id, rel) VALUES (?, ?, ?)',
  newBeadId, amendment.targetBeadId, 'supersedes'
)

--- Step 5: KV Invalidation (BEFORE returning) ---
invalidateKV(orgId, amendment.targetType, amendment.targetBeadId)
  → kvStore.delete(`ks:${orgId}:*`)
  → kvStore.delete(`head:${orgId}:*`)
  → kvStore.delete(`maintenance:${orgId}`)

--- Step 6: AmendmentBead status → APPROVED ---
approvedAmendmentBead = buildAmendmentBead({
  ...amendmentBead.content,
  status: 'APPROVED',
  reviewed_by: reviewer,
  reviewed_at: new Date().toISOString(),
  if_approved_produces: newBeadId
}, orgId, reviewer)
auditBead = buildAuditBead(approvedAmendmentBead, sessionId)
beadGraphDO.writeBead(approvedAmendmentBead, auditBead)

return { newSpecId, newBeadId }
```

---

## Cloudflare Primitives Used and Why

| Primitive | Usage | Rationale |
|-----------|-------|-----------|
| **Cloudflare Durable Object (ArtifactGraphDOBase)** | `upsertNode`, `upsertEdge`, `getActiveSpecification` | Single-writer serialization for artifact graph mutations (INV-KSP-003). |
| **Cloudflare Durable Object (BeadGraphDOBase)** | `retrieveKnowingState`, `writeBead`, `sql.exec` | Single-writer serialization for bead graph mutations; `BEGIN/COMMIT` transaction guarantee. |
| **Cloudflare KV** | `kvStore.put`, `kvStore.get`, `kvStore.delete` | Hot cache for session state and knowing-state (TTLs: session 24h, ks 1h, maintenance 6h). KV is never the source of truth — DO SQLite is the fallback. |
| **Cloudflare Workers Crypto** | `crypto.randomUUID()`, `SHA-256` for `computeBeadId` and `computeContentHash` | ID generation and content-addressing are built-in to the Workers runtime. |

No external network calls. No ArangoDB. No D1 writes from this module (D1 `bead_audit` is written by the CoordinatorDO in `@factory/gears`, not by the loop closure service).

---

## Integration Points

### What This Package Calls

| Target | Method | Bridge Point |
|--------|--------|-------------|
| `ArtifactGraphDOBase` | `upsertNode`, `upsertEdge`, `getActiveSpecification` | BP1, BP2, BP3, BP4, BP5 |
| `BeadGraphDOBase` | `retrieveKnowingState`, `writeBead`, `sql.exec` | BP1, BP2, BP3, BP4, BP5 |
| `KVNamespace` | `put`, `get`, `delete` | BP1 (write), BP5 (invalidate) |
| `config.detectDivergences` | domain-provided async function | BP3 |
| `config.buildHypothesis` | domain-provided async function | BP4 |
| `config.verifyAmendment` | domain-provided async function | BP5 |

### What Calls This Package

| Caller | Domain | Bridge Points triggered |
|--------|--------|------------------------|
| Commissioning Agent (`@factory/factory-graph`) | Factory | All 5 |
| `CoordinatorDO.releaseBead()` / `failBead()` (`@factory/gears`) | Factory | BP3 (recordOutcome) |
| outcomeHandler (event handler) | ComeFlow | All 5 |
| PAA (Proactive Assistance Agent) | CareTrace | All 5 |

### Package Dependencies

```
@factory/loop-closure
  → @factory/artifact-graph   (ArtifactGraphDOBase, ArtifactNode, ArtifactEdge types)
  → @factory/bead-graph       (BeadGraphDOBase, all Bead types, computeBeadId, buildAuditBead)
  → @cloudflare/workers-types (KVNamespace)
```

Note: `@factory/ksp-sdk` is NOT a dependency of `@factory/loop-closure`. The SDK wraps the bead graph; the loop closure service operates at a lower level, calling `beadGraphDO` directly.

---

## Bridge Field Contract

The following fields appear in Bead content schemas. They are optional (INV-LC-002) — storage invariants hold without them. The loop closure service writes them; the bead graph DO never enforces or requires them.

| Bead type | Bridge field | Target node in artifact graph |
|-----------|-------------|-------------------------------|
| `ExecutionBead` | `artifact_graph_execution_id` | `Execution` node |
| `OutcomeBead` | `artifact_graph_divergence_id` | `Divergence` node (null if no divergence) |
| `AmendmentBead` | `artifact_graph_amendment_id` | `Amendment` node |
| `TrustBead` (post-adoption) | `artifact_graph_specification_id` | `Specification` node |
| `PolicyBead` (post-adoption) | `artifact_graph_specification_id` | `Specification` node |

These fields are defined as optional string fields in the Zod schemas in `@factory/bead-graph`. They are never used for lookup within the bead graph — they exist solely for audit and cross-layer traceability.

---

## Artifact Graph Nodes Written by This Module

| Node type | Written by | Edges written |
|-----------|-----------|---------------|
| `Execution` | `recordExecution` (BP2) | `Specification → Execution` (`governs`) |
| `ExecutionTrace` | `recordOutcome` (BP3) | `Execution → ExecutionTrace` (`produces`) |
| `Divergence` | `recordOutcome` (BP3) | `ExecutionTrace → Divergence` (`evidences`), `ExecutionTrace → Specification` (`diverges_from`) |
| `Hypothesis` | `proposeAmendment` (BP4) | `Divergence → Hypothesis` (`evidence_for`) |
| `Amendment` | `proposeAmendment` (BP4) | `Hypothesis → Amendment` (`motivates`), `Amendment → Specification` (`proposes_modification_of`) |
| `VerificationProcess` | `adoptAmendment` (BP5) | `Amendment → VerificationProcess` (`subject_to`) |
| `Verdict` | `adoptAmendment` (BP5) | `VerificationProcess → Verdict` (`produces_verdict`) |
| `Specification` (new) | `adoptAmendment` (BP5) | `Specification → prior Specification` (`version_of`), `Amendment → Specification` (`if_adopted_produces`) |
| `ElucidationArtifact` | `adoptAmendment` (BP5) | `ElucidationArtifact → DispositionEvent` (`produced_at`) |

---

## Session State (KV Schema)

The session record written to KV at Bridge Point 1:

```typescript
interface SessionRecord {
  sessionId:             string;
  orgId:                 string;
  roleId:                string;
  agentId:               string;
  ksRetrievedAt:         number;    // epoch ms
  activeSpecificationId: string;    // artifact graph Specification node ID
  autonomyFloor:         Autonomy;  // 'SUGGEST' | 'PROPOSE' | 'EXECUTE_BOUNDED' | 'EXECUTE_FULL'
  policyBeadId?:         string;    // bead_id of the PolicyBead in effect at session open
  trustBeadId?:          string;    // bead_id of the TrustBead in effect at session open
}
```

KV key: `session:{sessionId}` | TTL: 86400 seconds (24 hours)

---

## Invariant Summary

| ID | Statement |
|----|-----------|
| INV-LC-001 | No direct storage coupling — `ArtifactGraphDO` and `BeadGraphDO` never call each other |
| INV-LC-002 | Bridge fields are optional — Bead storage invariants hold without them |
| INV-LC-003 | Artifact graph write precedes Bead graph write at BP2; both writes are idempotent |
| INV-LC-004 | BP5 is atomic at the semantic level — all 6 steps complete or the prior Specification remains active |
| INV-LC-005 | ElucidationArtifact written unconditionally on every Amendment adoption (Axiom A9) |
| INV-LC-006 | KV invalidated (Step 5 of BP5) before the adoption result is returned to the caller |

---

## Open Gaps

| Gap | Severity | Note |
|-----|---------|------|
| Only the first detected divergence is written as a `Divergence` node (index 0). Multiple divergences per trace are not yet handled. | MEDIUM | Spec implies `divergences[0]` only. Future: write one Divergence node per detected divergence with separate edges. |
| `policyBeadId` and `trustBeadId` are optional in session state. If `retrieveKnowingState` returns no active policy, `computeBeadId` parent IDs may be incomplete. | LOW | Downstream bead graph enforces content-addressing; the loop closure service passes what it has. |
| `dispositionEventId` in Bridge Point 5 Step 3 | RESOLVED | DispositionEvent node generated in Step 3a immediately before ElucidationArtifact (§4B.4). See tasks.md Step 25e. |
