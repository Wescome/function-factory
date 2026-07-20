# Contracts — ksp-flue-workflow (.flue/workflows/atom-execution.ts)

> Module: `.flue/workflows/atom-execution.ts` + `CoordinatorDO` fetch handler
> Source spec: SPEC-FF-JUSTBASH-001-004, SPEC-FF-GEARS-001 §7b
> doc_level: completo | Generated: 2026-06-10
> Package naming: `@factory/*` (former `@koales/*`)

---

## 1. Flue Workflow Entry Point

### POST /workflows/atom-execution

**Description:** Triggers atom execution. Replaces the retired `POST /execute` endpoint on the Conducting Agent CF Worker.

**Caller:** Mediation Agent DO hook, or any orchestrator that previously called the Conducting Agent CF Worker `/execute`.

**Auth:** Caller must be a Cloudflare service binding or authenticated Worker — no external public access. Auth enforcement is at the Cloudflare platform boundary, not in the workflow itself.

**Request body:** `AtomExecutionPayload`

```typescript
interface AtomExecutionPayload {
  repoId:           string   // Repository / org identifier
  agentId:          string   // Agent identifier for audit trail
  workGraphId:      string   // WorkGraph identifier
  workGraphVersion: string   // WorkGraph version (used in deterministic DO key derivation)
  moleculeId:       string   // Molecule identifier for bead selection
}
```

**Response body (success):**

```typescript
// Bead was available and executed (regardless of outcome)
{ status: 'executed', outcome: 'success' | 'failure' | 'timeout' }

// No ready bead — all beads for this molecule are done
{ status: 'complete' }

// Bead found but AtomDirective parse failed
{ status: 'error', reason: 'invalid-directive' }
```

**Invariants:**
- `POST /init` on CoordinatorDO is called before `getNextReady()` on every invocation. (BR-KSP-16)
- On any parse error, `failHook()` is called and the bead is transitioned to `failed`. The workflow does NOT leave a bead in `in_progress`.
- On any execution outcome (`success | failure | timeout`), either `releaseHook()` (success) or `failHook()` (non-success) is called before the workflow returns.

---

## 2. CoordinatorDO Fetch Handler Routes

The `CoordinatorDO` is a Durable Object with a `fetch()` handler. These routes are called via `DurableObjectStub.fetch()` from `@factory/gears/beads/hook.ts` wrappers. They are NOT public HTTP routes.

**Caller:** `atom-execution.ts` (directly for `/init`) and `@factory/gears/beads/hook.ts` wrappers (for all other routes).

**Auth:** Durable Object fetch calls are internal to the Cloudflare runtime — no external access.

---

### POST /init

**Description:** Initializes run context on the DO. Sets `runId` and `orgId` as instance properties and persists to DO storage. Idempotent — safe to call on every workflow invocation.

**Called by:** `atom-execution.ts run()` directly, before `getNextReady()`.

**Request body:** JSON array `[runId: string, orgId: string]`

```typescript
body = JSON.stringify([runId, repoId])
```

**Response:** `200 OK` (empty body on success).

**Invariant:** Must be called before `/next`, `/claim`, `/release`, or `/fail`. `writeAudit()` and `recordOutcome()` throw if called before `/init`.

---

### POST /next

**Description:** Returns the next ready bead for a given moleculeId — a bead with `status='ready'` and no unfinished parent beads.

**Called by:** `getNextReady()` in `hook.ts`.

**Request body:**
```typescript
{ moleculeId: string }
```

**Response:**
```typescript
// Bead available:
ExecutionBead   // { id, moleculeId, status: 'ready', payload, ... }

// No ready bead:
null
```

---

### POST /claim

**Description:** Atomic compare-and-swap on a bead: `status='ready' → status='in_progress'`. Increments `attempt_count`. Returns the claimed bead or null if the bead is not claimable (already claimed or does not exist).

**Called by:** `claimHook()` in `hook.ts`.

**Request body:**
```typescript
{ beadId: string, agentId: string }
```

**Response:**
```typescript
ExecutionBead | null
```

---

### POST /release

**Description:** Marks a bead as `done`. Writes D1 audit row via `writeAudit()`. Wires `LoopClosureService.recordOutcome()` (Bridge Point 3) to write `BuildOutcomeBead` and `ExecutionTrace`.

**Called by:** `releaseHook()` in `hook.ts`.

**Request body:**
```typescript
{ beadId: string, agentId: string, result: string }
// result = JSON.stringify(ConductingAgentTraceFragment)
```

**Response:** `200 OK` (empty body).

**Side effects:**
1. SQL UPDATE `beads` SET `status='done'`
2. `writeAudit()` → D1 `bead_audit` INSERT
3. `recordOutcome()` → `LoopClosureService` → `BuildOutcomeBead` + `ExecutionTrace` (Phase 3+ only)

---

### POST /fail

**Description:** Marks a bead as `failed`. Writes D1 audit row. Wires `LoopClosureService.recordOutcome()` with verdict `'failed'`. On failure, also writes a `Divergence` node to the artifact graph.

**Called by:** `failHook()` in `hook.ts`.

**Request body:**
```typescript
{ beadId: string, agentId: string, result: string }
// result = JSON.stringify({ error, issues? } | ConductingAgentTraceFragment)
```

**Response:** `200 OK` (empty body).

**Side effects:** Same as `/release` but with `status='failed'` and divergence recording.

---

## 3. AtomDirective Schema Contract

The `AtomDirective` Zod schema (in `packages/schemas/src/atom-directive.ts`) is the contract between the Mediation Agent (producer) and `atom-execution.ts` (consumer). The two new fields added by SPEC-FF-JUSTBASH-001 are part of this contract:

| Field | Type | Populated by | Consumed by |
|-------|------|-------------|-------------|
| `skillRef` | `string` (min 1) | Mediation Agent compile step from `Gear.skillRef` | `session.skill(directive.skillRef, ...)` |
| `role` | `'planner' \| 'coder' \| 'critic' \| 'tester' \| 'verifier'` | Mediation Agent compile step from `Gear.role` | `PROFILE_BY_ROLE[directive.role]` |

**Invariant:** If `skillRef` or `role` is missing from the bead payload, `AtomDirective.safeParse()` returns `{ success: false }` and the bead is immediately failed via `failHook()`. No execution is attempted on an invalid directive.

---

## 4. ConductingAgentTraceFragment — Bead Result Contract

The `ConductingAgentTraceFragment` is the JSON payload written to `releaseHook()` / `failHook()` as the bead result. It is also the input to `recordOutcome()` in CoordinatorDO.

```typescript
interface ConductingAgentTraceFragment {
  executionId:      string    // `${beadId}-attempt-${attempt}`
  directiveId:      string
  atomRef:          string
  workGraphVersion: string
  repoId:           string
  outcome:          'success' | 'failure' | 'timeout'
  rawOutput:        string    // stdout truncated to 4096 chars
  sandboxOutputRef: string | undefined  // `r2://sandbox-output/{directiveId}/{ts}.txt`
  durationMs:       number
  attemptNumber:    number
  producedAt:       string    // ISO 8601
}
```

---

## 5. Migration from Old Conducting Agent CF Worker

| Old | New |
|-----|-----|
| `POST /execute` on Conducting Agent CF Worker | `POST /workflows/atom-execution` on Flue workflow |
| `GAS_CITY_SUPERVISOR_URL` env var | Not needed — replaced by `COORDINATOR_DO` binding |
| `deriveRole(skillRef)` heuristic | `directive.role` field (from Gear.role at compile time) |
| `@factory/harness-bridge` import | `@flue/runtime` direct import |
| `@factory/runtime` stub import | `@flue/runtime` direct import |

Callers that used to call `POST /execute` on the Conducting Agent Worker must be updated to call `POST /workflows/atom-execution` with the `AtomExecutionPayload` shape. The payload is a subset of the old execute request — `repoId`, `agentId`, `workGraphId`, `workGraphVersion`, and `moleculeId` are the only required fields.
