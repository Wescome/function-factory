# SPEC-FF-CA-REWRITE-001 — CommissioningAgent Compiler Pass Rewrite

**Status:** APPROVED — ready for implementation  
**Supersedes:** SPEC-FF-CA-ASYNC-001 (commissioning flow only; divergence/amendment loop unchanged)  
**Date:** 2026-06-16  
**Architect review:** CONDITIONAL → APPROVED after v2 corrections (2026-06-17)

---

## AMENDMENT (2026-06-17) — Mastra workflow lifecycle superseded by SPEC-FF-CA-ALARM-001

The DO lifecycle mechanics in this spec (Mastra `createWorkflow`, `createRunAndStart`, `getRunById`,
`@mastra/cloudflare-d1` persistence, `workflow.suspend()`/`run.resume()`) are **superseded** by
**SPEC-FF-CA-ALARM-001**. That spec replaces the Mastra workflow orchestrator with a DO `alarm()`-driven
sequence over the same pure step functions, conforming to the DO-owned 202-accept + poll decision of
**SPEC-FF-CA-ASYNC-001**.

Two invariants are amended:

- **CA-INV-001 — AMENDED:** The DO uses `alarm()` for async processing per SPEC-FF-CA-ASYNC-001 and
  SPEC-FF-CA-ALARM-001. The prohibition on alarm handlers is **revoked**. The DO still owns no Mastra
  workflow engine and no `Think` LLM loop.
- **CA-INV-007 — AMENDED:** Human approval suspension is a SQLite `status='suspended-approval'` state,
  **not** `workflow.suspend()`. Resume is a re-queue + alarm re-arm. The Mastra workflow orchestrator is
  removed.

**What this spec still governs (unchanged and valid):**

- The pure compiler-pass step extraction into `src/workflow/steps/*.ts` (kept verbatim).
- The schema rewrites in `src/schemas.ts` (`Phase`, `PressureArtifact`, `CapabilityArtifact`,
  `FunctionProposal`; removal of `WorkGraph`/`CandidateSet`/`ExecutionApproach`).
- All file deletions in the File Inventory (`skill-registry.ts`, `phases/deliberation.ts`, etc.).
- `buildPlannerAgent` as the sole LLM entry point (CA-INV-005).
- ArtifactGraphDO as the artifact store; no ArangoDB (CA-INV-004).
- The IS-* → MediationAgentDO `/commission` handoff (CA-INV-008).

The "Target Architecture", "CommissioningAgentDO (Rewritten)", "DO↔Mastra Run lifecycle", and
"Mastra Workflow: ca-compiler-workflow" sections below describe the Mastra mechanism and are retained
for historical context only. **Read SPEC-FF-CA-ALARM-001 for the authoritative lifecycle.**

---

## Problem

The CommissioningAgentDO currently:

1. Extends `Think<Env>` — wrong substrate. `Think` is for code execution atoms. The CA runs compiler passes, not code.
2. Runs all LLM calls via raw `generateText` — bypasses processors (no ConsentBead, no PIIDetector).
3. `workgraph-authoring.ts` asks the LLM to produce four nested artifacts (`pressure`, `capability`, `functionProposal`, `prd`) in a single unconstrained generation. All four fields are typed `unknown`. This is a prompt, not a compiler.
4. `skill-registry.ts` gates execution on `domainProfile.vertical` — domain routing built for WeOps before the Factory bootstrapped itself, blocking the bootstrap signal.
5. Persists artifacts to ArangoDB — ArangoDB is retired.

---

## Invariants

These must hold after the rewrite. They are not negotiable.

**CA-INV-001** — The CommissioningAgentDO is a thin stub. It does not own an LLM loop, a phase state machine, or an alarm handler.

**CA-INV-002** — Each compiler pass is a discrete Mastra workflow step with a schema-validated input and a schema-validated output. The LLM is a transformer within structural constraints.

**CA-INV-003** — Pass N does not run until Pass N-1 has produced a valid artifact and written it to ArtifactGraphDO. No pass may be skipped.

**CA-INV-004** — All artifacts are written to ArtifactGraphDO. ArangoDB is not referenced anywhere in this package.

**CA-INV-005** — All LLM calls go through `buildPlannerAgent` from `@factory/gears`. Raw `generateText` and `buildConductingAgent` (atom-execution substrate) are both forbidden.

**CA-INV-006** — No skill registry. No vertical routing. No `domainProfile`. The ConductingAgent system prompt IS the skill.

**CA-INV-007** — Human approval suspension is `workflow.suspend()`. The DO does not implement its own suspend/resume logic.

**CA-INV-008** — Compiler structural passes (normalize → extractAtoms → ...) run inside the MediationAgentDO, not in the CA. The CA produces an IntentSpecification and hands off. It does not call `packages/compiler` directly.

---

## Target Architecture

```
POST /signal
  │
  ▼
CommissioningAgentDO (thin DO, plain DurableObject)
  │  SQLite: sessions(sessionId, runId, orgId, isNodeId, createdAt)
  │
  ▼
Mastra Workflow: ca-compiler-workflow   (state persisted via @mastra/cloudflare-d1 on DB binding)
  │
  ├─ step 1: fetch-elucidation-artifact  → ElucidationContent
  ├─ step 2: synthesize-pressure         → PressureArtifact    → ArtifactGraphDO upsertNode(PRS-*)
  ├─ step 3: map-capability              → CapabilityArtifact  → ArtifactGraphDO upsertNode(BC-*)
  ├─ step 4: propose-function            → FunctionProposal    → ArtifactGraphDO upsertNode(FP-*)
  ├─ step 5: compile-prd                 → IntentSpecification → ArtifactGraphDO upsertNode(IS-*)
  ├─ step 6: suspend [if requireHumanApproval]
  └─ step 7: emit-to-mediation           → POST MediationAgentDO /commission

POST /divergence  →  resume suspended workflow OR start hypothesis-formation handler
GET  /signal/:id  →  rehydrate Mastra Run from DB → return { phase, status }
```

---

## CommissioningAgentDO (Rewritten)

**File:** `packages/commissioning-agent/src/index.ts`

- Extends `DurableObject<Env>` — **not** `Think<Env>`
- No alarm handler
- No phase state machine
- No `getSystemPrompt()`, `configureSession()`, `getSkills()` overrides

### SQLite schema (DO storage)

```sql
CREATE TABLE IF NOT EXISTS sessions (
  sessionId   TEXT PRIMARY KEY,
  runId       TEXT NOT NULL,      -- Mastra workflow run ID (persisted by @mastra/cloudflare-d1)
  orgId       TEXT NOT NULL,
  isNodeId    TEXT,               -- IS-* node id, set after step 5 completes
  createdAt   TEXT NOT NULL
);
```

### HTTP Surface

| Method | Path | Contract |
|--------|------|----------|
| `POST` | `/signal` | Parse `CommissioningSignalSchema` → create Mastra workflow run → persist `sessionId → runId` in sessions table → return `202 { sessionId, runId }` |
| `GET` | `/signal/:sessionId` | Read runId → rehydrate Mastra Run via `D1Store` → return `{ phase, status, isNodeId? }` |
| `POST` | `/divergence` | Parse `DivergenceNotificationSchema` → if run suspended: `run.resume(payload)`; else: run hypothesis-formation handler → return `202` |

### DO↔Mastra Run lifecycle

The Mastra workflow run persists its own state to D1 via `@mastra/cloudflare-d1` (`D1Store` on `DB` binding).

**Create:** `const run = await caWorkflow.createRunAndStart({ input: signal })`  
**Persist:** store `run.runId` in the sessions table  
**Rehydrate:** `const run = caWorkflow.getRunById(runId)` — reads state from D1, no re-execution  
**Suspend:** workflow step 6 calls `workflow.suspend(payload)` → run status becomes `'suspended'`  
**Resume:** DO receives `POST /divergence` → `await run.resume({ payload: divergenceNotification })`  

If the DO is evicted between request and resume, the D1-persisted state survives. On the next request, `getRunById` rehydrates from D1 before any operation.

---

## `buildPlannerAgent` — new gears export

**File:** `packages/gears/src/agents/planner-agent.ts` (new)  
**Exported from:** `packages/gears/src/index.ts`

`buildConductingAgent` is designed for atom execution: it requires an `AtomDirective`, a CoordinatorDO stub, and a Think workspace for file/execute tools. Compiler passes need none of these — they have no tool calls, only structured LLM inference.

```typescript
export interface PlannerAgentEnv {
  DB: D1Database                   // @mastra/cloudflare-d1 observational memory
  CLOUDFLARE_ACCOUNT_ID: string
  CF_API_TOKEN: string
}

export function buildPlannerAgent(
  role: 'planner',                 // extensible; only 'planner' used today
  env: PlannerAgentEnv,
): Agent
```

**Differences from `buildConductingAgent`:**
- No `tools` (no workspace, no execute, no sandbox)
- No `ConsentBeadAuditProcessor` (no tool calls to gate)
- No `CommitTracingProcessor`
- Retains: `UnicodeNormalizer`, `PromptInjectionDetector`, `ModerationProcessor`, `PIIDetector`
- Retains: `@mastra/memory` with `D1Store` (observational memory across passes in the same session)
- Model: `MODEL_BY_ROLE['planner']` — Opus 4.6

**Scope note:** `packages/gears` is in scope for this spec solely to add `buildPlannerAgent`. No other gears changes.

---

## Mastra Workflow: ca-compiler-workflow

**File:** `packages/commissioning-agent/src/workflow/ca-compiler-workflow.ts`  
**Import:** `import { createWorkflow, createStep } from '@mastra/core/workflows'`

Input: `CommissioningSignal`  
Output: `{ isNodeId: string, runId: string, suspended: boolean }`

### Step 1 — fetch-elucidation-artifact

```
Input:  { elucidationArtifactId: string }
Action: artifactGraphDO stub RPC call → stub.getNode(elucidationArtifactId)
Output: ElucidationContent { id, data: { description, repoId, context, ... } }
Gate:   if null → workflow.fail('elucidation-artifact-not-found', { id: elucidationArtifactId })
```

Note: `getNode` is a DO RPC method, not an HTTP route. The workflow must hold a typed `DurableObjectStub<FactoryArtifactGraphDO>`.

### Step 2 — synthesize-pressure

```
Input:  ElucidationContent, signal.dispositionEventId, signal.orgId
Action: buildPlannerAgent('planner', env)
System: "You are a Pressure Synthesizer. Given a signal, identify and name the force it
         exerts on the system. A Pressure is the interpreted meaning of the signal — what
         it demands of the system, not the signal data itself."
User:   JSON of elucidation content
Output schema (Zod-validated before persist):
  PressureArtifact {
    id:            string matching /^PRS-/
    kind:          'pressure'
    title:         string (min 1)
    description:   string (min 1)   // the force the signal exerts
    priority:      'critical' | 'high' | 'medium' | 'low'
    category:      string (min 1)
    sourceSignalId: string           // = dispositionEventId
    evidence:      string[]
  }
Persist: artifactGraphDO.upsertNode(artifact.id, 'pressure', {
           ...artifactData,
           orgId: signal.orgId,
           sessionId: signal.sessionId,
         })
         artifactGraphDO.upsertEdge(artifact.id, signal.dispositionEventId, 'produced_at')
Gate:    schema validation fail → workflow.fail('pressure-synthesis-failed')
```

### Step 3 — map-capability

```
Input:  PressureArtifact
Action: buildPlannerAgent('planner', env)
System: "You are a Capability Mapper. Given a Pressure, name the system ability needed
         to address it. A Capability is what the system must be able to do — not the
         solution. 'Cache API responses' is a Capability. 'Add Redis' is a solution."
User:   JSON of pressure artifact
Output schema:
  CapabilityArtifact {
    id:               string matching /^BC-/
    kind:             'capability'
    title:            string (min 1)
    description:      string (min 1)   // what the system must be able to do
    gapAnalysis:      string (min 1)   // what is missing today
    sourcePressureId: string
    orgId:            string
    sessionId:        string
  }
Persist: artifactGraphDO.upsertNode(artifact.id, 'capability', artifactData)
         artifactGraphDO.upsertEdge(artifact.id, pressureId, 'governs')
Gate:    schema fail → workflow.fail('capability-mapping-failed')
```

### Step 4 — propose-function

```
Input:  CapabilityArtifact
Action: buildPlannerAgent('planner', env)
System: "You are a Function Proposer. Given a Capability, propose one concrete Factory
         function that delivers it. State testable success criteria."
User:   JSON of capability artifact
Output schema:
  FunctionProposal {
    id:                 string matching /^FP-/
    kind:               'function-proposal'
    title:              string (min 1)
    description:        string (min 1)
    rationale:          string (min 1)
    successCriteria:    string[] (min 1)
    sourceCapabilityId: string
    orgId:              string
    sessionId:          string
  }
Persist: artifactGraphDO.upsertNode(artifact.id, 'function-proposal', artifactData)
         artifactGraphDO.upsertEdge(artifact.id, capabilityId, 'governs')
Gate:    successCriteria.length === 0 → workflow.fail('no-success-criteria')
```

### Step 5 — compile-prd

```
Input:  FunctionProposal, signal.orgId, signal.repoId
Action: buildPlannerAgent('planner', env)
System: "You are a PRD author. Given a FunctionProposal, produce a complete
         IntentSpecification. Every acceptance criterion must be testable."
User:   JSON of function proposal
Output: IntentSpecification — must satisfy ALL of:
  {
    id:                  string matching /^IS-/
    version:             string
    orgId:               string
    repoId:              string
    problem:             string (min 1)
    goal:                string (min 1)
    acceptanceCriteria:  string[] (min 1)
    successMetrics:      string[] (min 1)
    constraints:         string[]
    outOfScope:          string[]
    sourceFunctionId:    string    // = FP-* id
    sourceCapabilityId:  string    // = BC-* id
  }
Persist: artifactGraphDO.upsertNode(artifact.id, 'intent-specification', artifactData)
         artifactGraphDO.upsertEdge(artifact.id, functionProposalId, 'governs')
Gate:    Zod-validate all required fields; fail on missing problem/goal/acceptanceCriteria/successMetrics
```

### Step 6 — human-approval-gate

```
Input:  { requireHumanApproval: boolean, isNodeId: string }
Action: if requireHumanApproval:
          workflow.suspend({
            reason: 'human-approval-required',
            isNodeId,
            sessionId: signal.sessionId,
          })
        // execution halts here until POST /divergence resumes it
```

### Step 7 — emit-to-mediation

```
Input:  IntentSpecification, CommissioningSignal
Action: Build CommissionRequest body:
  {
    runId:               'RUN-' + hex(sha256(`${orgId}:${isNodeId}:${dispositionEventId}`))
    orgId:               signal.orgId
    workGraphId:         isNodeId          // IS-* serves as the work graph reference
    workGraphVersion:    signal.workGraphVersion ?? 'v1'
    eluciationArtifactId: signal.elucidationArtifactId  // note: Mediation schema has this typo
    d1ArtifactRefs:      []
    dispositionEventId:  signal.dispositionEventId
  }
        POST MEDIATION_AGENT stub → /commission
Output: { status: 'seeded' | 'queued', runId, atomCount }
Gate:   non-2xx → workflow.fail('mediation-emit-failed', { status, body })
```

---

## Schema Changes

**File:** `packages/commissioning-agent/src/schemas.ts`

### Remove entirely
- `CandidateSet` interface — deliberation is deleted
- `WorkGraph` interface — the graph is in ArtifactGraphDO, not a serialized blob
- `ExecutionApproach`, `ExecutionApproachList` — replaced by structured pass outputs

### Update `Phase` type
```typescript
export type Phase =
  | 'idle'
  | 'commissioning'         // workflow running (steps 1–5)
  | 'suspended-approval'    // step 6 suspend()
  | 'hypothesis-formation'  // /divergence handler active
  | 'amendment-proposal'    // amendment handler active
```

### Update `SessionContext`
```typescript
export interface SessionContext {
  orgId: string
  currentPhase: Phase
  activeRunId: string | null    // Mastra workflow run ID
  isNodeId: string | null       // IS-* set after step 5 completes
  lastSignalAt: string | null
  lastDivergenceAt: string | null
  updatedAt: string
}
```

### Update `Amendment`
```typescript
// workGraphId → specificationId (WorkGraph is retired)
export interface Amendment {
  id: string
  hypothesisId: string
  specificationId: string | null   // was workGraphId
  proposedChange: unknown
  status: 'CANDIDATE' | 'ACCEPTED' | 'REJECTED'
  producedAt: string
}
```

### Add compiler pass output types
```typescript
export const PressureArtifactSchema = z.object({
  id: z.string().regex(/^PRS-/),
  kind: z.literal('pressure'),
  title: z.string().min(1),
  description: z.string().min(1),
  priority: z.enum(['critical', 'high', 'medium', 'low']),
  category: z.string().min(1),
  sourceSignalId: z.string().min(1),
  evidence: z.array(z.string()),
  orgId: z.string().min(1),
  sessionId: z.string().min(1),
})
export type PressureArtifact = z.infer<typeof PressureArtifactSchema>

export const CapabilityArtifactSchema = z.object({
  id: z.string().regex(/^BC-/),
  kind: z.literal('capability'),
  title: z.string().min(1),
  description: z.string().min(1),
  gapAnalysis: z.string().min(1),
  sourcePressureId: z.string().min(1),
  orgId: z.string().min(1),
  sessionId: z.string().min(1),
})
export type CapabilityArtifact = z.infer<typeof CapabilityArtifactSchema>

export const FunctionProposalSchema = z.object({
  id: z.string().regex(/^FP-/),
  kind: z.literal('function-proposal'),
  title: z.string().min(1),
  description: z.string().min(1),
  rationale: z.string().min(1),
  successCriteria: z.array(z.string()).min(1),
  sourceCapabilityId: z.string().min(1),
  orgId: z.string().min(1),
  sessionId: z.string().min(1),
})
export type FunctionProposal = z.infer<typeof FunctionProposalSchema>
```

### Keep unchanged
- `CommissioningSignalSchema` (domainProfile already removed, repoId already added)
- `DivergenceNotificationSchema`
- `WorkspaceWriteSchema`
- `HypothesisNode`
- `CycleContext`

---

## ArtifactGraphDO Write Pattern

`ArtifactGraphDOBase.upsertNode` signature is **3 args**: `(id: string, type: NodeType, data: Record<string, unknown>)`. The namespace is hardcoded to `this.config.namespace` (`'factory'` in `FactoryArtifactGraphDO`).

Per-session scoping is achieved via data fields — every commissioning artifact carries `orgId` and `sessionId` in its `data` object. Queries filter by these fields, not by namespace.

All calls from the workflow use **DO stub RPC** (not HTTP fetch):
```typescript
const stub = env.ARTIFACT_GRAPH.get(env.ARTIFACT_GRAPH.idFromName('factory-artifact-graph'))
await stub.upsertNode(artifact.id, 'pressure', artifactData)
await stub.upsertEdge(artifact.id, sourceId, 'produced_at')
```

---

## Package Dependencies

**`packages/commissioning-agent/package.json`** — add:
```json
"@factory/gears": "workspace:*",
"@factory/factory-graph": "workspace:*",
"@mastra/core": "latest",
"@mastra/cloudflare-d1": "latest",
"@mastra/memory": "latest"
```

Remove:
```json
"@cloudflare/think": "latest",
"@ai-sdk/openai": "^3.0.0",
"ai": "^6.0.0"
```

**`packages/gears/package.json`** — no new deps required.

---

## File Inventory

### Deleted
| File | Reason |
|------|--------|
| `src/skill-registry.ts` | No vertical routing |
| `src/phases/deliberation.ts` | Replaced by steps 2–4 |
| `src/phases/workgraph-authoring.ts` | Replaced by steps 2–5 |
| `src/phases/pattern-appraisal.ts` | Replaced by step 1 |
| `src/bundled-skills-manifest.ts` | Skills are system prompts |
| `src/skills/` directory | Same |
| `src/health-document.ts` | References old phase/domain model |

### Rewritten
| File | Change |
|------|--------|
| `src/index.ts` | `DurableObject` not `Think`. Drop alarm, drop phase machine, drop Think overrides. Add Mastra Run lifecycle + sessions SQLite table. |
| `src/schemas.ts` | Remove WorkGraph/CandidateSet/ExecutionApproach. Add PressureArtifact/CapabilityArtifact/FunctionProposal schemas. Update Phase, SessionContext, Amendment. |
| `src/env.ts` | Remove `OFOX_API_KEY`. Add `MEDIATION_AGENT` namespace if missing. Existing `DB`, `ARTIFACT_GRAPH`, `KV_KS` stay. |
| `src/phases/amendment-proposal.ts` | `workGraphId` → `specificationId`. |
| `src/phases/hypothesis-formation.ts` | Remove `WorkGraph` reference in amendment scope description. |

### New
| File | Purpose |
|------|---------|
| `src/workflow/ca-compiler-workflow.ts` | Mastra workflow: createWorkflow + createStep, steps 1–7 |
| `src/workflow/steps/fetch-elucidation.ts` | Step 1 |
| `src/workflow/steps/synthesize-pressure.ts` | Step 2 |
| `src/workflow/steps/map-capability.ts` | Step 3 |
| `src/workflow/steps/propose-function.ts` | Step 4 |
| `src/workflow/steps/compile-prd.ts` | Step 5 |
| `src/workflow/steps/emit-to-mediation.ts` | Step 7 |
| `packages/gears/src/agents/planner-agent.ts` | buildPlannerAgent factory |

### Unchanged
| File | Note |
|------|------|
| `src/phases/hypothesis-formation.ts` | Minor: remove WorkGraph ref in prose |
| `src/phases/index.ts` | Update exports |

---

## Env Changes

**Remove:**
- `OFOX_API_KEY: SecretsStoreSecret` — model routing is in `MODEL_BY_ROLE` / gears

**Keep:**
- `DB: D1Database` — serves both D1_AUDIT and `@mastra/cloudflare-d1` workflow state (same binding, table-namespaced by Mastra internally)
- `ARTIFACT_GRAPH: DurableObjectNamespace` — already present
- `MEDIATION_AGENT: DurableObjectNamespace` — already present
- All other existing bindings

---

## Definition of Done

**L1 — Typecheck:** `pnpm --filter @factory/commissioning-agent typecheck` exits 0.

**L2 — No forbidden patterns in any surviving file:**
- Zero imports of `@cloudflare/think` in `src/index.ts`
- Zero imports of `@ai-sdk/openai` or `ai` in any file
- Zero references to `ArangoDB`, `db.save`, `db.saveEdge`
- Zero references to `skill-registry`, `resolveSkillRefs`, `domainProfile`, `vertical`
- Zero raw `generateText` calls

**L3 — Schema integrity:**
- `WorkGraph` not exported from `schemas.ts`
- `CandidateSet` not exported from `schemas.ts`
- `PressureArtifact`, `CapabilityArtifact`, `FunctionProposal` all Zod-validated with `.parse()`

**L4 — Gears typecheck:** `pnpm --filter @factory/gears typecheck` exits 0 with new `planner-agent.ts` and updated exports.

**L5 — E2E bootstrap signal (acceptance):**
- Bootstrap signal (`repoId: 'function-factory'`, no vertical) dispatched
- Steps 1–5 each produce a schema-valid artifact in ArtifactGraphDO
- `GET /signal/:sessionId` returns `{ phase: 'suspended-approval' }` when `requireHumanApproval: true`
- After `POST /divergence` resume: step 7 fires, MediationAgentDO returns `status: 'seeded'`

---

## Out of Scope

- `workers/ff-pipeline` stages — separate execution path, not changed
- `packages/compiler` — CA does not call it directly (Mediation owns compilation)
- `packages/gears` beyond adding `planner-agent.ts` and updating index exports
- `packages/mediation-agent` — `/commission` endpoint schema accepted as-is; CA maps IS-* to `workGraphId`
- `workers/ff-gateway` — signals-handler already updated
- SPEC-FF-MASTRA-001 T4 evaluation framework — unchanged
