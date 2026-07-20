# I-Layer Execution Governance Specification
**ID**: SPEC-FF-ILAYER-EXEC-001  
**Version**: 2.0  
**Date**: 2026-06-13  
**Status**: Canonical  
**Stack**: `@factory/gears` → `@cloudflare/think` (ThinkExecutor) → Mastra Agent → CF Sandbox  
**Replaces**: SPEC-FF-ILAYER-EXEC-001 v1.1 (Flue era — retired per SPEC-FF-FLUE-RETIRE-001)  
**Depends on**: SPEC-KSP-ARCH-001, SPEC-WEOPS-GATEWAY-BOUNDARY-001, SPEC-FF-GEARS-001, SPEC-FF-COORDINATOR-DO-001, SPEC-FF-CONSENT-BEAD-001, SPEC-FF-GAP-CLOSURES-001  
**Out of scope**: We-layer internals, WeOps primitives (CCI/PII/etc.), Linear integration internals

**Retired vocabulary (hard-fail if used):**  
`harness.session()` · `session.skill()` · `session.prompt()` · `session.task()` · `createAgent()` · `ctx.init()` · `@flue/runtime` · `skillDelivery[]` · `subAgentProfiles[]` · `PolicyBead` KV lookup · `POST /dispatch` · Gas City · `birthGate` · `SYNTHESIS_QUEUE`

---

## 0. Purpose and Scope

This document specifies the I-layer execution governance architecture for the Function Factory after the June 2026 Flue retirement. It is self-contained: a coding agent reading only this document and its declared dependencies can implement the I-layer without consulting prior versions.

The I-layer governs:
- What executes (Specification → `AtomDirective` compilation — I1, I2)
- What tools are permitted (compile-time `ToolPolicy` — I4)
- What is recorded (ConsentBead per tool call, ExecutionTrace per atom — I3)
- What crosses the We-layer boundary (EscalationEvents via gateway)

The I-layer does not govern WeOps primitives, CCI/PII computation, or organizational purpose governance.

---

## 1. Three-Role Architecture

```
Commissioning Agent  (CF Worker, stateless, per-repo · Mastra Workflow T1)
  │  commissions:  receives CommissioningSignal from WeOps Gateway
  │  deliberates:  builds Candidate Set, awaits human approval (Mastra suspend/resume)
  │  produces:     EluciationArtifact + ResourceBudgetBead on approval
  │  delegates to: Mediation Agent DO via POST /commission
  │
  ├── Mediation Agent DO  (CF Durable Object, per-repo · SPEC-MEDIATION-AGENT-DO-001 v3.0)
  │     compiles:  WorkGraph → AtomDirective[] (nine-step compile sequence)
  │     seeds:     CoordinatorDO via POST /init + POST /seed
  │     fires:     CF Queue message → ThinkExecutor
  │     idle after SEEDED until POST /complete from CoordinatorDO
  │
  └── Conducting Agent  (ThinkExecutor fiber + Mastra Agent, per-atom)
        ThinkExecutor:  owns durable fiber (@cloudflare/think), @cloudflare/shell filesystem,
                        CF Sandbox binding — runs NO LLM loop
        Mastra Agent:   buildConductingAgent() — runs LLM loop inside fiber
        enforces:       ConsentBead per tool call (I4)
        records:        ExecutionTrace to ArtifactGraphDO (I3)
        reports:        releaseBead() / failBead() to CoordinatorDO
```

### 1.1 Role Boundaries — Hard Rules

| Rule | Statement |
|------|-----------|
| R1 | The Conducting Agent never receives a WorkGraph. It receives only an `AtomDirective` compiled by the Mediation Agent DO. |
| R2 | The Mediation Agent DO never executes. After `SEEDED` it is idle. Execution is exclusively ThinkExecutor + Mastra Agent. |
| R3 | The Commissioning Agent never dispatches to a ThinkExecutor directly. All execution is triggered via CF Queue from the Mediation Agent DO. |
| R4 | `AtomDirective.toolPolicy.permittedTools` is set at compile time. No runtime policy lookup. A null `permittedTools` in production is an invariant violation that triggers I4 Autonomy Floor degradation. |

---

## 2. Knowing-State Prosthesis — Four Invariants

The I-layer is an instance of the Knowing-State Prosthesis category (spec-execution ontology §3.13). All four implementation invariants must hold at every point in the I-layer lifecycle.

| Invariant | Requirement | Enforcement mechanism |
|-----------|-------------|----------------------|
| **I1 — Externalization** | WorkGraph-derived content held in Mediation Agent DO SQLite (`compiled_molecules` table), not in any Conducting Agent session or context window | Structural — Mediation Agent DO is the sole compilation authority; ThinkExecutor receives only `AtomDirective` |
| **I2 — Retrieval enforcement** | `AtomDirective` (including `toolPolicy`, `specFiles`, `instructions`) is retrieved from the Mediation Agent DO at compile time and carried in the CF Queue message. ThinkExecutor cannot begin without it. | CF Queue message is the `AtomDirective` payload — no message, no execution |
| **I3 — Continuous maintenance** | Every tool call produces a ConsentBead. Every atom produces an ExecutionTrace node in ArtifactGraphDO. LoopClosureService maintains the session outcome record. | `ConsentBeadAuditProcessor` in Mastra `outputProcessors` — fires unconditionally before tool execution; `releaseBead()` / `failBead()` write D1 audit + call `LoopClosureService.recordOutcome()` |
| **I4 — Fail-closed coupling** | ConsentBead write fails → `ConsentDeniedError` thrown → tool never executes. CoordinatorDO unavailable → `claimBead()` fails → ThinkExecutor cannot proceed. `permittedTools` null in production → Autonomy Floor degrades to `SUGGEST` — no tool execution permitted. | Mastra `outputProcessors` chain is the sole I4 enforcement point. ThinkExecutor has no LLM lifecycle hooks to intercept. |

---

## 3. Mediation Agent DO

**DO key**: `mediation-agent:{repoId}`  
**Storage**: DO SQLite (event-sourced; state reconstructed from `meta` + `compiled_molecules` tables)  
**Package**: `packages/mediation-agent/`  
**Spec**: SPEC-MEDIATION-AGENT-DO-001 v3.0  
**Role**: Compile only. No execution role after `SEEDED`.

### 3.1 Lifecycle

```
UNINITIALIZED
  │  POST /commission (from Commissioning Agent)
  ▼
COMPILING  (nine-step compile sequence)
  /           \
FAILED        SEEDED
  │              │  POST /init → CoordinatorDO
  HTTP 422       │  POST /seed → CoordinatorDO
  → Commissioning│  CF Queue message → ThinkExecutor
    Agent retry  ▼
              COMPLETE  (POST /complete from CoordinatorDO)
```

- `FAILED`: returns HTTP 422. ArtifactGraphDO writes (steps 5–6 of compile sequence) may have occurred — content-addressed and idempotent on retry. No bead state in CoordinatorDO.
- `SEEDED`: DO is idle. All execution state lives in CoordinatorDO.
- Idempotent: second `POST /commission` with same `runId` returns cached `CommissionResponse` from `compiled_molecules` table without re-running.

### 3.2 HTTP Endpoints

#### `POST /commission`

Called by Commissioning Agent after EluciationArtifact and ResourceBudgetBead are written.

```typescript
// Request
{
  runId: string;               // SHA-256 deterministic run ID
  orgId: string;
  workGraphId: string;         // WG-* id
  workGraphVersion: string;
  d1ArtifactRefs: string[];    // D1 row keys for WorkGraph artifact graph
  eluciationArtifactId: string; // must exist in ArtifactGraphDO before compile begins
  stalenessThresholdHours?: number; // default 24
}

// Response (success)
{
  status: 'seeded';
  runId: string;
  atomCount: number;
  workGraphVersion: string;
}

// Response (failure)
{
  status: 'failed';
  reason: string;         // 'missing_gear' | 'invalid_workgraph_node' | 'coherence_failure'
  details: string;
}
```

**Nine-step compile sequence** (fail-closed at each step; first failure returns HTTP 422):

1. Validate `eluciationArtifactId` exists in ArtifactGraphDO — reject if absent (A9)
2. Fetch WorkGraph artifact graph from D1 using `d1ArtifactRefs`
3. Resolve Gear bindings for each WorkGraph atom — reject if any Gear missing
4. Run Coherence Verification probe (deterministic — no LLM call; checks: all atoms have `INV-*` binding, no circular `dependsOn`, all tool refs resolve, no atom references unknown `detectorId`)
5. Write `SpecificationNode` to ArtifactGraphDO (content-addressed)
6. Write `AtomDirective` nodes to ArtifactGraphDO (one per atom; content-addressed)
7. Write compiled molecules to `compiled_molecules` DO SQLite table
8. Seed CoordinatorDO: `POST /init` (runId, orgId) → `POST /seed` (AtomDirective[])
9. Send CF Queue message per atom: `{ runId, atomId, atomDirective }`

#### `POST /complete`

Called by CoordinatorDO when `getNextReady()` returns null (all beads terminal).

```typescript
// Request
{ runId: string; outcome: 'all_done' | 'partial_failure'; failedAtomIds: string[]; }

// Response
{ status: 'acknowledged'; }
```

DO transitions to `COMPLETE`. No further action.

#### `GET /health`

Returns current lifecycle state, `runId`, last commission timestamp, atom count.

---

## 4. CoordinatorDO

**Package**: `packages/gears/src/beads/coordinator-do.ts`  
**Spec**: SPEC-FF-COORDINATOR-DO-001  
**Storage**: DO SQLite — `meta` table (run identity), `execution_beads` table (bead graph), `bead_edges` table (DAG)  
**Role**: Owns the ExecutionBead DAG. Dispatches atoms to ThinkExecutor via CF Queue. Tracks bead lifecycle.

### 4.1 Run Lifecycle

```
COLD
  │  POST /init → initRun(runId, orgId)  [5-min alarm armed]
  ▼
INITIALIZED
  │  POST /seed → seedBeads(atomDirectives[])
  ▼
SEEDED  (execution_beads + bead_edges populated)
  │  CF Queue consumer fires ThinkExecutor.executeAtom()
  ▼
EXECUTING  (claimBead / releaseBead / failBead loop)
  │  getNextReady() returns null — all beads terminal
  ▼
COMPLETE  → POST /complete to Mediation Agent DO
```

State is derived from `meta` table on every wake from hibernation — never a mutable in-memory field.

### 4.2 ExecutionBead Status

```
UNSEEDED → ready → in_progress → done [*]
                              ↘ failed [*]
           ↑ alarm() rescue (in_progress + updated_at > 5min → ready)
```

| Transition | Trigger | Invariant |
|-----------|---------|-----------|
| `UNSEEDED → ready` | `seedBeads()` after `initRun()`. `INSERT OR IGNORE` — idempotent. | INV-1: `getNextReady()` throws `Error('molecule not seeded')` if called before seed |
| `ready → in_progress` | `claimBead()` — atomic `UPDATE … WHERE status='ready' RETURNING`. Only if all parent beads are `done`. | INV-2: single-CAS atomicity — no double-claim possible |
| `in_progress → done` | `releaseBead(agentId)` — verifies `assigned_to = agentId`. Writes D1 audit + calls `LoopClosureService.recordOutcome()`. | INV-3: alarm clock starts at `initRun()`; repeated `seedBeads()` cannot push window forward |
| `in_progress → failed` | `failBead(agentId)` — same ownership check. Divergence detection at BP1–BP3. | |
| `in_progress → ready` | `alarm()` every 5 min. Beads stale > 5 min rescued. | Alarm does not re-arm when all beads terminal |

### 4.3 HTTP Endpoints

- `POST /init` — `initRun(runId, orgId)`. Returns 409 if already initialized.
- `POST /seed` — `seedBeads(atomDirectives[])`. Returns 409 if `!this.runId`.
- `POST /claim` — `claimBead(atomId, agentId)`. Atomic CAS. Returns bead or 409.
- `POST /release` — `releaseBead(atomId, agentId)`. Ownership-checked.
- `POST /fail` — `failBead(atomId, agentId, errorCode)`. Ownership-checked. `errorCode: 'recoverable'` triggers stale-bead rescue path.
- `GET /next` — returns next `ready` bead whose parents are all `done`; null if run complete.

---

## 5. Conducting Agent — ThinkExecutor + Mastra Agent

**Package**: `packages/gears/src/agents/think-executor.ts`  
**Spec**: SPEC-FF-FLUE-RETIRE-001  
**Substrate**: `@cloudflare/think` (fiber) + Mastra `Agent` (LLM loop) + `@cloudflare/shell` (filesystem) + CF Sandbox (execution boundary)

### 5.1 ThinkExecutor

`ThinkExecutor` extends `Think<Env>`. It owns:
- The durable fiber (`runFiber('atom-execution', ctx)`)
- The `@cloudflare/shell` workspace filesystem
- The CF Sandbox binding

It runs **no LLM loop of its own**. The Mastra Agent runs the LLM loop inside the fiber.

**Entry point**: CF Queue consumer calls `ThinkExecutor.executeAtom(directive, mastraAgent, coordinatorDO)`

### 5.2 ThinkExecutor Fiber Lifecycle (SM10)

```
CF Queue message received
  │  executeAtom(directive, mastraAgent, coordinatorDO)
  ▼
fiber_started  (runFiber('atom-execution', ctx) begins)
  │  ctx.stash({ atomId, runId })
  │  write spec files to @cloudflare/shell workspace (from directive.specFiles)
  │  mastraAgent.generate() begins
  ▼
generating
  │
  ├── CF eviction          ─→  onFiberRecovered()
  │                              → POST /fail to CoordinatorDO (errorCode: 'recoverable')
  │                              → stale-bead alarm re-hooks to ready
  │                              → atom re-executes from scratch (no mid-stream resume)
  │
  ├── generation complete  ─→  evaluating  (evaluateSuccessCondition)
  │                              │
  │                         pass │        fail
  │                              ▼         ▼
  │                           success   failure
  │                              │         │
  │                        releaseBead()  failBead()
  │
  └── provider error       ─→  fiber_failed → failBead()
```

### 5.3 Mastra Agent — buildConductingAgent()

```typescript
// packages/gears/src/agents/conducting-agent.ts

export function buildConductingAgent(directive: AtomDirective, env: Env): Agent {
  return new Agent({
    name: `conducting-agent-${directive.atomId}`,
    model: resolveModel(directive.model),          // from AtomDirective
    instructions: directive.instructions,           // compiled by Mediation Agent DO
    tools: directive.toolSchemas.map(buildTool),   // from AtomDirective
    outputProcessors: [
      new ConsentBeadAuditProcessor(directive.toolPolicy, env.COORDINATOR_DO),
      new ToolCallFilter(directive.toolPolicy.permittedTools),
      new PIIDetector(env),
    ],
  });
}
```

**Mastra processor chain** (runs inside `mastraAgent.generate()` during `generating` state):
- `ConsentBeadAuditProcessor` — primary I4 gate (§6)
- `ToolCallFilter` — secondary belt-and-suspenders gate (Mastra built-in)
- `PIIDetector` — PII detection; does not block execution but writes evidence

### 5.4 Skill and Spec Content Delivery

Flue skill mechanisms (`session.skill()`, `AgentProfile.skills`, workspace discovery) are retired. Skill and spec content is delivered as:

**Instructions** (in `AtomDirective.instructions`): Mediation Agent DO compiles skill content from Gear bindings into the Mastra Agent's system instructions at commission time. This is T2 content (WorkGraph-specific, commission-time authored). No runtime skill loading.

**Spec files** (in `AtomDirective.specFiles[]`): ThinkExecutor writes these to the `@cloudflare/shell` workspace filesystem before `mastraAgent.generate()` begins. The Mastra Agent reads them from the filesystem via shell tools. Path convention: `/spec/{concern}/{filename}`.

**Repo-level skills** (formerly T3 workspace discovery): Delivered as part of `AtomDirective.instructions` compiled from the active Gear set. No `.agents/skills/` directory discovery.

**Cross-repo stable procedures** (formerly T1 build-time imports): Compiled into Gear definitions and included in `AtomDirective.instructions` at commission time.

All skill content authorship is a compile-time concern of the Mediation Agent DO, not a runtime concern of the Conducting Agent.

---

## 6. ConsentBead — I4 Enforcement

**Spec**: SPEC-FF-CONSENT-BEAD-001  
**Package**: `packages/gears/src/processors/consent-bead-audit-processor.ts`

Every tool call the Mastra Agent attempts produces exactly one ConsentBead before the tool executes.

### 6.1 ConsentBead Verdict Flow (SM6)

```
LLM response contains tool call
  │
  ▼
processOutputStep fires  (Mastra outputProcessors — before tool execution)
  │
  ├── toolName IN directive.toolPolicy.permittedTools?
  │
  │    YES                          NO
  │     │                            │
  ▼     ▼                            ▼
write ConsentBead             write ConsentBead
verdict: allowed              verdict: denied
  │                                  │
  ▼                                  ▼
ToolCallFilter passes         throw ConsentDeniedError
  │                           tool call never executes  (I4)
  ▼
tool executes
```

### 6.2 ConsentBead Schema

```typescript
type ConsentBead = {
  id: string;              // SHA-256(runId:atomId:toolName:inputHash:timestamp) — content-addressed
  runId: string;
  atomId: string;
  toolName: string;
  inputHash: string;       // SHA-256 of tool input JSON
  verdict: 'allowed' | 'denied';
  permittedTools: string[]; // snapshot of directive.toolPolicy.permittedTools at call time
  producedAt: string;
  producedBy: string;      // 'consent-bead-audit-processor'
};
```

Storage: DO SQLite in CoordinatorDO `consent_beads` table. `INSERT OR IGNORE` — idempotent on content-addressed ID.

### 6.3 I4 Enforcement Notes

- `ConsentBeadAuditProcessor` is in Mastra `outputProcessors` (`processOutputStep`), **not** in `ThinkExecutor`. ThinkExecutor has no LLM lifecycle hooks.
- A `verdict: denied` ConsentBead is proof that the tool never ran — the governance record precedes the gate.
- `ConsentDeniedError` propagates up through `mastraAgent.generate()` → ThinkExecutor catches → `failBead()` with `errorCode: 'governance_violation'`.
- ConsentBead write failure (DO unavailable) triggers Autonomy Floor degradation to `SUGGEST` (SM9). No tool execution permitted. Session must be closed.

---

## 7. Autonomy Floor Degradation (SM9)

```
[*] ──► FULL_OR_BOUNDED
          (ThinkExecutor.executeAtom() begins;
           autonomyFloor = AtomDirective.toolPolicy.permittedTools)
                │
    ConsentBeadAuditProcessor fails to write?
    ThinkExecutor runFiber() unreachable?
    CoordinatorDO unavailable?
                ▼
            SUGGEST  (I4 fail-closed)
                │  Agent may only surface options
                │  No tool execution permitted
                │  Human review required
                ▼
            [*] — session closed
            New session after root cause resolved
```

There is no in-session recovery from `SUGGEST`. Triggers: CoordinatorDO unavailable · ConsentBead write fails · `ThinkExecutor.runFiber()` cannot reach CoordinatorDO `/claim` · `AtomDirective.toolPolicy.permittedTools` is null in production.

---

## 8. AtomDirective Schema

`AtomDirective` is the authoritative translation artifact between the WorkGraph (ontology) and the ThinkExecutor + Mastra execution substrate. Produced by the Mediation Agent DO at compile time. Delivered via CF Queue message. Replaces all prior `AtomDirective` schemas in sibling specs.

```typescript
export const ToolPolicy = z.object({
  permittedTools: z.array(z.string()),   // tool names the Mastra Agent may call
  // Replaces PolicyBead KV lookup. Set at compile time. Null in production = invariant violation.
});

export const SpecFileEntry = z.object({
  virtualPath: z.string().startsWith('/spec/'), // path in @cloudflare/shell workspace
  content: z.string(),
  d1ArtifactRef: z.string(),                   // lineage ref
});

export const ToolSchemaEntry = z.object({
  name: z.string(),
  description: z.string(),
  parametersSchema: z.record(z.unknown()),      // JSON Schema for tool parameters
  // Inline content — resolved by Mediation Agent DO at compile time from Gear bindings
});

export const AtomDirectiveSchema = z.object({
  // Identity
  atomId: z.string(),                    // WG-{id}-ATOM-{n}
  workGraphId: z.string(),
  workGraphVersion: z.string(),
  runId: z.string(),                     // SHA-256 deterministic run ID

  // Execution configuration
  model: z.string(),                     // 'anthropic/claude-opus-4-6' | etc.
  instructions: z.string(),             // compiled by Mediation Agent DO from Gear bindings
                                         // includes: system instructions + skill content +
                                         //   repo-level governance + WorkGraph-specific constraints
  thinkingLevel: z.enum(['none', 'low', 'high']).default('low'),

  // Governance — compile-time, not runtime
  toolPolicy: ToolPolicy,               // I4: permittedTools set at compile time
  toolSchemas: z.array(ToolSchemaEntry), // tools available to Mastra Agent
  specFiles: z.array(SpecFileEntry),    // written to @cloudflare/shell before generate()

  // DAG governance
  invariantIds: z.array(z.string()),    // INV-* ids whose detectors run on this atom's trace
  dependsOn: z.array(z.string()),       // atomIds that must be done before claimBead() permits

  // Lineage
  eluciationArtifactId: string,         // ELC-* that authorized this run (A9)
  d1ArtifactRef: z.string(),            // D1 row key of source WorkGraph atom
  policyBeadId: z.string(),             // Bead Graph DO entry for lineage
});

export type AtomDirective = z.infer<typeof AtomDirectiveSchema>;
```

---

## 9. Verification-Process

Two Verification-Processes. Coherence runs at compile time in the Mediation Agent DO. Fidelity runs at outcome time via LoopClosureService.

### 9.1 Coherence Verification (at compile — step 4 of nine-step sequence)

**Verifies**: WorkGraph is internally consistent before any execution begins.

**Probe**: deterministic — no LLM call. Checks:
- All atoms have at least one `INV-*` binding
- No circular `dependsOn` references in atom DAG
- All tool names in `toolPolicy.permittedTools` resolve to known tool schemas
- No atom references a `detectorId` not present in the invariant set

**Verdict**: favorable (all checks pass) or unfavorable (any check fails with reason).

**Gate**: unfavorable → compile sequence returns HTTP 422. No CoordinatorDO seeded. No execution.

### 9.2 Fidelity Verification (at outcome — LoopClosureService BP1–BP3)

**Verifies**: atom execution outcome is consistent with the active Specification.

**Trigger**: `releaseBead()` or `failBead()` → `LoopClosureService.recordOutcome()` → BP1.

**Probe**: LoopClosureService evaluates the `ExecutionTrace` node (written to ArtifactGraphDO) against the atom's `INV-*` bindings. Deterministic evaluation — no LLM call.

**Verdict**: favorable (no violations) or unfavorable (Divergence detected).

**On unfavorable**: LoopClosureService BP2–BP3 → `buildHypothesis()` → fault attribution → `proposeAmendment()` → Amendment CANDIDATE written to ArtifactGraphDO → Verification-Process runs (Mastra eval T4) → ADOPTED or REJECTED.

**If blocking Divergence unresolvable**: Commissioning Agent closes the run; Architect writes terminal node; We-layer notified via EscalationEvent.

---

## 10. LoopClosureService

**Package**: `packages/loop-closure/src/loop-closure-service.ts`  
**Spec**: SPEC-FF-GAP-CLOSURES-001 §4

Session lifecycle:
```
[*] → open  (CoordinatorDO initRun + seedBeads complete)
  │  executeAtom() begins
  ▼
executing  (ConsentBeads written on each tool call)
  │  releaseBead() or failBead() → recordOutcome()
  ▼
outcome_written  (ExecutionTrace node in ArtifactGraphDO)
  │
  ├── Divergences? ──► amendment_proposed → [SM7 Amendment Lifecycle]
  └── No divergences ──► open  (next atom)
```

`ArtifactGraphDO` is the durable store for all governance nodes: `SpecificationNode`, `AtomDirective` nodes, `ExecutionTrace` nodes, `Hypothesis` nodes, `Amendment` nodes, `Verdict` nodes. Append-only; nodes never updated in place.

---

## 11. Storage Topology

| Store | What goes in it | Owner |
|-------|----------------|-------|
| DO SQLite (Mediation Agent DO, per-repo) | `compiled_molecules`, `meta` — compile-time artifacts | Mediation Agent DO |
| DO SQLite (CoordinatorDO, per-run) | `execution_beads`, `bead_edges`, `consent_beads`, `meta` | CoordinatorDO |
| ArtifactGraphDO (DO, per-repo) | Specification nodes, AtomDirective nodes, ExecutionTrace nodes, Hypothesis, Amendment, Verdict — append-only | LoopClosureService + Mediation Agent DO |
| D1 (Factory-wide) | Cross-run audit log, `releaseBead` / `failBead` audit rows, artifact index | CoordinatorDO + Mediation Agent DO |
| KV | Hot routing config; CoordinatorDO stub URLs; KV cache invalidated on new Specification adoption | Mediation Agent DO |
| CF Queue | `AtomDirective` payloads — from Mediation Agent DO to ThinkExecutor | Mediation Agent DO (producer), ThinkExecutor (consumer) |

**Retired stores**: Flue-managed DO SQLite (session state) — gone with Flue. ArangoDB — retired (Bead store replaced by DO SQLite + D1; Elucidation Artifacts in ArtifactGraphDO).

---

## 12. We-Layer Boundary Interface

The I-layer presents the following interface to the WeOps Gateway (SPEC-WEOPS-GATEWAY-BOUNDARY-001):

**Inbound** (We → I, via Gateway):
- `CommissioningSignal` → `{commissioningAgentUrl}/commission` → Mastra Workflow T1 begins
- `ResumeSignal` → `{commissioningAgentUrl}/resume` → Mastra `run.resume({ approved: true })`
- `OverrideSignal` → Commissioning Agent; may force-terminate CoordinatorDO run

**Outbound** (I → We, via Gateway — WGSP envelopes signed with `FF_AGENT_SIGNING_KEY`):
- `EscalationEvent` — produced by LoopClosureService on blocking unresolvable Divergence
- `HealthSummary` — produced by Commissioning Agent on schedule
- `VCR` (Verdict Closure Record) — produced by LoopClosureService on every Verdict

---

## 13. Open Items

| Item | Blocking |
|------|---------|
| Nine-step compile sequence steps 5–6 (ArtifactGraphDO write schema) — node types and edge labels for `SpecificationNode` and `AtomDirective` nodes not yet specified in this doc. Governed by SPEC-FF-COORDINATOR-DO-001. | No — cross-ref to sibling spec. |
| `evaluateSuccessCondition` in ThinkExecutor — the predicate that determines `success` vs `failure` in the fiber `evaluating` state is not specified here. Governed by SPEC-FF-FLUE-RETIRE-001. | No — cross-ref to sibling spec. |
| LoopClosureService BP1–BP3 detector specs — the invariant detector functions that evaluate ExecutionTrace against `INV-*` bindings are not specified here. Governed by SPEC-FF-GAP-CLOSURES-001. | No — cross-ref. |
| Mastra eval T4 for Amendment Verification-Process — the Mastra evaluation step that produces ADOPTED/REJECTED verdict for Amendment CANDIDATE is referenced but not detailed here. Governed by SPEC-FF-GAP-CLOSURES-001 §4. | No — cross-ref. |
