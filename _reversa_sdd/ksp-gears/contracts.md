# Contracts — @factory/gears

> Module: ksp-gears | Package: `@factory/gears`
> doc_level: completo | Generated: 2026-06-10
> Source: SPEC-FF-GEARS-001 §7

This file documents the HTTP fetch handler exposed by `CoordinatorDO`. These endpoints are not public — they are only reachable via `DurableObjectStub`. The `hook.ts` module is the only intended client.

---

## CoordinatorDO Fetch Handler

**Access**: `DurableObjectStub.fetch(request)` via `COORDINATOR_DO` namespace binding.
**Auth**: No external auth — DO is accessed only through the namespace binding (Worker-layer auth).
**Content-Type**: `application/json` for all request bodies and responses.

---

### POST /init

Initialize the DO with the run context. Must be called before any other endpoint on a new workflow invocation.

**Request body** (JSON tuple):
```typescript
[runId: string, orgId: string]
```

**Response**: `200 OK`
```json
null
```

**Idempotency**: Safe to call multiple times with the same arguments. Storage writes are unconditional (`put` overwrites).

**Side effects**:
- Sets `this.runId` and `this.orgId` in memory and DO storage
- Restores correctly after DO eviction via `blockConcurrencyWhile`

---

### POST /claim

Atomically claim a bead from `ready` to `in_progress`. Returns the claimed bead or `null` if not available (already claimed by another agent or does not exist).

**Request body** (JSON tuple):
```typescript
[beadId: string, agentId: string]
```

**Response**: `200 OK`
```typescript
ExecutionBead | null
```

**Atomicity**: Implemented via `UPDATE ... WHERE status='ready' RETURNING *`. Only one agent can claim a given bead; concurrent claims return `null` for all but the first.

**Side effect**: `attempt_count` is incremented on claim.

---

### POST /release

Mark a bead as successfully completed (`done`). Writes the audit log and wires the KSP loop closure.

**Request body** (JSON tuple):
```typescript
[beadId: string, agentId: string, result: string]
```
`result` is a JSON-serialized `ConductingAgentTraceFragment`.

**Response**: `200 OK`
```json
null
```

**Side effects** (in order):
1. `UPDATE execution_beads SET status='done', result=?`
2. `D1_AUDIT INSERT` with `verdict='done'`
3. `LoopClosureService.recordOutcome(...)` with `status: 'SUCCESS'` (only if `initRun` was called)

**Error**: If the bead does not exist or `assigned_to` does not match `agentId`, the UPDATE is a no-op. No error is returned to the caller.

---

### POST /fail

Mark a bead as failed. Writes the audit log and wires the KSP loop closure.

**Request body** (JSON tuple):
```typescript
[beadId: string, agentId: string, result: string]
```
`result` is a JSON-serialized `ConductingAgentTraceFragment` with failure detail.

**Response**: `200 OK`
```json
null
```

**Side effects** (in order):
1. `UPDATE execution_beads SET status='failed', result=?`
2. `D1_AUDIT INSERT` with `verdict='failed'`
3. `LoopClosureService.recordOutcome(...)` with `status: 'FAILURE'` (only if `initRun` was called)

---

### POST /next

Return the next available (dependency-satisfied) bead for a molecule.

**Request body** (JSON — molecule ID string):
```typescript
moleculeId: string
```

**Response**: `200 OK`
```typescript
ExecutionBead | null
```

Returns `null` if:
- All beads are in `in_progress`, `done`, or `failed` status
- Remaining `ready` beads have unsatisfied dependencies (parents not yet `done`)

**Dependency check**: A bead is eligible only if all its entries in `bead_edges` have parent beads in `done` status. The query uses `NOT EXISTS (SELECT 1 FROM bead_edges e JOIN execution_beads p ON p.id=e.parent_id WHERE e.child_id=b.id AND p.status != 'done')`.

---

## D1 bead_audit Table (Cross-Run Log)

Written by `CoordinatorDO.writeAudit()` via `D1_AUDIT` binding. This is not an HTTP endpoint — it is a D1 database table.

**Table**: `bead_audit` in `D1_AUDIT` binding (database name: `factory-bead-audit`)

**Schema**:
```sql
CREATE TABLE IF NOT EXISTS bead_audit (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id    TEXT    NOT NULL,
  bead_id   TEXT    NOT NULL,
  gear_id   TEXT    NOT NULL,
  agent_id  TEXT    NOT NULL,
  verdict   TEXT    NOT NULL,   -- 'done' | 'failed' | 'timed_out'
  attempt   INTEGER NOT NULL,
  ts        INTEGER NOT NULL    -- Unix milliseconds
);
```

**Written by**: `releaseBead()` (verdict=`done`) and `failBead()` (verdict=`failed`)

**Append-only**: No UPDATE or DELETE operations ever performed on this table.

**Auth requirements**: Only accessible via D1 binding inside the Cloudflare Worker — not exposed as an HTTP endpoint.

---

## Env Bindings Required at Runtime

| Binding | Type | Purpose |
|---------|------|---------|
| `D1_AUDIT` | `D1Database` | Cross-run bead audit log |
| `ARTIFACT_GRAPH` | `DurableObjectNamespace<FactoryArtifactGraphDO>` | KSP artifact graph DO |
| `BEAD_GRAPH` | `DurableObjectNamespace<FactoryBeadGraphDO>` | KSP bead graph DO |
| `KV` | `KVNamespace` | KSP hot cache for knowing-state |
| `ANTHROPIC_API_KEY` | `string` | Injected by Sandbox for `api.anthropic.com` |
| `OPENAI_API_KEY` | `string` | Injected by Sandbox for `api.openai.com` |
| `DEEPSEEK_API_KEY` | `string` | Injected by Sandbox for `api.deepseek.com` |
| `GITHUB_TOKEN` | `string` | Injected by Sandbox for `api.github.com` |

---

## Wrangler DO Key Pattern

DO instances are addressed by the deterministic key:
```
coordinator:{runId}
```
where `runId = SHA-256(workGraphId + workGraphVersion)`.

The DO name is stable across crashes and workflow retries. The same key resolves to the same DO instance throughout the lifetime of a WorkGraph execution.
