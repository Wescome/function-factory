# SPEC-FF-CA-ALARM-001 — CommissioningAgent Alarm-Driven Compiler Pass

**Status:** Proposed
**Date:** 2026-06-17
**Layer:** I-layer
**Supersedes:** the Mastra workflow lifecycle mechanics of SPEC-FF-CA-REWRITE-001
**Reinstates:** the DO-owned 202-accept + alarm + poll decision of SPEC-FF-CA-ASYNC-001
**Decision class:** Architecture (orchestrator removal; durability mechanism)

---

## JTBD

When a CommissioningSignal arrives at the CA DO, I want the DO to accept in <1s and process the full
compiler pass chain durably via DO alarm, so I can poll for terminal status without blocking on LLM
latency or losing the in-flight chain to DO eviction.

---

## Why this supersedes the Mastra workflow

`ca-compiler-workflow.ts` (Mastra `createWorkflow`) is the orchestrator. It is deleted. Reasons:

1. **Durability is already a DO primitive.** Mastra's `@mastra/cloudflare-d1` persistence duplicates
   what `ctx.storage` + `alarm()` give natively. Two persistence layers, one of them load-bearing for
   eviction recovery, is a liability.
2. **`run.start()` under `waitUntil` re-introduces the blocking it was meant to remove.** The current
   `index.ts` pins the DO invocation to the full LLM chain via `this.doCtx.waitUntil(run.start(...))`.
   That is the SPEC-FF-CA-ASYNC-001 anti-pattern wearing a workflow costume.
3. **The pass chain is a fixed 6-call sequence with no branching.** A workflow engine buys nothing here
   that a `for`-style sequence of pure functions in `alarm()` does not.

The pure step functions (`workflow/steps/*.ts`) are **kept verbatim**. They take `(input, agent)` /
`(input, signal, agent)` and return validated artifacts. The alarm calls them directly.

---

## Invariants

Inherited from SPEC-FF-CA-REWRITE-001, with two amended (see that spec's AMENDMENT header).

- **CA-INV-001 (AMENDED)** — The DO owns the async processing loop. It uses `alarm()` for durable
  continuation per SPEC-FF-CA-ASYNC-001. The prior prohibition on an alarm handler is revoked. The DO
  still owns no Mastra workflow engine and no `Think` LLM loop.
- **CA-INV-002** — Each compiler pass is a discrete pure function with a schema-validated input and a
  schema-validated output. Unchanged: the step functions are kept verbatim.
- **CA-INV-003** — Pass N does not run until Pass N-1 has produced a valid artifact and written it to
  ArtifactGraphDO. Enforced by sequential `await` in `alarm()`; a thrown `WorkflowStepError` halts the
  chain.
- **CA-INV-004** — All artifacts are written to ArtifactGraphDO via DO stub RPC. No ArangoDB.
- **CA-INV-005** — All LLM calls go through `buildPlannerAgent` from `@factory/gears`. No raw
  `generateText`, no `buildConductingAgent`.
- **CA-INV-006** — No skill registry, no vertical routing, no `domainProfile`.
- **CA-INV-007 (AMENDED)** — Human approval suspension is a SQLite `status='suspended-approval'` state,
  not `workflow.suspend()`. Resume is a re-queue + re-arm, not `run.resume()`.
- **CA-INV-008** — Compiler structural passes run in MediationAgentDO. The CA emits an IS-* and hands
  off; it never calls `packages/compiler` directly.

---

## Storage Contract

Aligned with **SPEC-FF-GRAPH-001** (`@factory/graph`). The CA's governance-node writes obey its invariants.

- **ArtifactGraphDO is the governance node store, via `EdgeWriter` (§4.2).** Every compiler-pass artifact
  (PRS-*, BC-*, FP-*, IS-*) and its provenance edge is written through `appendNode(GovernanceNode)` /
  `appendLineageEdge(LineageEdge)`, never via ad-hoc DO methods.
- **Writes are append-only (INV-G4).** `EdgeWriter` exposes only inserts — no `upsertNode`/`upsertEdge`/
  `updateNode`/`deleteNode`. The constraint is structural (the TypeScript type). Idempotency comes from
  content-addressed ids (§8.4): re-appending an identical node is a no-op, making restart safe.
- **The concrete `EdgeWriter` lives in the CA package, not in `@factory/graph` (INV-G2).** `@factory/graph`
  owns no storage and imports no CF bindings. The CA provides `CaGraphWriter` (`src/graph-writer.ts`),
  wrapping the ArtifactGraphDO stub and implementing the append RPCs.
- **No recursive SQL (INV-G1); no ArangoDB (INV-G5).** Future provenance traversal runs in-memory via
  `buildDAG` + `reachableFrom` over a flat `loadLineageEdges` SELECT — no recursive CTE. State is
  Cloudflare-native (DO SQLite); INV-G5 already follows from CA-INV-004 — no `arangojs`/AQL in the CA.

---

## Sessions SQLite DDL

Single table, DO-local (`ctx.storage.sql`). `runId` is **dropped** — it was the Mastra workflow run
handle, and with Mastra removed there is no run to rehydrate. `sessionId` is the only durable key.

```sql
CREATE TABLE IF NOT EXISTS sessions (
  sessionId    TEXT PRIMARY KEY,
  orgId        TEXT NOT NULL,
  repoId       TEXT NOT NULL,
  status       TEXT NOT NULL,          -- queued | commissioning | suspended-approval | idle | failed
  signal_json  TEXT NOT NULL,          -- full CommissioningSignal, replayable by the alarm
  isNodeId     TEXT,                    -- IS-* id, set after compile-prd
  result_json  TEXT,                    -- emit-to-mediation result { runId, atomCount } on success
  error        TEXT,                    -- WorkflowStepError.code on failure
  createdAt    TEXT NOT NULL,
  updatedAt    TEXT NOT NULL
);
```

`signal_json` is the durability record: the alarm reads it to drive the chain after any eviction. No
in-memory state survives eviction; the row does.

---

## migrate() — additive ALTER

Called once in the constructor inside `blockConcurrencyWhile`, after `CREATE TABLE IF NOT EXISTS`.
Existing DOs predate some columns; migration is additive only — never drop, never rename, never alter
existing data.

```
migrate():
  existing := set of column names from `PRAGMA table_info(sessions)`
  for each (col, ddlType) in REQUIRED_COLUMNS:        # repoId, signal_json, result_json, error, updatedAt
    if col not in existing:
      sql.exec(`ALTER TABLE sessions ADD COLUMN ${col} ${ddlType}`)
  # status column: legacy rows may hold 'running'/'completed' — normalize lazily on read, not here
```

`PRAGMA table_info` returns `{ cid, name, type, notnull, dflt_value, pk }`. We read `name` only.
ADD COLUMN with a NOT NULL constraint and no default is illegal on a populated table, so all added
columns are nullable (or carry a constant default). New rows always populate every column on INSERT.

---

## handleSignal — synchronous accept (< 1s)

```
POST /signal
  body := request.json()                              # 400 invalid-json on parse failure
  signal := CommissioningSignalSchema.safeParse(body) # 400 invalid-signal on failure
  now := ISO()
  INSERT OR REPLACE INTO sessions
    (sessionId, orgId, repoId, status, signal_json, isNodeId, result_json, error, createdAt, updatedAt)
    VALUES (signal.sessionId, signal.orgId, signal.repoId, 'queued',
            JSON(signal), NULL, NULL, NULL, now, now)
  ctx.storage.setAlarm(Date.now())                    # immediate; arms the chain
  return 202 { status: 'commissioned', sessionId, orgId }
```

No LLM call, no DO-to-DO call, no `waitUntil`. The response is bounded and independent of work latency.

---

## alarm() — durable processing

Single alarm slot per DO. `alarm()` picks **one** queued session, processes the full chain, then
re-arms if more are queued. No 6h advisory alarm exists in this DO, so there is no alarm-kind collision
(the SPEC-FF-CA-ASYNC-001 hazard is designed out).

```
alarm():
  row := SELECT * FROM sessions WHERE status = 'queued' ORDER BY createdAt LIMIT 1
  if no row: return                                   # nothing to do

  signal := JSON.parse(row.signal_json)
  setStatus(row.sessionId, 'commissioning')           # UPDATE status, updatedAt

  agent := buildPlannerAgent('planner', plannerEnv)   # built ONCE, threaded into every step
  writer := new CaGraphWriter(ARTIFACT_GRAPH stub)    # concrete EdgeWriter (INV-G2); see graph-writer.ts
  graph  := ARTIFACT_GRAPH stub (idFromName 'factory-artifact-graph')  # reads only (fetch-elucidation)

  try:
    # CA-INV-003: each pass awaits the prior; append before the next runs (append-only, INV-G4)
    elucidation := fetchElucidationStep({ elucidationArtifactId: signal.elucidationArtifactId }, graph)

    pressure := synthesizePressureStep(elucidation, signal, agent)
    writer.appendNode(govNode(pressure))                                   # GovernanceNode
    writer.appendLineageEdge(lineage(pressure.id, signal.dispositionEventId))  # LineageEdge

    capability := mapCapabilityStep(pressure, agent)
    writer.appendNode(govNode(capability))
    writer.appendLineageEdge(lineage(capability.id, pressure.id))

    proposal := proposeFunctionStep(capability, agent)
    writer.appendNode(govNode(proposal))
    writer.appendLineageEdge(lineage(proposal.id, capability.id))

    isNode := compilePrdStep(proposal, signal, agent)
    writer.appendNode(govNode(isNode))
    writer.appendLineageEdge(lineage(isNode.id, proposal.id))
    setIsNodeId(row.sessionId, isNode.id)              # persist IS-* before the gate

    # ── human-approval branch (CA-INV-007) ──
    if signal.requireHumanApproval:
      setStatus(row.sessionId, 'suspended-approval')   # halt; await POST /divergence
      reArmIfQueued(); return

    result := emitToMediationStep(isNode, signal, MEDIATION_AGENT stub)
    writeResult(row.sessionId, result)                 # result_json = { runId, atomCount }
    setStatus(row.sessionId, 'idle')                   # terminal success

  catch err:
    code := (err is WorkflowStepError) ? err.code : 'commission-failed'
    setStatusFailed(row.sessionId, code)               # status='failed', error=code
    # CA-INV-003: chain halts; downstream passes never run

  reArmIfQueued()                                      # SELECT 1 WHERE status='queued'; setAlarm(now) if any
```

`plannerEnv` is `{ DB, CLOUDFLARE_ACCOUNT_ID, CF_API_TOKEN: await CF_API_TOKEN?.get() ?? '' }`. Writes go
through `CaGraphWriter` per the Storage Contract above; reads (`getNode` in `fetch-elucidation.ts`) keep
the `ArtifactGraphNodeReader` structural cast to dodge the CF RPC `Serializable` collapse. `govNode(...)`
maps an artifact to a content-addressed `GovernanceNode` (`governanceNodeId`); `lineage(from, to)` builds
a `LINEAGE` edge.

**Eviction safety:** if the DO is evicted mid-chain, `status` is still `commissioning` and the alarm
re-fires on the next access; the chain restarts from `signal_json`. Appends are idempotent by
content-addressed id (§8.4 no-op), so restart is always safe. A partial prior run leaves orphaned
PRS-*/BC-* nodes the next run supersedes by fresh id — acceptable for v1 (no mid-chain checkpoint).

---

## handlePoll — GET /signal/:sessionId

```
row := SELECT status, isNodeId, result_json, error FROM sessions WHERE sessionId = ?
  if none: return 404 { error: 'session-not-found' }

phase := STATUS_TO_PHASE[normalize(row.status)]
return 200 {
  sessionId,
  phase,
  status:   row.status,                                # raw machine state, never collapsed
  isNodeId: row.isNodeId ?? null,
  result:   row.result_json ? JSON.parse(row.result_json) : null,   # { runId, atomCount } on success
  error:    row.error ?? null,                         # WorkflowStepError.code on failure
}
```

**STATUS_TO_PHASE:**

| status (SQLite)        | phase                  |
|------------------------|------------------------|
| `queued`               | `commissioning`        |
| `commissioning`        | `commissioning`        |
| `suspended-approval`   | `suspended-approval`   |
| `idle`                 | `idle`                 |
| `failed`               | `idle`                 |

Failure is **not** collapsed into success. `failed` maps to `phase: 'idle'` (no terminal phase token
exists for failure in the `Phase` type), but the poller distinguishes outcomes by `status` +
`error`: `status='idle'` with `result != null` is success; `status='failed'` with `error != null` is
failure. The e2e poll asserts on `status`, not `phase`. (`normalize` maps legacy `running`→`queued`,
`completed`→`idle` for pre-migration rows.)

---

## handleDivergence — POST /divergence

```
notification := DivergenceNotificationSchema.safeParse(body)   # 400 on failure
row := SELECT * FROM sessions WHERE sessionId = notification's session key   # see note

# ── resume path (suspended-approval) ──
if row exists AND row.status == 'suspended-approval':
  # CA-INV-007: resume is a re-queue, not run.resume()
  setStatus(row.sessionId, 'queued')                    # but resume_from marks the continuation point
  store resume_from = 'emit-to-mediation' for this session   # column or signal_json patch
  ctx.storage.setAlarm(Date.now())                       # re-arm
  return 202 { status: 'acknowledged', action: 'resumed' }

# ── hypothesis-formation path (unchanged) ──
else:
  agent := buildPlannerAgent('planner', plannerEnv)
  generate := (prompt) => ({ text: (await agent.generate(prompt)).text ?? '' })
  hypothesis := runHypothesisFormation(generate, notification, orgId)   # 500 if null
  amendment  := runAmendmentProposal(generate, hypothesis, orgId)       # 500 if null
  return 202 { status: 'acknowledged', amendmentId: amendment.id }
```

**Resume mechanics:** the `alarm()` chain checks `resume_from` for the picked session. When
`resume_from == 'emit-to-mediation'`, it skips passes 1–5 (the IS-* already exists at `row.isNodeId`),
reconstructs the IS-* reference, runs only `emitToMediationStep`, then writes result and sets `idle`.
The hypothesis-formation path is unchanged from the current `index.ts` — it does not touch the alarm
or the sessions chain.

> Note: `DivergenceNotification` carries `runId`, `divergenceId`, `specificationId` — not `sessionId`.
> The implementation resolves the session by matching `specificationId` against `sessions.isNodeId`
> (the IS-* is the SpecificationNode). If no suspended session matches, fall through to
> hypothesis-formation. This replaces the dropped `runId` lookup.

---

## Files changed

| File | Change |
|------|--------|
| `src/workflow/ca-compiler-workflow.ts` | **Deleted.** Mastra orchestrator removed. |
| `src/index.ts` | **Rewritten.** Add `alarm()`, `migrate()`, SQLite-read `handleSignal`/`handlePoll`/`handleDivergence`. Drop `caCompilerWorkflow`, `RequestContext`, `run.start`, `waitUntil`-pinned chain. Construct `CaGraphWriter` and write artifacts via `appendNode`/`appendLineageEdge` (per SPEC-FF-GRAPH-001 §4.2) — no `upsertNode`/`upsertEdge`. |
| `src/graph-writer.ts` | **NEW.** Concrete `EdgeWriter` (`@factory/graph` §4.2) for the CA. Wraps the ArtifactGraphDO stub, implements `appendNode`/`appendLineageEdge` as append-only stub RPC calls (INV-G2, INV-G4). |
| `src/workflow/steps/*.ts` | **Unchanged (verbatim).** Pure functions; they return validated artifacts and never call the writer — `alarm()` appends each via `CaGraphWriter`. Any prior call site invoking `upsertNode`/`upsertEdge` on the raw stub must move to `appendNode`/`appendLineageEdge` via the `EdgeWriter` — Engineer's task, not changed here. |
| `src/schemas.ts` | Unchanged. `Phase`, artifact schemas already correct. |
| `src/env.ts` | Unchanged. `DB`, `ARTIFACT_GRAPH`, `MEDIATION_AGENT`, `CF_API_TOKEN` already present. |
| `package.json` | Remove `@mastra/cloudflare-d1` (no longer used). Keep `@mastra/core` (agent) + `@mastra/memory`. |

---

## Acceptance criteria

1. `POST /signal` returns `202 { status: 'commissioned', sessionId, orgId }` in < 1s with zero LLM or
   DO-to-DO calls on the request path; a `sessions` row exists with `status='queued'`.
2. After the alarm fires, `GET /signal/:sessionId` reports `status='commissioning'`, then a terminal
   state; each of passes 2–5 has appended a schema-valid `GovernanceNode` (PRS-*, BC-*, FP-*, IS-*) to
   ArtifactGraphDO via `CaGraphWriter.appendNode` (with its `appendLineageEdge` provenance edge) before
   the next pass ran. No pass calls `upsertNode`/`upsertEdge`.
3. With `requireHumanApproval: true`, the chain halts at `status='suspended-approval'` after IS-* is
   persisted, and `GET` reports `phase: 'suspended-approval'` with a non-null `isNodeId`.
4. `POST /divergence` matching a suspended session re-arms the alarm; the alarm runs **only**
   `emit-to-mediation`, then `GET` reports `status='idle'` with `result.runId` set.
5. A step throwing `WorkflowStepError('pressure-synthesis-failed')` leaves `status='failed'`,
   `error='pressure-synthesis-failed'`, and **no** capability/proposal/IS node written
   (CA-INV-003 halt).
6. `migrate()` on a DO whose `sessions` table predates `repoId`/`signal_json`/`result_json`/`error`
   adds exactly those columns via `ALTER TABLE ADD COLUMN` and leaves existing rows intact.
7. The poller distinguishes success (`status='idle'` + `result != null`) from failure
   (`status='failed'` + `error != null`) without relying on `phase`.
8. `grep` finds zero references to `ca-compiler-workflow`, `createRun`, `run.start`, `run.resume`,
   `RequestContext`, `@mastra/cloudflare-d1`, `upsertNode`, `upsertEdge`, `arangojs`, or any AQL query
   in `src/`.
