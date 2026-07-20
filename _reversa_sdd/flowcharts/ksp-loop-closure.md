# Flowchart: ksp-loop-closure (@factory/loop-closure)
> Source: SPEC-KSP-LOOP-CLOSURE-001.md

## Main Call Flow — Full Loop Sequence

```mermaid
sequenceDiagram
    autonumber
    participant DC as Domain Coordinator<br/>(Commissioning Agent / outcomeHandler / PAA)
    participant LC as LoopClosureService<br/>(@factory/loop-closure)
    participant KV as KV Store<br/>(session cache)
    participant AG as ArtifactGraphDO
    participant BG as BeadGraphDO

    Note over DC,BG: Bridge Point 1 — openSession

    DC->>LC: openSession(orgId, roleId, agentId, ns)
    LC->>BG: retrieveKnowingState(orgId, roleId, category)
    BG-->>LC: { policy, trust }
    LC->>AG: getActiveSpecification(ns, domain)
    AG-->>LC: activeSpecificationId
    LC->>KV: put(session:{sessionId}, { orgId, roleId, agentId,<br/>ksRetrievedAt, activeSpecificationId, autonomyFloor })
    LC-->>DC: Session

    Note over DC,BG: Bridge Point 2 — recordExecution

    DC->>LC: recordExecution(sessionId, payload)
    LC->>AG: upsertNode(executionId, 'Execution', {...})
    AG-->>LC: ok
    LC->>AG: upsertEdge(activeSpecificationId, executionId, 'governs')
    AG-->>LC: ok

    alt Bead graph write fails (orphan recovery path)
        LC->>BG: writeBead(ExecutionBead + artifact_graph_execution_id, auditBead)
        BG-->>LC: error
        Note right of LC: Orphan Execution node in AG.<br/>Retry on next session operation.<br/>upsertNode is idempotent.
    else Normal path
        LC->>BG: writeBead(ExecutionBead + artifact_graph_execution_id, auditBead)
        BG-->>LC: ok
    end

    LC-->>DC: { executionBeadId, executionNodeId }

    Note over DC,BG: Bridge Point 3 — recordOutcome

    DC->>LC: recordOutcome(sessionId, executionBeadId, outcome)
    LC->>AG: upsertNode(traceId, 'ExecutionTrace', {...})
    LC->>AG: upsertEdge(executionNodeId, traceId, 'produces')
    LC->>DC: detectDivergences(traceId, specificationId, AG)
    DC-->>LC: DetectedDivergence[]

    alt Divergences detected
        LC->>AG: upsertNode(divergenceId, 'Divergence', {...})
        LC->>AG: upsertEdge(traceId, divergenceId, 'evidences')
        LC->>AG: upsertEdge(traceId, activeSpecificationId, 'diverges_from')
        LC->>BG: writeBead(OutcomeBead + artifact_graph_divergence_id, auditBead)
        LC-->>DC: { divergenceId, outcomeBeadId }
    else No divergences
        LC->>BG: writeBead(OutcomeBead, auditBead)
        LC-->>DC: { outcomeBeadId }
    end

    Note over DC,BG: Bridge Point 4 — proposeAmendment (only if divergence)

    DC->>LC: proposeAmendment(divergenceId, outcomeBeadId, orgId)
    LC->>DC: buildHypothesis(divergenceId)
    DC-->>LC: Hypothesis { attribution, explanation, confidence }
    LC->>AG: upsertNode(hypothesisId, 'Hypothesis', {...})
    LC->>AG: upsertEdge(divergenceId, hypothesisId, 'evidence_for')
    LC->>AG: upsertNode(amendmentId, 'Amendment', { status: 'candidate' })
    LC->>AG: upsertEdge(hypothesisId, amendmentId, 'motivates')
    LC->>AG: upsertEdge(amendmentId, activeSpecificationId, 'proposes_modification_of')
    LC->>BG: writeBead(AmendmentBead + artifact_graph_amendment_id, auditBead)
    BG-->>LC: ok
    LC-->>DC: { amendmentId, amendmentBeadId }

    Note over DC,BG: Bridge Point 5 — adoptAmendment (after human review or automated verification)

    DC->>LC: adoptAmendment(amendmentId, amendmentBeadId, reviewer, verificationResult)

    LC->>AG: upsertNode(vpId, 'VerificationProcess', {...})
    LC->>AG: upsertNode(verdictId, 'Verdict', { outcome, gate, score })
    LC->>AG: upsertEdge(vpId, verdictId, 'produces_verdict')
    LC->>AG: upsertEdge(amendmentNodeId, vpId, 'subject_to')

    alt Verification failed
        LC->>BG: writeBead(AmendmentBead{ status: 'REJECTED' }, auditBead)
        LC-->>DC: { rejected: true }
    else Verification passed
        LC->>AG: upsertNode(newSpecId, 'Specification', { version: incremented, content_hash, explicitness: 'derived' })
        LC->>AG: upsertEdge(newSpecId, priorSpecId, 'version_of')
        LC->>AG: upsertEdge(amendmentNodeId, newSpecId, 'if_adopted_produces')

        Note right of LC: Axiom A9 — Elucidation Obligation (INV-LC-005)
        LC->>AG: upsertNode(eaId, 'ElucidationArtifact', { selected_option, rejected_options, assumptions, risks_accepted })
        LC->>AG: upsertEdge(eaId, dispositionEventId, 'produced_at')

        LC->>BG: writeBead(new TrustBead/PolicyBead + artifact_graph_specification_id, auditBead)
        LC->>BG: sql INSERT bead_edges (newBeadId, targetBeadId, 'supersedes')

        Note right of LC: INV-LC-006 — KV invalidated before return
        LC->>KV: invalidateKV(orgId, targetType, targetBeadId)

        LC->>BG: writeBead(AmendmentBead{ status: 'APPROVED', if_approved_produces: newBeadId }, auditBead)
        LC-->>DC: { newSpecId, newBeadId }
    end
```

---

## Simplified Loop Overview

```mermaid
flowchart TD
    A([Session Open]) -->|Bridge Point 1| B[Retrieve KnowingState from BeadGraphDO\nGet active Specification from ArtifactGraphDO\nCache in KV]
    B --> C([Agent Executes])
    C -->|Bridge Point 2| D[Write Execution node → ArtifactGraphDO\nWrite ExecutionBead → BeadGraphDO\n+ artifact_graph_execution_id]
    D --> E([Execution Completes])
    E -->|Bridge Point 3| F[Write ExecutionTrace → ArtifactGraphDO\nRun detectDivergences]
    F --> G{Divergence\ndetected?}
    G -->|No| H([Loop ends — no amendment])
    G -->|Yes| I[Write Divergence → ArtifactGraphDO\nWrite OutcomeBead → BeadGraphDO\n+ artifact_graph_divergence_id]
    I -->|Bridge Point 4| J[Write Hypothesis + Amendment → ArtifactGraphDO\nWrite AmendmentBead → BeadGraphDO\n+ artifact_graph_amendment_id\nstatus = PENDING]
    J --> K([Human / Automated Review])
    K --> L{Verification\npassed?}
    L -->|No| M[Write Verdict unfavorable\nAmendmentBead status = REJECTED]
    L -->|Yes| N[Bridge Point 5:\nWrite new Specification → ArtifactGraphDO\nWrite ElucidationArtifact → ArtifactGraphDO\nWrite new TrustBead/PolicyBead → BeadGraphDO\nWrite supersedes edge\nInvalidate KV\nAmendmentBead status = APPROVED]
    N --> O([New Specification active\nNext session uses amended knowing-state])
```

---

## Partial Failure Recovery — Bridge Point 2

```mermaid
sequenceDiagram
    participant LC as LoopClosureService
    participant AG as ArtifactGraphDO
    participant BG as BeadGraphDO

    LC->>AG: upsertNode(executionId, 'Execution', ...)
    AG-->>LC: ok ✓

    LC->>BG: writeBead(ExecutionBead, ...)
    BG-->>LC: error ✗

    Note over LC: Execution node is orphan in AG.<br/>Session continues.

    LC->>LC: Next session operation triggered
    LC->>BG: writeBead(ExecutionBead, ...)  [retry — same executionId]
    BG-->>LC: ok ✓

    Note over LC,AG: upsertNode on AG is idempotent;<br/>no duplicate created on retry.
```
