# Flowchart: ksp-factory-graph — Knowing-State Prosthesis Full Loop
> Source: SPEC-KSP-FACTORY-001.md §7 | Module: packages/factory-graph

## Main Call Flow — Seven-Step Loop (Sequence Diagram)

```mermaid
sequenceDiagram
    participant CA as Commissioning Agent<br/>(CF Worker)
    participant ArtG as ArtifactGraphDO<br/>(Factory)
    participant LC as LoopClosureService
    participant BG as BeadGraphDO<br/>(Factory)
    participant KV as CF KV
    participant MA as Mediation Agent DO
    participant ConductA as Conducting Agent<br/>(Gas City / Flue)
    participant SDK as KnowingStateSDK
    participant ArchA as Architect Agent DO

    Note over CA,KV: STEP 1 — WorkGraph → ArchitectureDecisionBead
    CA->>ArtG: getNode(spec-wg-ff-001-v2) [WorkGraph read]
    ArtG-->>CA: Specification node
    CA->>BG: writeBead(ArchitectureDecisionBead, AuditBead)
    CA->>KV: SET head:{repoId}:arch_decision = bead_id

    Note over ConductA,SDK: STEP 2 — Session open: retrieve knowing-state (I2 enforcement)
    ConductA->>SDK: openSession(repoId, 'conducting-agent', agentId)
    SDK->>KV: GET ks:{repoId}:conducting-agent:* [hot path]
    alt KV cache hit
        KV-->>SDK: KnowingState payload
    else KV cache miss (cold path)
        SDK->>MA: retrieveKnowingState(repoId, 'conducting-agent')
        MA->>BG: query ArchitectureDecisionBead + PatternTrustBead
        BG-->>MA: beads
        MA-->>SDK: KnowingState
        SDK->>KV: SET ks:{repoId}:conducting-agent:* [populate cache]
    end
    SDK-->>ConductA: session { policy, trustedSubjects, consent }

    alt retrieveKnowingState fails (DO unavailable / missing bead)
        SDK-->>ConductA: session.autonomyFloor = 'SUGGEST'
        Note over ConductA: Execution blocked — surfaces options only
    end

    Note over ConductA,MA: STEP 3 — AtomDirective → CommitBead + Execution node
    ConductA->>MA: dispatchAtomDirective(atom-42, sessionId)
    MA->>LC: recordExecution(atomDirective, sessionId)
    LC->>ArtG: write Execution node (exec-atom-42-attempt-1)
    LC->>ArtG: write governs edge (spec-wg-ff-001-v2 → exec-atom-42-attempt-1)
    LC->>BG: writeBead(CommitBead{artifact_graph_execution_id}, AuditBead)

    Note over ConductA,MA: STEP 4 — Outcome received
    ConductA->>MA: reportOutcome(traceFragment)
    MA->>LC: recordOutcome(traceFragment)

    alt Scenario A — Success (no divergence)
        LC->>ArtG: write ExecutionTrace node (trace-atom-42, outcome='success')
        LC->>ArtG: write produces edge (exec-atom-42 → trace-atom-42)
        LC->>BG: writeBead(BuildOutcomeBead{status='success', triggers_amendment=false}, AuditBead)
    else Scenario B — Divergence detected
        LC->>ArtG: write ExecutionTrace node (outcome='failure')
        LC->>ArtG: write produces edge
        LC->>ArtG: write diverges_from edge (trace → spec)
        LC->>ArtG: write Divergence node (div-001, severity='critical')
        LC->>ArtG: write evidences edge (trace → div-001)
        LC->>BG: writeBead(BuildOutcomeBead{status='failure', triggers_amendment=true,<br/>divergence_severity='blocking', artifact_graph_divergence_id='div-001'}, AuditBead)
    end

    Note over CA,BG: STEP 5 — Commissioning Agent: Divergence → Hypothesis → ArchAmendmentBead
    CA->>MA: poll() [detect blocking divergence]
    MA-->>CA: BuildOutcomeBead with triggers_amendment=true
    CA->>ArtG: factoryHypothesisBuilder(div-001, artifactGraph)
    ArtG-->>CA: divNode, priorHypotheses, elucidationArts
    CA->>CA: dispatcher.dispatch({taskKind:'synthesis', ...}) [Claude Opus]
    CA->>ArtG: write Hypothesis node (hyp-001, confidence=0.87)
    CA->>ArtG: write evidence_for edge (div-001 → hyp-001)
    CA->>ArtG: write Amendment node (amd-001, status='candidate')
    CA->>ArtG: write motivates edge (hyp-001 → amd-001)
    CA->>ArtG: write proposes_modification_of edge (amd-001 → spec-wg-ff-001-v2)
    CA->>BG: writeBead(ArchAmendmentBead{status='PENDING', artifact_graph_amendment_id='amd-001'}, AuditBead)

    Note over CA,ArchA: STEP 6 — Verification: Amendment → VerificationProcess → Verdict
    CA->>LC: verifyAmendment(amd-001, artifactGraph)
    LC->>ArtG: getLinkedDivergences(amd-001)
    LC->>ArtG: walkBoundedPath(divergenceIds, [{rel:'concerns', targetType:'Claim'}])
    LC->>LC: evaluateCoherence(proposed_change, claims)

    alt coherenceScore > 0.7
        LC->>ArchA: checkCrossRepoPattern(proposed_change)
        ArchA-->>LC: patternScore
    else coherenceScore <= 0.7
        LC->>LC: patternScore = 0.5 (skip cross-repo scan)
    end

    alt coherenceScore >= 0.75 AND patternScore >= 0.5
        LC->>ArtG: write VerificationProcess node (vp-001, gate='compile')
        LC->>ArtG: write Verdict node (verdict-001, outcome='favorable')
        LC->>ArtG: write subject_to edge (amd-001 → vp-001)
        LC->>ArtG: write produces_verdict edge (vp-001 → verdict-001)
        LC-->>CA: VerificationResult{passed=true}
    else verification fails (coherenceScore < 0.75)
        LC-->>CA: VerificationResult{passed=false}
        CA->>ArchA: openCRP(amendment, divergencePattern)
        Note over CA,ArchA: CRP resolution path — out of factory-graph scope
    end

    Note over CA,KV: STEP 7 — Adoption: new Specification + new ArchitectureDecisionBead
    CA->>LC: adoptAmendment(amd-001, verdictId)
    LC->>ArtG: write new Specification node (spec-wg-ff-001-v3, WorkGraph)
    LC->>ArtG: write version_of edge (v3 → v2)
    LC->>ArtG: write if_adopted_produces edge (amd-001 → v3)
    LC->>ArtG: write ElucidationArtifact node (ea-001) [INV-KSP-004 — unconditional]
    LC->>ArtG: write produced_at edge (ea-001 → disposition-event-001)
    LC->>BG: writeBead(new ArchitectureDecisionBead{work_graph_version='v3',<br/>artifact_graph_specification_id='spec-wg-ff-001-v3'}, AuditBead)
    LC->>BG: INSERT bead_edges(new.bead_id, old.bead_id, 'supersedes')
    LC->>BG: writeBead(ArchAmendmentBead{status='APPROVED', reviewed_by='architect-agent',<br/>if_approved_produces=new.bead_id}, AuditBead)
    LC->>KV: DELETE ks:{repoId}:conducting-agent:*   [INV-KSP-006]
    LC->>KV: DELETE head:{repoId}:arch_decision
    LC->>KV: DELETE maintenance:{repoId}
    LC-->>CA: adoptAmendment() returns

    Note over ConductA,SDK: Loop closed — next session retrieves updated ArchitectureDecisionBead
    ConductA->>SDK: openSession() [next cycle]
    SDK->>KV: GET ks:{repoId}:conducting-agent:* [cache miss — invalidated]
    SDK->>BG: retrieveKnowingState() → new ArchitectureDecisionBead (v3)
```

## Divergence Severity Routing

```mermaid
flowchart TD
    OUT[BuildOutcomeBead received] --> SEV{divergence_severity?}
    SEV -->|blocking| SUSP[Increment auto-suspend counter]
    SEV -->|advisory| QUEUE[Queue hypothesis at next poll]
    SEV -->|informational| LOG[Log only — no governance action]
    SUSP --> THRESH{Threshold reached?}
    THRESH -->|yes| ESC[write EscalationBead\n+ /suspend We-layer]
    THRESH -->|no| HYP[factoryHypothesisBuilder\nClaude Opus synthesis]
    QUEUE --> HYP
    HYP --> AMD[Write ArchAmendmentBead\nstatus=PENDING]
    AMD --> VER[factoryAmendmentVerifier\nCoherence + Pattern Score]
    VER --> PASS{passed?}
    PASS -->|yes| ADOPT[adoptAmendment\nnew Specification + KV invalidation]
    PASS -->|no| CRP[Open CRP to Architect Agent DO]
```

## Package Dependency Graph

```mermaid
graph LR
    FG[packages/factory-graph] --> AG[@factory/artifact-graph]
    FG --> BG_PKG[@factory/bead-graph]
    FG --> LC[@factory/loop-closure]
    LC --> AG
    LC --> BG_PKG
    KSS[@factory/ksp-sdk] --> BG_PKG
    MA_PKG[packages/mediation-agent] --> FG
    MA_PKG --> KSS
    COMM[workers/commissioning] --> FG
    ARCH[packages/architect-agent] --> FG
```

## Bead Graph Topology (repo scope)

```mermaid
graph TD
    ADB[ArchitectureDecisionBead\nPolicyBead — WorkGraph head]
    ERB[EngineerRoleBead\nRoleBead — session identity]
    PTB[PatternTrustBead\nTrustBead — Verdict state]
    CB[CommitBead\nExecutionBead — per atom]
    BOB[BuildOutcomeBead\nOutcomeBead — per result]
    AAB[ArchAmendmentBead\nAmendmentBead — if Divergence]
    PTB2[PatternTrustBead NEW\nsupersedes old]
    ADB2[ArchitectureDecisionBead NEW\nsupersedes old]
    AUDIT[AuditBead\nevery write]

    ADB --> ERB
    ERB --> PTB
    PTB --> CB
    CB --> BOB
    BOB --> AAB
    AAB --> PTB2
    AAB --> ADB2
    ADB2 -.->|supersedes| ADB
    AUDIT -.->|accompanies every writeBead| ADB
    AUDIT -.->|accompanies every writeBead| CB
    AUDIT -.->|accompanies every writeBead| BOB
    AUDIT -.->|accompanies every writeBead| AAB
```
