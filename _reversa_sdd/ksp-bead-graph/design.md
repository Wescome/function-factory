# Design — @factory/bead-graph (ksp-bead-graph)

> Reversa Writer · doc_level: completo · Generated 2026-06-10
> Source spec: SPEC-KSP-BEAD-GRAPH-001 (v1.0)
> Package: `packages/bead-graph/`

---

## 1. Package Structure

```
packages/bead-graph/
├── package.json                    # @factory/bead-graph; deps: zod, @cloudflare/workers-types
├── tsconfig.json                   # strict: true; target: ES2022; moduleResolution: bundler
├── bindings.ts                     # Env interface: KV_NAMESPACE, BEAD_GRAPH_DO
├── migrations/
│   └── v00_base.ts                 # SQL string for base bead graph schema
├── src/
│   ├── bead-id.ts                  # computeBeadId() — SHA-256 content-addressed identity
│   ├── schemas.ts                  # 8 Zod schemas + AnyBead discriminated union
│   ├── migrate.ts                  # migrate(storage, migrations[]) runner
│   ├── bead-queries.ts             # Pure SQL functions operating on SqlStorage
│   ├── do.ts                       # BeadGraphDOBase<Env> abstract class
│   ├── sdk.ts                      # KnowingStateSDK<P,T,E,O> implementation
│   └── worker.ts                   # CF Worker fetch handler
├── wrangler.jsonc                  # new_sqlite_classes, KV + DO bindings
└── tests/
    └── bead.test.ts                # computeBeadId determinism, writeBead idempotency,
                                    # retrieveKnowingState empty, writeExecutionBead guard,
                                    # autonomyFloor degradation
```

**Responsibility per file:**

| File | Responsibility |
|------|---------------|
| `bindings.ts` | TypeScript env interface consumed by `BeadGraphDOBase<Env>` and `worker.ts`. Declares `KV_NAMESPACE: KVNamespace` and `BEAD_GRAPH_DO: DurableObjectNamespace`. |
| `migrations/v00_base.ts` | Exports the base SQL string as a `Migration` object. Contains the CREATE TABLE, CREATE INDEX, and schema_history statements. No TypeScript logic. |
| `src/bead-id.ts` | Single exported function `computeBeadId`. No Cloudflare runtime dependency — pure Node.js `crypto`. Unit-testable in Vitest without a Worker runtime. |
| `src/schemas.ts` | All 8 Zod schemas (`BaseBead`, `PolicyBead`, `TrustBead`, `ExecutionBead`, `OutcomeBead`, `AmendmentBead`, `ConsentBead`, `EscalationBead`, `AuditBead`), supporting enums (`TrustStatus`, `OutcomeStatus`, `AmendmentStatus`), and the `AnyBead` discriminated union. All types inferred via `z.infer<>`. |
| `src/migrate.ts` | `Migration` interface + `migrate(storage, migrations[])` runner. Reads `schema_history`, applies pending migrations sequentially, records version. Called inside `blockConcurrencyWhile`. |
| `src/bead-queries.ts` | Six pure functions operating on `SqlStorage`. No class, no state. Each function is independently typecheckable and importable by `do.ts`. |
| `src/do.ts` | `BeadGraphDOBase<Env>` abstract class. Delegates all storage to `bead-queries.ts`. Exposes methods as async wrappers. Calls `migrate` on startup. Exposes `computeBeadId` as convenience method. |
| `src/sdk.ts` | `KnowingStateSDK<P,T,E,O>` concrete implementation. Manages the session state machine, KV cache reads/writes/invalidations, and DO RPC orchestration. Enforces I2 (`ksRetrievedAt` guard) and I4 (`autonomyFloor` degradation). |
| `src/worker.ts` | Minimal CF Worker fetch handler. Routes requests to the DO by stub. Exports `BeadGraphDOBase` subclass for the DO namespace binding. |
| `wrangler.jsonc` | Declares `new_sqlite_classes` to enable SQLite for DO subclasses. Wires KV namespace and DO binding. |
| `tests/bead.test.ts` | Vitest unit tests covering all five required test scenarios (see Tasks). |

---

## 2. Key Algorithms

### 2.1 Bead-ID Derivation (Content-Addressed Identity)

```typescript
import { createHash } from 'crypto';

export function computeBeadId(
  type: string,
  content: Record<string, unknown>,
  parentIds: string[]
): string {
  const canonical =
    type +
    JSON.stringify(content, Object.keys(content).sort()) +
    [...parentIds].sort().join('');
  return createHash('sha256').update(canonical).digest('hex');
}
```

Properties:
- **Determinism**: `JSON.stringify` with sorted keys produces a stable string for any given content
- **Parent-order independence**: `sort()` before `join('')` ensures parent order never affects the ID
- **Idempotency at storage layer**: `INSERT OR IGNORE` means a duplicate bead_id is silently skipped

### 2.2 `getCurrentTrustBead` Anti-Join Query

Finds the "head" TrustBead — the one that has no `supersedes`-typed edge pointing at it from a newer bead:

```sql
SELECT b.*
FROM beads b
WHERE b.org_id = ?
  AND b.type = 'trust'
  AND json_extract(b.content, '$.subject_id') = ?
  AND NOT EXISTS (
    SELECT 1 FROM bead_edges e
    WHERE e.parent_id = b.id AND e.rel = 'supersedes'
  )
ORDER BY b.ts DESC
LIMIT 1
```

The anti-join pattern is the canonical definition of "head" in an append-only DAG. No timestamp tricks; the structural property is authoritative.

### 2.3 `retrieveKnowingState` Composite Query

Three independent SQL reads, composed into a single return object:

```
1. Policy:
   - Filter: org_id = orgId AND type = 'policy' AND (scope = roleId OR scope = 'org')
   - Order: ts DESC LIMIT 1

2. Approved trust (with optional category filter):
   - Filter: org_id = orgId AND type = 'trust' AND status = 'APPROVED'
   - Anti-join: NOT EXISTS supersedes-child
   - Optional: AND json_extract(content, '$.subject_type') = category
   - Order: json_extract(content, '$.trust_score') DESC

3. Consent:
   - Filter: org_id = orgId AND type = 'consent' AND role_id = roleId AND status = 'ACTIVE'
   - Order: ts DESC LIMIT 1
```

This is the I2 retrieval call. On any failure (empty result set, DO unavailable), `autonomyFloor` is degraded to `SUGGEST` by the SDK layer.

### 2.4 Session State Machine (SDK Layer)

```
openSession()
    │
    ▼
session.autonomyFloor = 'EXECUTE_FULL'  (initial)
session.ksRetrievedAt = undefined
    │
    ├─ retrieveKnowingState() succeeds ──→ session.ksRetrievedAt = Date.now()
    │
    └─ retrieveKnowingState() throws  ──→ session.autonomyFloor = 'SUGGEST'
                                           session.ksRetrievedAt = undefined

writeExecutionBead()
    ├─ session.ksRetrievedAt undefined? ──→ throw SessionNotInitialized
    └─ session.autonomyFloor == 'SUGGEST'
       AND payload.autonomy_level != 'SUGGEST'? ──→ throw AutonomyDegradedError
```

### 2.5 Atomic Bead Write with AuditBead

```
writeBead(sql, bead, auditBead?):
  if bead.type != 'audit' AND !auditBead → throw Error(...)

  sql.exec('BEGIN')
  try:
    INSERT OR IGNORE INTO beads (...) VALUES (bead.*)
    for parentId of bead.parent_ids:
      INSERT OR IGNORE INTO bead_edges (bead.id, parentId, 'parent')
    if auditBead:
      INSERT OR IGNORE INTO beads (...) VALUES (auditBead.*)
      INSERT OR IGNORE INTO bead_edges (auditBead.id, bead.id, 'audits')
    sql.exec('COMMIT')
  catch e:
    sql.exec('ROLLBACK')
    throw e
```

### 2.6 KV Cache Read-Through Pattern (SDK Layer)

For `retrieveKnowingState(sessionId, category?)`:

```
1. Read session KV → extract orgId, roleId
2. Try KV read: ks:{orgId}:{roleId}:{category ?? '*'}
3. KV hit? → return cached { trustedSubjects, policy } merged with live consent
4. KV miss → call DO.retrieveKnowingState(orgId, roleId, category)
5. Write KV: ks:{orgId}:{roleId}:{category} with TTL 3600s
6. Return result
```

On write invalidation (`invalidateKV`):
- TrustBead write: delete `head:{orgId}:trust:{subjectId}`, delete `ks:{orgId}:*`
- PolicyBead write: delete `policy:{orgId}:{roleId}`, delete `ks:{orgId}:{roleId}:*`
- ConsentBead write: delete `consent:{orgId}:{roleId}`
- OutcomeBead or AmendmentBead write: delete `maintenance:{orgId}`

---

## 3. Cloudflare Primitives Used

| Primitive | Why |
|-----------|-----|
| **Durable Object (SQLite)** | Single-writer serialization (INV-KSP-003) for the bead graph. `ctx.storage.sql` provides `SqlStorage`. `blockConcurrencyWhile` ensures migrations complete before requests are served. |
| **CF KV** | Hot cache for knowing-state. KV's eventual consistency and eventual propagation is acceptable: the DO SQLite is authoritative; KV is only a latency optimization. TTL-based expiry handles staleness; explicit `delete()` handles invalidation on write. |
| **CF Workers** | Routing layer. The `worker.ts` file routes requests to the correct DO stub by `orgId`. The Worker namespace is used only for routing — no business logic lives in the Worker. |

---

## 4. Integration Points

### 4.1 What This Package Calls

| Dependency | Import | Notes |
|------------|--------|-------|
| `zod` | `src/schemas.ts` | Bead validation |
| `@cloudflare/workers-types` | `src/bead-queries.ts`, `src/do.ts`, `src/sdk.ts` | `SqlStorage`, `DurableObject`, `KVNamespace` types |
| `cloudflare:workers` | `src/do.ts` | `DurableObject` base class import |
| `node:crypto` | `src/bead-id.ts` | `createHash('sha256')` |

This package has **zero imports** of other `@factory/*` packages (ADR-KSP-005). It is a leaf in the KSP dependency graph.

### 4.2 What Calls This Package

| Consumer | Import path | What it uses |
|----------|-------------|--------------|
| `@factory/ksp-sdk` (Phase 2) | `@factory/bead-graph` | `KnowingStateSDK` interface, `Session`, `KnowingState`, `TrustEvaluation`, all Bead type defs |
| `@factory/loop-closure` (Phase 3) | `@factory/bead-graph` | `BeadGraphDOBase` (for DO RPC calls), `computeBeadId`, `AnyBead` types |
| `@factory/factory-graph` (Phase 4) | `@factory/bead-graph` | `BeadGraphDOBase` (extended by `FactoryBeadGraphDO`) |
| Domain instantiation packages | `@factory/bead-graph` | Extend `BeadGraphDOBase`, consume type definitions |

---

## 5. SQLite Schemas

### 5.1 Migration `v00_bead_graph_base`

```sql
CREATE TABLE beads (
  id          TEXT    PRIMARY KEY,            -- content hash (bead_id)
  org_id      TEXT    NOT NULL,
  type        TEXT    NOT NULL,
  content     TEXT    NOT NULL,               -- JSON, immutable after write
  written_by  TEXT    NOT NULL,               -- agent_id or user_id
  ts          INTEGER NOT NULL                -- epoch ms
);

CREATE TABLE bead_edges (
  child_id    TEXT    NOT NULL REFERENCES beads(id),
  parent_id   TEXT    NOT NULL REFERENCES beads(id),
  rel         TEXT    NOT NULL,
  -- rel values: 'parent' | 'supersedes' | 'audits' | 'escalates' | domain-specific
  PRIMARY KEY (child_id, parent_id, rel)
);

-- Base indexes
CREATE INDEX idx_beads_org_type ON beads(org_id, type);
CREATE INDEX idx_beads_org_ts   ON beads(org_id, ts DESC);
CREATE INDEX idx_edges_child    ON bead_edges(child_id);
CREATE INDEX idx_edges_parent   ON bead_edges(parent_id);

CREATE TABLE schema_history (
  version INTEGER PRIMARY KEY,
  name    TEXT    NOT NULL,
  applied INTEGER NOT NULL
);
```

**Immutability note:** No `UPDATE` or `DELETE` is ever issued against `beads`. The constraint is enforced at the SDK layer (no update methods), not at the SQLite layer. `INSERT OR IGNORE` provides idempotency for duplicate writes.

### 5.2 Domain Extension Pattern (Example: Commerce)

Domain instantiations add generated columns in their own migration. Example `v01_commerce_generated_columns`:

```sql
ALTER TABLE beads ADD COLUMN vendor_id TEXT
  GENERATED ALWAYS AS (json_extract(content, '$.vendor_id')) STORED;
ALTER TABLE beads ADD COLUMN role_id TEXT
  GENERATED ALWAYS AS (json_extract(content, '$.role_id')) STORED;

CREATE INDEX idx_beads_vendor ON beads(org_id, vendor_id)
  WHERE type = 'vendor_trust';
CREATE INDEX idx_beads_role_consent ON beads(org_id, role_id)
  WHERE type = 'consent';
```

The `migrations[]` array passed to `BeadGraphDOBase` constructor collects both the base migration and any domain migrations in version order.

---

## 6. Zod Schema Shapes

All 8 Bead schemas share `BaseBead` as their base and extend with a `type` literal and a `content` object:

```
BaseBead:
  bead_id:    string         -- content hash
  org_id:     string
  type:       string
  parent_ids: string[]       -- sorted; empty for root beads
  written_by: string
  ts:         number         -- epoch ms

PolicyBead (type: 'policy'):
  content.scope:        string
  content.rules:        Record<string, unknown>
  content.autonomy:     'SUGGEST'|'PROPOSE'|'EXECUTE_BOUNDED'|'EXECUTE_FULL'
  content.effective_at: string (ISO8601)
  content.expires_at:   string? (ISO8601)

TrustBead (type: 'trust'):
  content.subject_id:    string
  content.subject_type:  string
  content.status:        TrustStatus (PENDING|APPROVED|SUSPENDED|REVOKED)
  content.trust_score:   number (0..1)
  content.rationale:     string
  content.evidence_refs: string[]
  content.expiry:        string? (ISO8601)

ExecutionBead (type: 'execution'):
  content.subject_id:                    string
  content.action:                        string
  content.autonomy_level:                Autonomy
  content.trust_bead_id:                 string
  content.policy_bead_id:                string
  content.rationale:                     string
  content.artifact_graph_execution_id:   string? (loop closure bridge)

OutcomeBead (type: 'outcome'):
  content.execution_bead_id:             string
  content.status:                        OutcomeStatus (SUCCESS|PARTIAL|FAILURE|DISPUTED)
  content.summary:                       string
  content.metrics:                       Record<string, unknown>?
  content.triggers_amendment:            boolean
  content.artifact_graph_divergence_id:  string? (loop closure bridge)

AmendmentBead (type: 'amendment'):
  content.target_bead_id:                string
  content.target_type:                   'trust' | 'policy'
  content.proposed_change:               Record<string, unknown>
  content.rationale:                     string
  content.triggered_by:                  string
  content.status:                        AmendmentStatus (PENDING|APPROVED|REJECTED|SUPERSEDED)
  content.reviewed_by:                   string?
  content.reviewed_at:                   string?
  content.if_approved_produces:          string?
  content.artifact_graph_amendment_id:   string? (loop closure bridge)

ConsentBead (type: 'consent'):
  content.role_id:    string
  content.grants:     string[]
  content.status:     'ACTIVE' | 'REVOKED'
  content.granted_by: string
  content.granted_at: string (ISO8601)
  content.expires_at: string? (ISO8601)
  content.revokes:    string? (bead_id of superseded ConsentBead)

EscalationBead (type: 'escalation'):
  content.trigger_bead_id:    string
  content.reason:             string
  content.escalated_to:       string
  content.resolved_at:        string?
  content.resolution:         string?
  content.resolution_bead_id: string?

AuditBead (type: 'audit'):
  content.audited_bead_id: string
  content.audited_type:    string
  content.action:          'CREATE'|'SUPERSEDE'|'ESCALATE'|'CONSENT_GRANT'|'CONSENT_REVOKE'
  content.actor_id:        string
  content.session_id:      string
  content.ts:              number

AnyBead = discriminatedUnion('type', [PolicyBead, TrustBead, ExecutionBead, OutcomeBead,
                                       AmendmentBead, ConsentBead, EscalationBead, AuditBead])
```

---

## 7. KnowingStateSDK<P,T,E,O> Interface — Full Design

```typescript
// Type parameters:
//   P = PolicyContent   (domain-specific, e.g. ArchitecturePolicyBead content)
//   T = TrustContent    (domain-specific, e.g. DependencyTrustBead content)
//   E = ExecutionContent (domain-specific payload for writeExecutionBead)
//   O = OutcomeContent  (domain-specific payload for writeOutcomeBead)

export type Autonomy = 'SUGGEST' | 'PROPOSE' | 'EXECUTE_BOUNDED' | 'EXECUTE_FULL';

export interface Session {
  sessionId:      string;
  orgId:          string;
  roleId:         string;
  agentId:        string;
  autonomyFloor:  Autonomy;
  ksRetrievedAt?: number;   // epoch ms; undefined until retrieveKnowingState() succeeds
}

export interface KnowingState<TrustContent, PolicyContent> {
  policy:          PolicyContent | null;
  trustedSubjects: TrustContent[];
  consent:         { grants: string[] } | null;
  retrievedAt:     number;
}

export interface TrustEvaluation<TrustContent> {
  trusted:   boolean;
  trustBead: TrustContent | null;
  autonomy:  Autonomy;
}

export interface KnowingStateSDK<P, T, E, O> {
  openSession(orgId: string, roleId: string, agentId: string): Promise<Session>;
  closeSession(sessionId: string): Promise<void>;

  // I2 enforcement — MUST be called before writeExecutionBead
  // Throws if DO unavailable; sets autonomyFloor to SUGGEST on failure (I4)
  retrieveKnowingState(sessionId: string, category?: string): Promise<KnowingState<T, P>>;

  evaluateTrust(sessionId: string, subjectId: string): Promise<TrustEvaluation<T>>;

  // Throws SessionNotInitialized if ksRetrievedAt not set (INV-BG-003)
  // Throws AutonomyDegradedError if autonomyFloor = SUGGEST and payload requires higher (INV-BG-008)
  writeExecutionBead(sessionId: string, payload: E): Promise<string>;  // returns bead_id

  // May create a PENDING AmendmentBead if outcome.triggers_amendment === true (I3)
  writeOutcomeBead(
    sessionId: string,
    executionBeadId: string,
    outcome: O
  ): Promise<string>;  // returns bead_id

  getOpenAmendments(orgId: string): Promise<AmendmentBeadContent[]>;
  checkConsent(sessionId: string, action: string): Promise<boolean>;
}
```

The concrete implementation in `src/sdk.ts` accepts a `BeadGraphDO` RPC stub and a `KVNamespace` in its constructor.

---

## 8. Invariant Summary

| ID | Rule | Error thrown | Enforcement site |
|----|------|-------------|-----------------|
| INV-BG-001 | No UPDATE/DELETE on `beads` table | `BeadImmutabilityError` | SDK has no update methods; storage layer never issues UPDATE/DELETE |
| INV-BG-002 | `bead_id` verified by `computeBeadId` before every write | `BeadIntegrityError` | `sdk.ts` before every `writeBead` call |
| INV-BG-003 | `ksRetrievedAt` must be set before `writeExecutionBead` | `SessionNotInitialized` | `sdk.ts:writeExecutionBead()` guard |
| INV-BG-004 | Amendment approval writes new TrustBead + supersedes edge; original unmodified | — | `sdk.ts` — no update method exists |
| INV-BG-005 | ConsentBead revocation writes new Bead with `revokes` pointer | — | `sdk.ts` — `revokeConsent()` writes new Bead |
| INV-BG-006 | KV invalidated after every write affecting trust/policy/consent | — | `sdk.ts:invalidateKV()` called post-commit |
| INV-BG-007 | AuditBead required in same `BEGIN/COMMIT` block | `Error('writeBead: auditBead required...')` | `bead-queries.ts:writeBead()` guard |
| INV-BG-008 | Retrieval failure → `autonomyFloor = SUGGEST`; execution-level attempt → error | `AutonomyDegradedError` | `sdk.ts:retrieveKnowingState()` catch + `writeExecutionBead()` guard |
