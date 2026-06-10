# Flowchart: ksp-bead-graph (@factory/bead-graph)
> Source: SPEC-KSP-BEAD-GRAPH-001.md

---

## Main Call Flow — Session Lifecycle and Execution Write

```mermaid
sequenceDiagram
    participant Agent as Executing Agent
    participant SDK as KnowingStateSDK
    participant KV as Cloudflare KV
    participant DO as BeadGraphDO (Durable Object)
    participant SQL as DO SQLite

    %% ── Session Open ──────────────────────────────────────────────────
    Agent->>SDK: openSession(orgId, roleId, agentId)
    SDK->>KV: PUT session:{sessionId} { orgId, roleId, agentId, autonomyFloor: SUGGEST }
    SDK-->>Agent: Session { sessionId, autonomyFloor: SUGGEST }

    %% ── I2 Retrieval Enforcement ──────────────────────────────────────
    Agent->>SDK: retrieveKnowingState(sessionId, category?)
    SDK->>KV: GET ks:{orgId}:{roleId}:{category}
    alt Cache hit
        KV-->>SDK: { trustedSubjects, policy }
    else Cache miss
        SDK->>DO: RPC retrieveKnowingState(orgId, roleId, category?)
        DO->>SQL: SELECT policy (scope=roleId OR 'org', ts DESC LIMIT 1)
        DO->>SQL: SELECT trust (APPROVED, no supersedes-child, trust_score DESC)
        DO->>SQL: SELECT consent (ACTIVE, ts DESC LIMIT 1)
        SQL-->>DO: rows
        DO-->>SDK: { policy, trustedSubjects, consent }
        SDK->>KV: PUT ks:{orgId}:{roleId}:{category} TTL=1h
    end
    alt Retrieval fails (DO unavailable / empty trust)
        SDK->>KV: PATCH session:{sessionId} autonomyFloor=SUGGEST
        SDK-->>Agent: throws (I4 fail-closed)
    else Success
        SDK->>KV: PATCH session:{sessionId} ksRetrievedAt=now()
        SDK-->>Agent: KnowingState { policy, trustedSubjects, consent, retrievedAt }
    end

    %% ── Trust Evaluation ──────────────────────────────────────────────
    Agent->>SDK: evaluateTrust(sessionId, subjectId)
    SDK->>KV: GET head:{orgId}:trust:{subjectId}
    alt Cache hit
        KV-->>SDK: bead_id
        SDK->>DO: getBead(bead_id)
    else Cache miss
        SDK->>DO: getCurrentTrustBead(orgId, subjectId)
        DO->>SQL: SELECT trust WHERE subject_id=? AND NOT EXISTS supersedes-child ORDER BY ts DESC LIMIT 1
        SQL-->>DO: row
        DO-->>SDK: TrustBead
        SDK->>KV: PUT head:{orgId}:trust:{subjectId} (no TTL)
    end
    SDK-->>Agent: TrustEvaluation { trusted, trustBead, autonomy }

    %% ── Execution Write ───────────────────────────────────────────────
    Agent->>SDK: writeExecutionBead(sessionId, payload)
    SDK->>KV: GET session:{sessionId}
    KV-->>SDK: Session
    alt ksRetrievedAt not set
        SDK-->>Agent: throws SessionNotInitialized (INV-BG-003)
    else autonomyFloor = SUGGEST but execution attempted
        SDK-->>Agent: throws AutonomyDegradedError (INV-BG-008)
    else OK
        SDK->>SDK: computeBeadId('execution', content, parentIds) [SHA-256]
        SDK->>SDK: build AuditBead (action=CREATE)
        SDK->>DO: writeBead(executionBead, auditBead)
        DO->>SQL: BEGIN
        DO->>SQL: INSERT OR IGNORE INTO beads (executionBead)
        DO->>SQL: INSERT OR IGNORE INTO bead_edges (parent edges)
        DO->>SQL: INSERT OR IGNORE INTO beads (auditBead)
        DO->>SQL: INSERT OR IGNORE INTO bead_edges (audits edge)
        DO->>SQL: COMMIT
        SQL-->>DO: ok
        DO-->>SDK: void
        SDK->>KV: invalidateKV (ks:*, policy:* for org/role)
        SDK-->>Agent: bead_id (string)
    end

    %% ── Outcome Write + Amendment Trigger ────────────────────────────
    Agent->>SDK: writeOutcomeBead(sessionId, executionBeadId, outcome)
    SDK->>SDK: computeBeadId('outcome', content, parentIds)
    SDK->>SDK: build AuditBead (action=CREATE)
    SDK->>DO: writeBead(outcomeBead, auditBead)
    DO->>SQL: BEGIN → INSERT OR IGNORE beads + edges → COMMIT
    SQL-->>DO: ok
    SDK->>KV: invalidateKV maintenance:{orgId}
    alt outcome.triggers_amendment = true
        SDK->>SDK: build AmendmentBead (status=PENDING, triggered_by=outcomeBead.bead_id)
        SDK->>SDK: computeBeadId('amendment', content, parentIds)
        SDK->>SDK: build AuditBead for amendment
        SDK->>DO: writeBead(amendmentBead, auditBead)
        DO->>SQL: BEGIN → INSERT OR IGNORE → COMMIT
        SDK->>KV: invalidateKV maintenance:{orgId}
    end
    SDK-->>Agent: outcomeBead.bead_id

    %% ── Amendment Approval (governance path) ─────────────────────────
    Note over Agent,SQL: Amendment approval is a governance/human action
    Agent->>SDK: [approve amendment] write new TrustBead
    SDK->>SDK: computeBeadId('trust', newContent, [priorTrustBeadId])
    SDK->>SDK: build AuditBead (action=SUPERSEDE)
    SDK->>DO: writeBead(newTrustBead, auditBead)
    DO->>SQL: BEGIN
    DO->>SQL: INSERT OR IGNORE INTO beads (newTrustBead)
    DO->>SQL: INSERT OR IGNORE INTO bead_edges (child=newTrust, parent=priorTrust, rel='supersedes')
    DO->>SQL: INSERT OR IGNORE INTO beads (auditBead)
    DO->>SQL: COMMIT
    SDK->>KV: invalidateKV head:{orgId}:trust:{subjectId}, ks:*

    %% ── Session Close ─────────────────────────────────────────────────
    Agent->>SDK: closeSession(sessionId)
    SDK->>KV: DELETE session:{sessionId}
    SDK-->>Agent: void
```

---

## Bead Supersession Chain (Trust Amendment)

```mermaid
graph LR
    TB1["TrustBead v1\nbead_id: abc..."]
    TB2["TrustBead v2\nbead_id: def..."]
    AB["AmendmentBead\nstatus: APPROVED"]
    OB["OutcomeBead\ntriggers_amendment: true"]
    EB["ExecutionBead"]
    AuditTB1["AuditBead\naction: CREATE"]
    AuditTB2["AuditBead\naction: SUPERSEDE"]

    EB -->|parent| TB1
    EB -->|parent| OB
    OB -->|parent| EB
    AB -->|parent| OB
    AB -->|parent| TB1
    TB2 -->|supersedes| TB1
    TB2 -->|parent| AB
    AuditTB1 -->|audits| TB1
    AuditTB2 -->|audits| TB2
```

---

## KV Cache Invalidation Map

```mermaid
flowchart TD
    TW["TrustBead write"] -->|invalidates| H["head:{orgId}:trust:{subjectId}"]
    TW -->|invalidates| KS["ks:{orgId}:{roleId}:{category}"]
    PW["PolicyBead write"] -->|invalidates| POL["policy:{orgId}:{roleId}"]
    PW -->|invalidates| KS
    CW["ConsentBead write"] -->|invalidates| CON["consent:{orgId}:{roleId}"]
    OW["OutcomeBead write"] -->|invalidates| MAINT["maintenance:{orgId}"]
    AW["AmendmentBead write"] -->|invalidates| MAINT
```
