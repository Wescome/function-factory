# Requirements — @factory/bead-graph (ksp-bead-graph)

> Reversa Writer · doc_level: completo · Generated 2026-06-10
> Source spec: SPEC-KSP-BEAD-GRAPH-001 (v1.0, Implementation-ready)
> Package: `packages/bead-graph/` in the Function Factory monorepo
> Published scope: `@factory/bead-graph`

---

## 1. Context

`@factory/bead-graph` is the **domain-agnostic storage substrate for the Knowing-State Prosthesis (KSP)**. It holds the content that governs execution — what an executing agent is permitted to do, what trust state has been established, what outcomes have been recorded, and what amendments are pending.

This package is not the artifact graph (`@factory/artifact-graph`). The artifact graph holds the lineage of specifications and the trace of executions. The bead graph holds the knowing-state content that makes those executions lawful. The two layers are connected by `@factory/loop-closure` (SPEC-KSP-LOOP-CLOSURE-001).

**Position in KSP build order:** Phase 1 — no KSP package dependencies. Consumed by `@factory/ksp-sdk` (Phase 2) and `@factory/loop-closure` (Phase 3).

---

## 2. Functional Requirements

### FR-01: Eight Universal Bead Types
🟢 CONFIRMADO — SPEC-KSP-BEAD-GRAPH-001 §2

The package must define and validate all eight universal Bead types with Zod schemas. Five are structural types that domain instantiations map to domain names; three are universal supporting types present in every domain:

**Structural types (5):**

| Type | Zod literal | Domain examples |
|------|------------|-----------------|
| `PolicyBead` | `'policy'` | OrgPreferenceBead (Commerce), ProtocolBead (Clinical), ArchitecturePolicyBead (Factory) |
| `TrustBead` | `'trust'` | VendorTrustBead (Commerce), ClinicalGuidelineBead (Clinical), DependencyTrustBead (Factory) |
| `ExecutionBead` | `'execution'` | PurchaseBead (Commerce), ClinicalDecisionBead (Clinical), CommitBead (Factory) |
| `OutcomeBead` | `'outcome'` | OutcomeBead (Commerce), ClinicalOutcomeBead (Clinical), DeploymentOutcomeBead (Factory) |
| `AmendmentBead` | `'amendment'` | AmendmentBead (Commerce), ProtocolAmendmentBead (Clinical), ArchitectureAmendmentBead (Factory) |

**Supporting types (3):**

| Type | Zod literal | Purpose |
|------|------------|---------|
| `ConsentBead` | `'consent'` | Role-scoped permission grants; revocation via supersedes chain |
| `EscalationBead` | `'escalation'` | Records escalation from agent execution to human review |
| `AuditBead` | `'audit'` | Written in same transaction as every other Bead write (INV-BG-007) |

Domain instantiations MAY add additional types. They MUST NOT remove or rename the five structural types.

MoSCoW: **MUST**

---

### FR-02: Content-Addressed Bead Identity (`computeBeadId`)
🟢 CONFIRMADO — SPEC-KSP-BEAD-GRAPH-001 §3, INV-BG-002

The package must implement and export `computeBeadId(type, content, parentIds): string` using:

```
bead_id = SHA-256(type + canonical_json(content) + sorted_join(parent_ids))
```

Where:
- `canonical_json` = `JSON.stringify(content, Object.keys(content).sort())` — sorted keys, no whitespace
- `sorted_join` = `[...parentIds].sort().join('')` — alphabetically sorted hex strings, no separator
- Hash algorithm: `crypto.createHash('sha256').update(canonical).digest('hex')`

Two guarantees:
1. **Determinism**: same type + content + parents always yields the same ID, regardless of parent arrival order
2. **Idempotency**: `INSERT OR IGNORE` at the storage layer — writing the same Bead twice is a no-op

MoSCoW: **MUST**

---

### FR-03: SQLite Schema — Bead Graph Base Migration
🟢 CONFIRMADO — SPEC-KSP-BEAD-GRAPH-001 §4.1

The package must provide migration `v00_bead_graph_base` creating:

- Table `beads(id TEXT PK, org_id TEXT NOT NULL, type TEXT NOT NULL, content TEXT NOT NULL, written_by TEXT NOT NULL, ts INTEGER NOT NULL)` — content is immutable JSON
- Table `bead_edges(child_id TEXT, parent_id TEXT, rel TEXT, PRIMARY KEY(child_id, parent_id, rel))` with FK references to `beads(id)`
- Table `schema_history(version INTEGER PK, name TEXT NOT NULL, applied INTEGER NOT NULL)`
- Base indexes: `idx_beads_org_type`, `idx_beads_org_ts`, `idx_edges_child`, `idx_edges_parent`
- `rel` values: `'parent' | 'supersedes' | 'audits' | 'escalates'` plus domain-specific

Domain instantiations add generated columns in their own migration (e.g., `v01_commerce_generated_columns`).

MoSCoW: **MUST**

---

### FR-04: Migration Runner (`migrate.ts`)
🟢 CONFIRMADO — SPEC-KSP-BEAD-GRAPH-001 §9 (constructor pattern)

The package must provide a `migrate(storage: DurableObjectStorage, migrations: Migration[])` function that:
- Reads `schema_history` to determine current version
- Applies pending migrations in sequence
- Records each applied migration in `schema_history`
- Is safe to call on every DO construction (idempotent)

MoSCoW: **MUST**

---

### FR-05: Atomic Bead Write with Mandatory AuditBead (`writeBead`)
🟢 CONFIRMADO — SPEC-KSP-BEAD-GRAPH-001 §6, INV-BG-007

The storage layer must implement `writeBead(sql, bead, auditBead?)`:
- For non-audit types: throws `Error('writeBead: auditBead required for type=...')` if `auditBead` is absent
- Executes `BEGIN` → INSERT bead → INSERT parent edges → INSERT auditBead → INSERT audit edge (`audits` rel) → `COMMIT`
- On any failure: executes `ROLLBACK` and re-throws
- Uses `INSERT OR IGNORE` for idempotency on duplicate bead_id
- The AuditBead itself does not require an auditBead parameter

MoSCoW: **MUST**

---

### FR-06: Bead Read Operations (`bead-queries.ts`)
🟢 CONFIRMADO — SPEC-KSP-BEAD-GRAPH-001 §6

The package must implement the following read functions, each operating on `SqlStorage`:

| Function | Returns | Notes |
|----------|---------|-------|
| `getBead(sql, beadId)` | `(BaseBead & { content }) \| null` | Reconstitutes `parent_ids` from `bead_edges` on demand |
| `getCurrentTrustBead(sql, orgId, subjectId)` | `(BaseBead & { content }) \| null` | Head TrustBead — no supersedes-child; tie-break `ts DESC LIMIT 1` |
| `getActiveConsent(sql, orgId, roleId)` | `(BaseBead & { content }) \| null` | `status = 'ACTIVE'`, most recent |
| `getTrustLineage(sql, orgId, subjectId)` | `(BaseBead & { content })[]` | trust + outcome + amendment beads in `ts ASC` order |
| `getOpenAmendments(sql, orgId)` | `(BaseBead & { content })[]` | `status = 'PENDING'`, `ts DESC` |
| `retrieveKnowingState(sql, orgId, roleId, category?)` | `{ policy, trustedSubjects, consent }` | I2 composite retrieval — three independent queries |

MoSCoW: **MUST**

---

### FR-07: I2 Retrieval Enforcement (`retrieveKnowingState`)
🟢 CONFIRMADO — SPEC-KSP-BEAD-GRAPH-001 §6, §8, INV-BG-003

`retrieveKnowingState` must return three components in a single call:
1. **Policy**: most recent bead where `scope = roleId OR scope = 'org'`, ordered `ts DESC LIMIT 1`
2. **Approved trust**: anti-join (no supersedes-child pointed at it) + `status = 'APPROVED'`; optional `subject_type` filter; sorted by `trust_score DESC`
3. **Consent**: `status = 'ACTIVE'` + most recent for role

This is the I2 enforcement entry point. Called at session open before any execution.

MoSCoW: **MUST**

---

### FR-08: `BeadGraphDOBase` Abstract Class (`do.ts`)
🟢 CONFIRMADO — SPEC-KSP-BEAD-GRAPH-001 §9

The package must export an abstract class `BeadGraphDOBase<Env>` extending `DurableObject<Env>` that:
- Accepts `migrations: Migration[]` in its constructor
- Calls `ctx.blockConcurrencyWhile(() => migrate(ctx.storage, migrations))` on startup
- Exposes all `bead-queries.ts` functions as async instance methods
- Exposes `computeBeadId(type, content, parentIds): string` as an instance method (so SDK avoids separate import)
- Is abstract — domain instantiations extend it and pass their migrations

MoSCoW: **MUST**

---

### FR-09: `KnowingStateSDK<P,T,E,O>` Interface (`sdk.ts`)
🟢 CONFIRMADO — SPEC-KSP-BEAD-GRAPH-001 §8

The package must export the `KnowingStateSDK<PolicyContent, TrustContent, ExecutionContent, OutcomeContent>` interface and its concrete implementation. The interface covers:

| Method | Signature | Invariant |
|--------|-----------|-----------|
| `openSession` | `(orgId, roleId, agentId) → Promise<Session>` | Creates KV `session:{sessionId}`; sets `autonomyFloor` |
| `closeSession` | `(sessionId) → Promise<void>` | Removes KV session entry |
| `retrieveKnowingState` | `(sessionId, category?) → Promise<KnowingState<T,P>>` | MUST be called before `writeExecutionBead` (INV-BG-003) |
| `evaluateTrust` | `(sessionId, subjectId) → Promise<TrustEvaluation<T>>` | Returns `{ trusted, trustBead, autonomy }` |
| `writeExecutionBead` | `(sessionId, payload: E) → Promise<string>` | Asserts `session.ksRetrievedAt` set; throws `SessionNotInitialized` if not |
| `writeOutcomeBead` | `(sessionId, executionBeadId, outcome: O) → Promise<string>` | May trigger AmendmentBead if `triggers_amendment = true` |
| `getOpenAmendments` | `(orgId) → Promise<AmendmentBeadContent[]>` | Returns PENDING amendments |
| `checkConsent` | `(sessionId, action) → Promise<boolean>` | Checks active ConsentBead for session's role |

MoSCoW: **MUST**

---

### FR-10: KV Hot Cache Layer
🟢 CONFIRMADO — SPEC-KSP-BEAD-GRAPH-001 §7, INV-BG-006

The SDK implementation must maintain a KV hot cache with the following key patterns, TTLs, and invalidation triggers. KV is never authoritative — DO SQLite is always the source of truth.

| Key pattern | Value | TTL | Invalidated by |
|-------------|-------|-----|----------------|
| `ks:{orgId}:{roleId}:{category}` | `{ trustedSubjects, policy }` | 1 hour | TrustBead or PolicyBead write for org/role/category |
| `head:{orgId}:trust:{subjectId}` | bead_id string | None | TrustBead write for org/subject |
| `consent:{orgId}:{roleId}` | `{ grants: string[] }` | 15 min | ConsentBead write for org/role |
| `policy:{orgId}:{roleId}` | PolicyBead content (JSON) | 1 hour | PolicyBead write for org/role |
| `session:{sessionId}` | `{ orgId, roleId, agentId, ksRetrievedAt, autonomyFloor }` | 24 hours | Session expiry |
| `maintenance:{orgId}` | `{ lastOutcomeAt, pendingAmendments, score }` | 6 hours | OutcomeBead or AmendmentBead write |

INV-BG-006: `invalidateKV()` must be called after every `writeBead()` commit for any Bead type that affects trust, policy, or consent.

MoSCoW: **MUST**

---

### FR-11: Fail-Closed Autonomy Degradation (I4)
🟢 CONFIRMADO — SPEC-KSP-BEAD-GRAPH-001 INV-BG-008, §1

When `retrieveKnowingState()` fails (DO unavailable, consent missing, empty trust set), the SDK must:
1. Set `session.autonomyFloor = 'SUGGEST'` in the KV session entry
2. On any subsequent `writeExecutionBead()` call with execution-level autonomy while floor is `SUGGEST`: throw `AutonomyDegradedError`

No execution proceeds without a successful prior retrieval.

MoSCoW: **MUST**

---

### FR-12: Worker and Bindings Scaffold (`worker.ts`, `bindings.ts`, `wrangler.jsonc`)
🟢 CONFIRMADO — SPEC-KSP-BEAD-GRAPH-001 §11 steps 9–10

The package must provide:
- `bindings.ts`: TypeScript environment interface declaring `KV_NAMESPACE`, `BEAD_GRAPH_DO` bindings
- `src/worker.ts`: minimal CF Worker fetch handler routing requests to the DO
- `wrangler.jsonc`: Worker config with `new_sqlite_classes` enabling SQLite for `BeadGraphDOBase` subclasses

MoSCoW: **MUST**

---

### FR-13: Append-Only Invariant Enforcement (INV-BG-001)
🟢 CONFIRMADO — SPEC-KSP-BEAD-GRAPH-001 INV-BG-001

No UPDATE or DELETE on the `beads` table is ever performed. The SDK has no update methods. Any attempt to modify an existing Bead throws `BeadImmutabilityError`. Supersession is implemented by writing a new Bead with a `supersedes` edge — the original Bead is never modified.

MoSCoW: **MUST**

---

### FR-14: Loop Closure Bridge Fields (Optional, Storage-Valid Without)
🟢 CONFIRMADO — SPEC-KSP-BEAD-GRAPH-001 §11, SPEC-KSP-LOOP-CLOSURE-001

Three Bead types include optional bridge fields that carry cross-layer references to the artifact graph. These fields are optional at the storage layer — all eight invariants hold regardless of whether bridge fields are present.

| Field | Bead type | Links to |
|-------|-----------|----------|
| `artifact_graph_execution_id` | `ExecutionBead` | Artifact Graph `Execution` node |
| `artifact_graph_divergence_id` | `OutcomeBead` | Artifact Graph `Divergence` node |
| `artifact_graph_amendment_id` | `AmendmentBead` | Artifact Graph `Amendment` node |

MoSCoW: **SHOULD** (written by loop-closure service; bead-graph package exposes the field definitions)

---

## 3. Non-Functional Requirements

### NFR-01: Performance — KV Cache Response
🟢 CONFIRMADO (inferred from KV TTL patterns, SPEC-KSP-BEAD-GRAPH-001 §7)

`retrieveKnowingState()` on a warm session (KV hit) must return within the KV read latency (~5ms). Cold path (KV miss → DO SQLite query) should return within 50ms under normal DO load. KV TTL values are chosen to balance freshness against cold-path pressure.

---

### NFR-02: Availability — Fail-Closed Behavior
🟢 CONFIRMADO — SPEC-KSP-BEAD-GRAPH-001 INV-BG-008

When the `BeadGraphDO` is unavailable, the system must degrade gracefully: `autonomyFloor` falls to `SUGGEST`, not to an error state. The agent may continue in suggestion mode. No data is corrupted during degradation.

---

### NFR-03: Durability — Single-Writer Serialization
🟢 CONFIRMADO — ADR-KSP-002, INV-KSP-003

One DO instance per org. All writes are serialized by Cloudflare's single-writer DO guarantee. No two concurrent write operations can corrupt the bead graph. Direct SQLite access from Workers (bypassing the DO) is prohibited.

---

### NFR-04: Storage Capacity
🟡 INFERRED — Cloudflare DO SQLite limit

Each `BeadGraphDO` instance is bounded by the Cloudflare DO SQLite limit (10 GB per DO). Bead content is JSON text; AuditBead doubles storage consumption per business bead. Estimate: 1 KB per bead pair → ~10M bead pairs per org DO. Within expected lifecycle for any single org.

---

### NFR-05: Correctness — Zero Type Errors
🟢 CONFIRMADO — SPEC-KSP-BEAD-GRAPH-001 §11

`tsc --noEmit` must produce zero errors at every implementation step. This is the gate condition for every task in the implementation sequence.

---

### NFR-06: Testability — Deterministic Identity
🟢 CONFIRMADO — SPEC-KSP-BEAD-GRAPH-001 §11 step 2

`computeBeadId()` must be unit-testable with no Cloudflare runtime dependency. Its determinism and parent-order independence must be verified before any storage code is written.

---

### NFR-07: Package Isolation — No Factory-Specific Imports
🟢 CONFIRMADO — ADR-KSP-005

`@factory/bead-graph` must have zero imports of Factory-domain packages (`@factory/factory-graph`, `@factory/gears`, etc.). It exports generic types only. Domain instantiations extend `BeadGraphDOBase`; they are not imported by the base package. This is the isolation that allows ComeFlow and CareTrace to consume the same package.

---

## 4. Acceptance Criteria

### AC-01: Happy Path — Session-Gated Execution Write
**Given** an org has at least one APPROVED TrustBead and one PolicyBead in the bead graph  
**When** an SDK caller executes:
```
session = await sdk.openSession(orgId, roleId, agentId)
ks      = await sdk.retrieveKnowingState(session.sessionId)
beadId  = await sdk.writeExecutionBead(session.sessionId, payload)
```
**Then**:
- `ks.policy` is non-null
- `ks.trustedSubjects` contains the APPROVED TrustBead
- `beadId` is the SHA-256 content hash of the execution bead
- `beads` table contains two new rows: the ExecutionBead + its AuditBead
- `bead_edges` contains `(auditBead.id, executionBead.id, 'audits')`
- `session:{session.sessionId}` KV entry has `ksRetrievedAt` set

---

### AC-02: Failure Path — Execution Without Prior Retrieval
**Given** a session has been opened but `retrieveKnowingState()` has NOT been called  
**When** the SDK caller calls `writeExecutionBead(sessionId, payload)`  
**Then**:
- The call throws `SessionNotInitialized`
- No rows are inserted into the `beads` table
- The KV session entry is unchanged

---

### AC-03: Happy Path — Duplicate Bead Write is Idempotent
**Given** a Bead with a specific bead_id already exists in the `beads` table  
**When** `writeBead(sql, sameBead, sameAuditBead)` is called again  
**Then**:
- No error is thrown
- The `beads` table row count does not increase
- The existing bead content is unchanged (INV-BG-001)

---

### AC-04: Failure Path — Missing AuditBead Throws
**Given** a non-audit Bead is constructed  
**When** `writeBead(sql, bead)` is called without an `auditBead` argument  
**Then**:
- The call throws `Error('writeBead: auditBead required for type=...')`
- `ROLLBACK` is issued (no partial commit)
- The `beads` table is unchanged

---

### AC-05: Happy Path — retrieveKnowingState Composite Return
**Given** an org has: PolicyBead(scope='org'), two APPROVED TrustBeads, one ACTIVE ConsentBead  
**When** `retrieveKnowingState(sql, orgId, roleId)` is called  
**Then**:
- Returns `{ policy: PolicyBead, trustedSubjects: [TrustBead, TrustBead], consent: ConsentBead }`
- `trustedSubjects` is ordered by `trust_score DESC`
- Superseded TrustBeads (those with a `supersedes`-typed incoming edge) are excluded

---

### AC-06: Failure Path — Autonomy Degradation on Retrieval Failure
**Given** the `BeadGraphDO` is unavailable (simulated by an empty trust set + no policy)  
**When** `sdk.retrieveKnowingState(sessionId)` is called and returns `{ policy: null, trustedSubjects: [] }`  
**Then**:
- `session.autonomyFloor` in KV is set to `'SUGGEST'`
- A subsequent `writeExecutionBead()` with `autonomy_level = 'EXECUTE_FULL'` throws `AutonomyDegradedError`

---

## 5. MoSCoW Summary

| Requirement | Priority | Rationale |
|-------------|----------|-----------|
| FR-01: Eight Bead types | MUST | Type system foundation; all other FRs depend on it |
| FR-02: `computeBeadId` | MUST | Identity backbone; required before any storage write |
| FR-03: SQLite base migration | MUST | Storage substrate; no data persistence without it |
| FR-04: Migration runner | MUST | DO startup safety; prevents uninitialized schema |
| FR-05: Atomic write + AuditBead | MUST | INV-BG-007 is non-negotiable; AuditBead in every tx |
| FR-06: Read operations | MUST | SDK retrieval cannot function without these |
| FR-07: I2 composite retrieval | MUST | Prosthesis invariant I2; core SDK contract |
| FR-08: `BeadGraphDOBase` | MUST | Extension point for all domain instantiations |
| FR-09: `KnowingStateSDK<P,T,E,O>` | MUST | Primary consumer-facing API |
| FR-10: KV hot cache | MUST | INV-BG-006 mandates invalidation; performance NFR-01 |
| FR-11: Fail-closed I4 | MUST | Prosthesis invariant I4; autonomy floor non-negotiable |
| FR-12: Worker scaffold | MUST | Deployment; `wrangler dev` gate required |
| FR-13: Append-only enforcement | MUST | INV-BG-001; data integrity invariant |
| FR-14: Loop closure bridge fields | SHOULD | Written by loop-closure; optional at storage layer |
