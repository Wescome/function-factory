# Design — @factory/gears

> Module: ksp-gears | Package: `@factory/gears`
> doc_level: completo | Generated: 2026-06-10
> Source: SPEC-FF-GEARS-001, domain.md (KSP section), architecture.md (KSP Layer)

---

## 1. Purpose and Scope

`@factory/gears` is the **complete harness and execution substrate** for the Function Factory. It hosts the per-run execution-trace bead store (`CoordinatorDO`), provides the durable atom executor (`ThinkExecutor extends Think<Env>`), the LLM orchestration layer (`buildConductingAgent` → Mastra `Agent`), the I4 enforcement processor (`ConsentBeadAuditProcessor`), and the typed gear registry vocabulary. Consumers never import `@cloudflare/think`, `@mastra/core`, or `@cloudflare/sandbox` directly.

`@flue/runtime` was fully retired as of 2026-06-12 (ADR-014). The new substrate is 100% Cloudflare-native: `@cloudflare/think` (durable fiber), `@cloudflare/shell` (workspace), `@cloudflare/codemode` (Dynamic Worker isolate), `@cloudflare/sandbox` (Container), `@mastra/core` (LLM orchestration), `@mastra/memory` + `@mastra/cloudflare-d1` (D1-backed observational memory).

This is a Phase 4 package in the KSP build order. It depends on `@factory/artifact-graph`, `@factory/bead-graph`, `@factory/loop-closure`, and `@factory/factory-graph` being built and tested first.

---

## 2. Package Structure

```
packages/gears/
├── package.json
└── src/
    ├── index.ts                         Public barrel — re-exports agents, processors, gears, beads
    ├── agents/
    │   ├── models.ts                    MODEL_BY_ROLE: role → Mastra-compatible model config
    │   ├── conducting-agent.ts          buildConductingAgent() → Mastra Agent (LLM loop)
    │   └── think-executor.ts           ThinkExecutor extends Think<Env> (durable substrate)
    ├── processors/
    │   └── consent-bead-audit-processor.ts  ConsentBeadAuditProcessor (I4 enforcement)
    ├── gears/
    │   ├── types.ts                     Gear, GearFormula, GearMolecule Zod schemas
    │   ├── registry.ts                  GearRegistry: D1-backed gear store
    │   ├── formula.ts                   GearFormula: named sequences + dependency edges
    │   ├── molecule.ts                  GearMolecule: instantiated bead set from formula
    │   └── builtin/
    │       ├── planner.gear.ts
    │       ├── coder.gear.ts
    │       ├── critic.gear.ts
    │       ├── tester.gear.ts
    │       └── verifier.gear.ts
    ├── beads/
    │   ├── types.ts                     ExecutionBead, BeadEdge Zod schemas (§7a)
    │   ├── coordinator-do.ts            CoordinatorDO — single-writer per-run bead store (§7b)
    │   ├── hook.ts                      claimHook/releaseHook/failHook/getNextReady API
    │   └── d1-audit.ts                  Append-only D1 bead_audit log writer
    └── skills/
        ├── loader.ts                    Skill registration helpers
        ├── reversa/
        ├── gstack/
        ├── bmad/
        └── factory-native/
```

**Note**: `src/flue/` was deleted entirely in 003-flue-retirement (2026-06-12). `hooks.ts` (plural) does not exist. I2 enforcement and stalled bead detection are both in `CoordinatorDO.alarm()`.

---

## 3. File Responsibilities

| File | Responsibility |
|------|---------------|
| `src/index.ts` | Public barrel. Consumers import from `@factory/gears`. Never internal paths. |
| `src/agents/models.ts` | `MODEL_BY_ROLE` map: role → Mastra-compatible model config. `RoleName` type. Replaces retired `PROFILE_BY_ROLE` from `@flue/runtime`. |
| `src/agents/conducting-agent.ts` | `buildConductingAgent(directive, coordinatorDO, workspace, env)` → Mastra `Agent`. Owns model, tools resolver, processors, memory. |
| `src/agents/think-executor.ts` | `ThinkExecutor extends Think<Env>`. Owns durable fiber (`runFiber()`), workspace, sandbox. No LLM loop. HTTP route `/execute-atom`. |
| `src/processors/consent-bead-audit-processor.ts` | `ConsentBeadAuditProcessor extends BaseProcessor`. I4 enforcement: writes `ConsentBead`, throws `ConsentDeniedError` on denied tool. |
| `src/gears/types.ts` | Zod schemas: `Gear`, `GearFormula`, `GearMolecule`. Exported types. |
| `src/beads/types.ts` | `ExecutionBead` Zod schema (maps to `execution_beads` SQLite row). `ExecutionBeadStatus` enum. |
| `src/beads/coordinator-do.ts` | `CoordinatorDO extends DurableObject`. DO SQLite schema migration, `initRun`, `claimBead`, `releaseBead`, `failBead`, `getNextReady`, `alarm`, `writeAudit`, `recordOutcome`, HTTP fetch handler. |
| `src/beads/hook.ts` | Thin HTTP-stub wrapper: `claimHook`, `releaseHook`, `failHook`, `getNextReady` — all call DO via stub. |
| `src/beads/d1-audit.ts` | `writeBeadAudit(db, entry)` — explicit helper that writes to D1 `bead_audit` table. Optional factored helper; may be inlined in coordinator-do.ts. |

---

## 4. Key Algorithms and Data Flows

### 4.1 CoordinatorDO: Full Implementation

`CoordinatorDO extends DurableObject<Env>` is the central component. It is instantiated once per `runId` and serializes all bead state transitions for that WorkGraph execution.

**Constructor lifecycle:**
1. `ctx.blockConcurrencyWhile(async () => {...})` — restores `runId` and `orgId` from DO storage on eviction/restart
2. `this.sql = ctx.storage.sql` — SQLite handle
3. `this.migrate()` — `CREATE TABLE IF NOT EXISTS` for both tables (idempotent)

**initRun(runId, orgId):**
- Sets `this.runId` and `this.orgId`
- Persists both to `ctx.storage.put(key, value)` for crash recovery
- Idempotent: safe to call on every workflow invocation

**claimBead(beadId, agentId):**
- Executes atomic `UPDATE ... WHERE status='ready' RETURNING *`
- Returns the claimed `ExecutionBead` row or `null` if not available
- Increments `attempt_count` atomically

**releaseBead(beadId, agentId, result):**
1. `UPDATE execution_beads SET status='done'` where `assigned_to` matches
2. `await writeAudit(beadId, agentId, 'done')` — D1 compliance write
3. `await recordOutcome(beadId, agentId, result, 'done')` — Bridge Point 3

**failBead(beadId, agentId, result):**
1. `UPDATE execution_beads SET status='failed'`
2. `await writeAudit(beadId, agentId, 'failed')`
3. `await recordOutcome(beadId, agentId, result, 'failed')`

**getNextReady(moleculeId):**
- Selects a bead that is `ready`, belongs to `moleculeId`, and has no `pending` parent in `bead_edges`
- Dependency query:
  ```sql
  SELECT b.* FROM execution_beads b
  WHERE b.molecule_id=? AND b.status='ready'
    AND NOT EXISTS (
      SELECT 1 FROM bead_edges e
      JOIN execution_beads p ON p.id=e.parent_id
      WHERE e.child_id=b.id AND p.status != 'done'
    )
  ORDER BY b.created_at ASC LIMIT 1
  ```
- Returns the oldest available bead or `null`

**alarm():**
- Cutoff = `Date.now() - 5 * 60 * 1000`
- Re-hooks stalled beads: `UPDATE ... SET status='ready', assigned_to=NULL WHERE status='in_progress' AND updated_at < cutoff`
- Re-arms: `ctx.storage.setAlarm(Date.now() + 5 minutes)`

**writeAudit(beadId, agentId, verdict):**
- Reads `execution_beads` row to get `gear_id` and `attempt_count`
- Calls `D1_AUDIT.prepare(...).bind(...).run()` with full row
- Early return if `this.runId` is empty (pre-initRun guard)

**recordOutcome(beadId, agentId, resultJson, verdict):**
- Early return if `this.runId || this.orgId` is empty
- Parses `resultJson` as `ConductingAgentTraceFragment`
- Constructs namespace: `factory:{orgId}:{runId}`
- Instantiates `LoopClosureService` with all four constructor arguments
- Calls `loopClosure.recordOutcome(beadId, beadId, { status, summary, toolCallCount: 0 })`

### 4.2 Hook API: Client-Side Stubs

`hook.ts` is a thin RPC layer. Each function calls the DO via `DurableObjectStub.fetch()`:

```
claimHook(stub, beadId, agentId)
  → POST /claim  body: [beadId, agentId]
  → Response.json(ExecutionBead | null)

releaseHook(stub, beadId, agentId, result)
  → POST /release  body: [beadId, agentId, result]

failHook(stub, beadId, agentId, result)
  → POST /fail  body: [beadId, agentId, result]

getNextReady(stub, moleculeId)
  → POST /next  body: moleculeId
  → Response.json(ExecutionBead | null)
```

### 4.3 Agent Profile Selection

The Flue workflow (`atom-execution.ts`) selects profiles using:

```typescript
const profile = PROFILE_BY_ROLE[directive.role]
// directive.role is set at compile time by Mediation Agent from Gear.role
// No deriveRole() call. No prefix matching.
```

### 4.4 Outbound Sandbox Injection

The `Sandbox` class extends `@cloudflare/sandbox` `BaseSandbox`. On every outbound HTTP request, Cloudflare calls the matching entry in `static outboundByHost` to inject credentials:

```typescript
static outboundByHost = {
  'api.anthropic.com': (req, env) => inject(req, 'x-api-key', env.ANTHROPIC_API_KEY),
  'api.openai.com':   (req, env) => inject(req, 'Authorization', `Bearer ${env.OPENAI_API_KEY}`),
  'api.deepseek.com': (req, env) => inject(req, 'Authorization', `Bearer ${env.DEEPSEEK_API_KEY}`),
  'api.github.com':   (req, env) => inject(req, 'Authorization', `Bearer ${env.GITHUB_TOKEN}`),
}
```

---

## 5. Cloudflare Primitives Used and Why

| Primitive | Used in | Reason |
|-----------|---------|--------|
| `DurableObject` + SQLite (`ctx.storage.sql`) | `CoordinatorDO` | Single-writer serialization for bead state. No concurrent writers. 10 GB storage for large molecules. |
| `ctx.storage.setAlarm()` | `CoordinatorDO.alarm()` | Stalled-bead GC without Flue hooks or `scheduleEvery`. Same pattern as `MediationAgentDO`. |
| `ctx.blockConcurrencyWhile()` | `CoordinatorDO` constructor | Restore `runId`/`orgId` before any request is processed after eviction. |
| `D1Database` (`D1_AUDIT`) | `CoordinatorDO.writeAudit()` | Cross-run append-only audit log. D1 is shared across all DO instances; DO SQLite is per-DO only. |
| `@cloudflare/sandbox` extension | `Sandbox` class | Wraps agent execution in Cloudflare Container Sandbox for outbound host-gated calls. |
| `DurableObjectNamespace` | `ARTIFACT_GRAPH`, `BEAD_GRAPH`, `COORDINATOR_DO` | Namespaced DO routing for multi-org, multi-run isolation. |
| `KVNamespace` | `KV_KS` binding in `Env` | Hot cache for knowing-state retrieval by `LoopClosureService`. |

---

## 6. Integration Points

### What @factory/gears Depends On

| Package | Relationship | Detail |
|---------|-------------|--------|
| `@factory/schemas` | DEPENDENCY | `RoleName`, `AtomDirective`, `SuccessCondition`. Never inverted. |
| `@factory/loop-closure` | DEPENDENCY | `LoopClosureService` instantiated in `CoordinatorDO.recordOutcome()` — Bridge Point 3. |
| `@factory/factory-graph` | DEPENDENCY | `FactoryArtifactGraphDO`, `FactoryBeadGraphDO`, `factoryDivergenceDetector`, `factoryHypothesisBuilder`, `factoryAmendmentVerifier` — used in `recordOutcome()`. |
| `@cloudflare/think` | SUBSTRATE | `Think<Env>` base class for `ThinkExecutor`. `WorkspaceLike`. Consumers never import this directly. |
| `@mastra/core` | ORCHESTRATION | `Agent`, `BaseProcessor`, `RequestContext`. LLM orchestration. Consumers never import directly. |
| `@mastra/memory` + `@mastra/cloudflare-d1` | MEMORY | D1-backed observational memory for `ConductingAgent`. |
| `@cloudflare/sandbox` | WRAPPED | Sandbox binding for tool executor. Consumers never import directly. |

### What Calls @factory/gears

| Package | Role |
|---------|------|
| `workers/ff-pipeline` | Exports `ThinkExecutor`, `CoordinatorDO` from `index.ts` for wrangler DO binding registration. Queue consumer POSTs `AtomDirective` to `ThinkExecutor` at `/execute-atom`. |

### What @factory/gears is Independent Of

| Package | Why Independent |
|---------|----------------|
| `@factory/compiler` | Pure functions, produces WorkGraphs. No coupling. |
| `@factory/coverage-gates` | Gate evaluation independent of harness. |

---

## 7. SQLite Schemas

### 7.1 CoordinatorDO — DO SQLite (per-run)

```sql
CREATE TABLE IF NOT EXISTS execution_beads (
  id            TEXT PRIMARY KEY,
  molecule_id   TEXT NOT NULL,
  gear_id       TEXT NOT NULL,
  node_id       TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'ready',
  assigned_to   TEXT,
  attempt_count INTEGER DEFAULT 0,
  payload       TEXT,     -- JSON: AtomDirective
  result        TEXT,     -- JSON: ConductingAgentTraceFragment
  created_at    INTEGER,
  updated_at    INTEGER
);

CREATE TABLE IF NOT EXISTS bead_edges (
  parent_id TEXT NOT NULL,
  child_id  TEXT NOT NULL,
  PRIMARY KEY (parent_id, child_id)
);
```

**Status lifecycle**: `ready → in_progress → done | failed`

Re-hook path (alarm/crash recovery): `in_progress → ready` (clears `assigned_to`)

**ExecutionBead cross-references:**
- `ExecutionBead.id` maps to `CommitBead.content.artifact_graph_execution_id` in the Bead Graph
- `ExecutionBead.result` (`ConductingAgentTraceFragment`) maps to the `ExecutionTrace` node written in the artifact graph by `LoopClosureService`

### 7.2 D1 factory-bead-audit (cross-run append-only)

```sql
CREATE TABLE IF NOT EXISTS bead_audit (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id    TEXT    NOT NULL,
  bead_id   TEXT    NOT NULL,
  gear_id   TEXT    NOT NULL,
  agent_id  TEXT    NOT NULL,
  verdict   TEXT    NOT NULL,   -- done | failed | timed_out
  attempt   INTEGER NOT NULL,
  ts        INTEGER NOT NULL
);
```

Written by `CoordinatorDO.writeAudit()` via the `D1_AUDIT` binding. Append-only; no updates or deletes.

---

## 8. Env Bindings Required

```typescript
interface Env {
  D1_AUDIT:       D1Database                                // Cross-run compliance log
  ARTIFACT_GRAPH: DurableObjectNamespace<FactoryArtifactGraphDO>  // KSP artifact graph
  BEAD_GRAPH:     DurableObjectNamespace<FactoryBeadGraphDO>      // KSP bead graph
  KV_KS:          KVNamespace                               // KSP hot cache
  // Agent outbound calls (injected by Sandbox):
  ANTHROPIC_API_KEY: string
  OPENAI_API_KEY:    string
  DEEPSEEK_API_KEY:  string
  GITHUB_TOKEN:      string
}
```

---

## 9. ff-pipeline/index.ts and wrangler.jsonc

### ff-pipeline/index.ts DO exports

```typescript
export { CoordinatorDO, ThinkExecutor } from '@factory/gears'
export { MediationAgentDO } from '@factory/mediation-agent'
export { ArchitectAgentDO }  from '@factory/architect-agent'
// KSP graph DOs...
```

`Sandbox` export removed (ADR-014). `ThinkExecutor` replaces `FlueAtomExecutionWorkflow` / `FlueRegistry` (retired).

### wrangler.jsonc additions (post ADR-014)

```jsonc
{
  "migrations": [{
    "tag": "v1",
    "new_sqlite_classes": [
      "MediationAgentDO", "ArchitectAgentDO", "CoordinatorDO",
      "FactoryArtifactGraphDO", "FactoryBeadGraphDO"
    ]
  }, {
    "tag": "v2",
    "new_sqlite_classes": ["ThinkExecutor"]
  }],
  "durable_objects": {
    "bindings": [
      { "name": "MEDIATION_AGENT",  "class_name": "MediationAgentDO" },
      { "name": "COORDINATOR_DO",   "class_name": "CoordinatorDO" },
      { "name": "THINK_EXECUTOR",   "class_name": "ThinkExecutor" },
      { "name": "ARTIFACT_GRAPH",   "class_name": "FactoryArtifactGraphDO" },
      { "name": "BEAD_GRAPH",       "class_name": "FactoryBeadGraphDO" }
    ]
  },
  "worker_loaders": [{ "binding": "LOADER" }],
  "kv_namespaces": [
    { "binding": "KV_KS", "id": "<provision>" }
  ],
  "d1_databases": [
    { "binding": "D1_AUDIT", "database_name": "factory-bead-audit",
      "database_id": "<provision>" },
    { "binding": "DB", "database_name": "factory-mastra-memory",
      "database_id": "<provision>" }
  ]
}
```

---

## 10. AtomDirective Schema Addition

`packages/schemas/src/atom-directive.ts` gains two fields:

```typescript
export const AtomDirective = z.object({
  // ...all existing fields unchanged (SPEC-CONDUCTING-AGENT-001 §1.2 canonical)...
  skillRef: z.string().min(1),   // declared skill name → session.skill(skillRef)
  role:     z.enum(['planner', 'coder', 'critic', 'tester', 'verifier']),
})
```

`skillRef` comes from `Gear.skillRef`. `role` comes from `Gear.role`. Set by Mediation Agent compile step. Not set by the Conducting Agent.

`role` is required by the Flue workflow to select the `AgentProfile` via `PROFILE_BY_ROLE[directive.role]`. The prior `deriveRole()` heuristic (prefix matching on `skillRef`) is deleted — it silently misrouted any `skillRef` that did not match a known prefix.

---

## 11. Package Build Position

```
Phase 1 (no deps):
  @factory/artifact-graph  ←  @factory/bead-graph

Phase 2 (depends on bead-graph):
  @factory/ksp-sdk

Phase 3 (depends on artifact-graph + bead-graph):
  @factory/loop-closure

Phase 4 (depends on all three base packages):
  @factory/factory-graph  →  @factory/gears     ← THIS PACKAGE

Phase 5 (depends on factory-graph + gears):
  .flue/workflows/atom-execution.ts
```

`tsc --noEmit` zero errors is required at each phase boundary.

---

## 12. Architectural Decisions Realized

| ADR / Decision | Implementation |
|---------------|---------------|
| GD-001: Static AgentProfiles | `defineAgentProfile` exports; no dynamic binding |
| GD-002: One DO per execution | `runId = SHA-256(workGraphId + workGraphVersion)`; DO key `coordinator:{runId}` |
| GD-003: Zero-migration skill discovery | `session.skill(skillRef)` via workspace discovery from `.agents/skills/` |
| GD-005: Single Sandbox class | `static outboundByHost` with all four hosts; per-role gating is `toolPolicy` |
| BR-KSP-16: initRun ordering | `blockConcurrencyWhile` restores from storage; alarm and hooks guard on `runId` |
| BR-KSP-17: writeAudit implemented | D1 `INSERT` via `D1_AUDIT` binding in `releaseBead` and `failBead` |
| BR-KSP-19: No deriveRole | `PROFILE_BY_ROLE[directive.role]` is the sole lookup; `deriveRole()` deleted |
