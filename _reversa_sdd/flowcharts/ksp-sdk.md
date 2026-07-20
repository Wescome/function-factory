# ksp-sdk — Main Call Flow
> Source: SPEC-KSP-BEAD-GRAPH-001.md §8 (KnowingStateSDK interface)

## Session Lifecycle with Execution Loop

```mermaid
sequenceDiagram
    participant A as Agent / Caller
    participant SDK as KnowingStateSDK
    participant KV as Cloudflare KV
    participant DO as BeadGraphDO (SQLite)

    %% ── Session Open ──────────────────────────────────────────────────────────
    A->>SDK: openSession(orgId, roleId, agentId)
    SDK->>KV: PUT session:{sessionId} { orgId, roleId, agentId, autonomyFloor } TTL=24h
    SDK-->>A: Session { sessionId, autonomyFloor }

    %% ── I2: Retrieval enforcement ─────────────────────────────────────────────
    A->>SDK: retrieveKnowingState(sessionId, category?)
    SDK->>KV: GET ks:{orgId}:{roleId}:{category}
    alt KV hit (within 1h TTL)
        KV-->>SDK: { trustedSubjects, policy }
    else KV miss
        SDK->>DO: retrieveKnowingState(orgId, roleId, category?)
        Note over DO: Query 1: policy WHERE scope=roleId OR scope='org' LIMIT 1<br/>Query 2: APPROVED trust beads, no supersedes child, ORDER BY trust_score DESC<br/>Query 3: getActiveConsent(orgId, roleId)
        DO-->>SDK: { policy, trustedSubjects, consent }
        SDK->>KV: PUT ks:{orgId}:{roleId}:{category} TTL=1h
    end
    alt retrieval fails / empty trust / no consent
        SDK->>SDK: session.autonomyFloor = 'SUGGEST'
        SDK-->>A: KnowingState (degraded)
        Note over A,SDK: I4: fail-closed — autonomy degrades to SUGGEST
    else success
        SDK->>SDK: session.ksRetrievedAt = now()
        SDK-->>A: KnowingState<TrustContent, PolicyContent>
    end

    %% ── Trust Evaluation ──────────────────────────────────────────────────────
    A->>SDK: evaluateTrust(sessionId, subjectId)
    SDK->>KV: GET head:{orgId}:trust:{subjectId}
    alt KV hit
        KV-->>SDK: bead_id
        SDK->>DO: getBead(bead_id)
    else KV miss
        SDK->>DO: getCurrentTrustBead(orgId, subjectId)
        Note over DO: SELECT b.* WHERE type='trust' AND subject_id=? AND NOT EXISTS supersedes-child ORDER BY ts DESC LIMIT 1
        DO-->>SDK: TrustBead | null
    end
    SDK-->>A: TrustEvaluation { trusted, trustBead, autonomy }

    %% ── Consent Check ─────────────────────────────────────────────────────────
    A->>SDK: checkConsent(sessionId, action)
    SDK->>KV: GET consent:{orgId}:{roleId}   (TTL=15min)
    alt KV hit
        KV-->>SDK: { grants: string[] }
    else KV miss
        SDK->>DO: getActiveConsent(orgId, roleId)
        Note over DO: SELECT b.* WHERE type='consent' AND role_id=? AND status='ACTIVE' ORDER BY ts DESC LIMIT 1
        DO-->>SDK: ConsentBead | null
        SDK->>KV: PUT consent:{orgId}:{roleId} TTL=15min
    end
    SDK-->>A: boolean (action in grants)

    %% ── Execution Write ───────────────────────────────────────────────────────
    A->>SDK: writeExecutionBead(sessionId, payload)
    SDK->>SDK: assert session.ksRetrievedAt is set
    Note right of SDK: throws SessionNotInitialized if not set (INV-BG-003)
    SDK->>SDK: assert autonomyFloor allows execution level
    Note right of SDK: throws AutonomyDegradedError if floor=SUGGEST (INV-BG-008)
    SDK->>SDK: computeBeadId('execution', content, parentIds)
    Note right of SDK: SHA-256(type + canonical_json(content) + sorted(parentIds))
    SDK->>DO: writeBead(executionBead, auditBead)
    Note over DO: BEGIN<br/>INSERT OR IGNORE INTO beads (executionBead)<br/>INSERT OR IGNORE INTO bead_edges (parent edges)<br/>INSERT OR IGNORE INTO beads (auditBead)  ← INV-BG-007<br/>INSERT OR IGNORE INTO bead_edges (auditBead audits executionBead)<br/>COMMIT
    DO-->>SDK: void (or ROLLBACK + throw on error)
    SDK->>KV: invalidateKV() — no relevant KV keys for execution beads
    SDK-->>A: bead_id (string)

    %% ── Outcome Write + Amendment Trigger ────────────────────────────────────
    A->>SDK: writeOutcomeBead(sessionId, executionBeadId, outcome)
    SDK->>SDK: computeBeadId('outcome', content, [executionBeadId])
    SDK->>DO: writeBead(outcomeBead, auditBead)
    Note over DO: BEGIN/COMMIT — same atomic pattern as above
    DO-->>SDK: void
    SDK->>KV: invalidateKV() → DELETE maintenance:{orgId}
    alt outcome.triggers_amendment = true
        SDK->>SDK: computeBeadId('amendment', amendmentContent, [outcomeBead.bead_id])
        SDK->>DO: writeBead(amendmentBead, amendmentAuditBead)
        Note over DO: AmendmentBead written as NEW Bead — target TrustBead/PolicyBead NOT modified (INV-BG-004)
        DO-->>SDK: void
        SDK->>KV: invalidateKV() → DELETE maintenance:{orgId}
    end
    SDK-->>A: outcomeBead bead_id (string)

    %% ── Get Open Amendments ───────────────────────────────────────────────────
    A->>SDK: getOpenAmendments(orgId)
    SDK->>DO: getOpenAmendments(orgId)
    Note over DO: SELECT b.* WHERE type='amendment' AND status='PENDING' ORDER BY ts DESC
    DO-->>SDK: AmendmentBead[]
    SDK-->>A: AmendmentBeadContent[]

    %% ── Session Close ─────────────────────────────────────────────────────────
    A->>SDK: closeSession(sessionId)
    SDK->>KV: DELETE session:{sessionId}
    SDK-->>A: void
```

## Fail-Closed Degradation Path (I4)

```mermaid
sequenceDiagram
    participant A as Agent / Caller
    participant SDK as KnowingStateSDK
    participant DO as BeadGraphDO (SQLite)

    A->>SDK: retrieveKnowingState(sessionId)
    SDK->>DO: retrieveKnowingState(orgId, roleId, category?)
    alt DO unavailable / throws
        DO--xSDK: Error
        SDK->>SDK: session.autonomyFloor = 'SUGGEST'
        SDK-->>A: KnowingState (degraded — policy=null, trustedSubjects=[], consent=null)
    else consent missing
        DO-->>SDK: { policy, trustedSubjects: [], consent: null }
        SDK->>SDK: session.autonomyFloor = 'SUGGEST'
        SDK-->>A: KnowingState (degraded)
    end

    A->>SDK: writeExecutionBead(sessionId, payload) with autonomy_level='EXECUTE_FULL'
    SDK->>SDK: check autonomyFloor = 'SUGGEST'
    SDK--xA: throws AutonomyDegradedError
    Note over A,SDK: Execution is fail-closed — agent cannot proceed at elevated autonomy
```

## Bead Identity Computation

```mermaid
flowchart TD
    A[type: string] --> H
    B[content: Record] --> C[JSON.stringify with sorted keys]
    C --> H
    D[parentIds: string[]] --> E["[...parentIds].sort().join('')"]
    E --> H
    H["SHA-256(type + canonical_json + sorted_parents)"] --> I[bead_id: hex string]
    I --> J{bead_id matches provided id?}
    J -->|yes| K[INSERT OR IGNORE — idempotent]
    J -->|no| L[throw BeadIntegrityError]
```

## KV Invalidation Map

```mermaid
flowchart LR
    TW[TrustBead written] --> KS["DELETE ks:{orgId}:{roleId}:{category}"]
    TW --> HT["DELETE head:{orgId}:trust:{subjectId}"]
    PW[PolicyBead written] --> KS2["DELETE ks:{orgId}:{roleId}:{category}"]
    PW --> PO["DELETE policy:{orgId}:{roleId}"]
    CW[ConsentBead written] --> CO["DELETE consent:{orgId}:{roleId}"]
    OW[OutcomeBead written] --> MA["DELETE maintenance:{orgId}"]
    AW[AmendmentBead written] --> MA2["DELETE maintenance:{orgId}"]
```
