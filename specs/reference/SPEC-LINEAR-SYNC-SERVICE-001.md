# LinearSyncService Specification
**ID**: SPEC-LINEAR-SYNC-SERVICE-001  
**Version**: 2.0  
**Date**: 2026-06-14  
**Status**: Draft — pending Architect sign-off  
**Layer**: I-layer runtime — Linear integration  
**Package**: `packages/linear-sync/`  
**Depends on**: `packages/schemas`, `@factory/knowing-state-sdk`, Linear GraphQL API  
**v1.0 → v2.0**: ArangoDB retired. `linear_bindings` → D1 `factory-artifacts`. Trigger caller corrected: `MediationAgentDO.alarm()` → CoordinatorDO `releaseBead()`/`failBead()` + LoopClosureService. `IssueBindingEvent` → ArtifactGraphDO. `linear_sync_errors` → D1 `factory-ops`. `ArchitectAgentDO.alarm()` → LoopClosureService health push. Storage topology updated throughout.

---

## 0. Conceptual Preamble

### 0.1 What LinearSyncService IS

One-way projection layer. The Factory's ArtifactGraphDO + D1 are the source of truth. Linear is a human-readable view maintained by this service.

| Responsibility | Source | Linear artifact |
|---|---|---|
| P1: Atom projection | `AtomDirective` node in ArtifactGraphDO (on CoordinatorDO seed) | Issue under WorkGraph milestone |
| P2: Trace state sync | `releaseBead()` / `failBead()` outcome (D1 bead audit rows) | Issue state transition |
| P3: Divergence projection | `Divergence` node in ArtifactGraphDO (LoopClosureService BP3) | Issue under parent atom issue |
| P4: Health document | `HealthSummary` push from LoopClosureService | Living Linear document |

### 0.2 What LinearSyncService is NOT

Not a webhook receiver. Not a governance decision-maker. Not the owner of Linear project/milestone structure.

### 0.3 Idempotency Principle

All operations are idempotent via a `linear_bindings` table in D1 `factory-artifacts`:

```typescript
// D1 factory-artifacts: linear_bindings table
type LinearBinding = {
  factory_artifact_id: string   // PRIMARY KEY: directiveId, divergenceId, etc.
  linear_issue_id: string       // WEO-N
  linear_issue_internal_id: string
  binding_type: 'atom' | 'divergence' | 'escalation' | 'health-document'
  work_graph_version: string
  created_at: string
  last_synced_at: string
  sync_status: 'ok' | 'error'
}
```

---

## 1. Architecture

LinearSyncService is a **stateless Cloudflare Worker** called by:

```
CoordinatorDO releaseBead() / failBead()
  → POST /sync/atoms          P1 + P2 (atom projection + trace state)
  → POST /sync/divergences    P3 (divergence projection)

LoopClosureService (after outcome_written + health push)
  → POST /sync/health         P4 (health document update)

CommissioningAgentDO (on escalation)
  → POST /sync/escalation     Creates escalation issue (D2 dependency)
```

All endpoints are internal. Worker calls Linear GraphQL API directly using a service account API key.

---

## 2. P1: Atom Projection

### 2.1 Trigger

Called from CoordinatorDO after `seedBeads()` completes for a new `runId`. One call per WorkGraph commission, carrying all `AtomDirective[]` nodes.

### 2.2 Input

```typescript
type AtomSyncRequest = {
  runId: string
  repoId: string
  workGraphId: string
  workGraphVersion: string
  policyBeadId: string
  projectId: string
  milestoneId: string
  atoms: AtomDirectiveRef[]           // lightweight refs: atomId + instruction + permittedTools + dependsOn
  eluciationArtifactId: string        // ELC-* node ID in ArtifactGraphDO (A9 content)
}
```

`milestoneId` resolved from D1 `factory-artifacts` `workgraph_milestone_bindings` table. Created if absent.

### 2.3 Issue creation

For each atom:
1. Check D1 `linear_bindings` for `factory_artifact_id = atom.atomId`
2. Binding exists + same `workGraphVersion` → skip
3. Binding exists + different version → label old issue `factory:superseded`, move to Cancelled, create new
4. No binding → create issue + write binding to D1

Issue description embeds `eluciationArtifactId` reference for A9 traceability. After all issues created, dependency links created via Linear GraphQL `issueRelationCreate`.

5. Write `IssueBindingEvent` node to ArtifactGraphDO:
```typescript
{
  nodeType: 'IssueBindingEvent',
  atomId: atom.atomId,
  runId,
  linearIssueId,
  linearIssueInternalId,
  workGraphVersion,
  producedAt,
}
```

---

## 3. P2: Trace State Sync

### 3.1 Trigger

Called after each `releaseBead()` or `failBead()` in CoordinatorDO. Carries the bead outcome.

### 3.2 State machine mapping

| Outcome | Linear state | Labels |
|---|---|---|
| `releaseBead()` (in_progress → done) | Done | `factory:success` |
| `failBead()`, `errorCode: 'recoverable'` (rescued by alarm) | In Review | `factory:retrying` |
| `failBead()`, `errorCode: 'governance_violation'` | Cancelled | `factory:divergence`, `factory:failure` |
| `failBead()`, `errorCode: 'provider_error'` (terminal) | Cancelled | `factory:failure` |
| Bead claimed (in_progress) | In Progress | — |

Success comment includes `commitSha` if present in bead audit row.

---

## 4. P3: Divergence Projection

### 4.1 Trigger

Called from LoopClosureService BP3 after a Divergence node is written to ArtifactGraphDO.

### 4.2 Input

```typescript
type DivergenceSyncRequest = {
  repoId: string
  workGraphVersion: string
  divergenceId: string          // DIV-* ArtifactGraphDO node ID
  atomId: string
  detectorId: string            // INV-* ref
  severity: 'blocking' | 'advisory' | 'informational'
  evidence: {
    rawOutputFragment: string
    traceNodeId: string         // ExecutionTrace node ID in ArtifactGraphDO
  }
  eluciationArtifactId: string
}
```

### 4.3 Issue creation

Checks D1 `linear_bindings`. If no binding: creates issue as child of parent atom issue. Divergence lifecycle updates (Hypothesis → comment, Amendment → status, resolution → Done) delivered via `POST /sync/hypothesis` and `POST /sync/divergence-closed`.

---

## 5. P4: Health Document

### 5.1 Trigger

Called from LoopClosureService health push after each governance cycle or lifecycle state change.

### 5.2 Document management

Two Linear documents per Factory deployment:
- `Factory Health — Live`: current-state, full-replace each call
- `Factory Health — History`: append-only daily snapshot at midnight

Document IDs stored in CF KV (`FACTORY_LINEAR_KV`) under `health-doc-live-id` and `health-doc-history-id`.

### 5.3 Input

```typescript
type HealthSyncRequest = {
  factoryLifecycleState: string
  activeRepos: RepoHealthSummary[]
  openDivergences: { blocking: number; advisory: number; informational: number }
  openEscalations: EscalationSummary[]
  activePatches: PatchSummary[]
  pendingCrpCount: number
  pipelineConfig: PipelineConfig
  cycleContext?: CycleContext          // from CycleAwarenessService (§6)
  advisoryMetrics: {
    queued: number
    surfacedThisCycle: number
    carriedOver: number
  }
  producedAt: string
}
```

Source of data: CoordinatorDO DO SQLite (bead states), ArtifactGraphDO (Divergence/Amendment/Verdict nodes), D1 `factory-ops` (escalation rows, patch rows).

---

## 6. Escalation Issue Creation

Called by CommissioningAgentDO when `LoopClosureService` triggers `escalateToWeLayer()`.

```typescript
type EscalationSyncRequest = {
  escalationId: string
  repoId: string
  escalationType: EscalationType
  requestedAction: string
  evidence: {
    divergenceIds?: string[]       // ArtifactGraphDO Divergence node IDs
    hypothesisNodeId?: string      // ArtifactGraphDO Hypothesis node ID
    amendmentNodeId?: string
  }
  linearDivergenceIssueIds: string[]
}
```

Labels per escalation type map to the same set as v1.0 (factory:escalation + requires-* labels). Description includes disposition comment template for `ff-linear-bridge`.

---

## 7. Linear Label Bootstrap

Same required labels as v1.0. Checked on startup; created if missing. Label bindings stored in `FACTORY_LINEAR_KV`.

---

## 8. Milestone Management

Per WorkGraph version → Linear milestone. Bindings in D1 `factory-artifacts` `workgraph_milestone_bindings` table (replaces KV milestone bindings from v1.0 — D1 supports richer queries for version change detection).

---

## 9. Rate Limiting and Batching

Same limits as v1.0: 50 issue creates / 100 state updates / 20 comments per flush call. Exponential backoff on 429 (1s → 16s, max 5 retries). All failures non-blocking for governance loop; logged to D1 `factory-ops` `linear_sync_errors` table.

---

## 10. Environment Bindings

```typescript
type Env = {
  LINEAR_API_KEY: string
  LINEAR_TEAM_ID: string
  LINEAR_PROJECT_ID: string
  ARTIFACT_GRAPH: DurableObjectNamespace   // ArtifactGraphDO — replaces ArangoDB
  FACTORY_DB: D1Database                   // D1 factory-artifacts + factory-ops
  FACTORY_LINEAR_KV: KVNamespace           // document IDs, label bindings, cycle cache
}
```

---

## 11. Package Structure

```
packages/linear-sync/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts
    ├── types.ts
    ├── label-bootstrap.ts
    ├── milestone-manager.ts         — D1 workgraph_milestone_bindings
    ├── binding-store.ts             — D1 linear_bindings CRUD
    ├── p1-atom-projection.ts
    ├── p2-trace-state-sync.ts
    ├── p3-divergence-projection.ts
    ├── p4-health-document.ts
    ├── escalation-sync.ts
    ├── advisory-hypothesis-sync.ts
    ├── commit-sha-sync.ts
    ├── cycle-awareness.ts           — CycleAwarenessService (SPEC-FF-CYCLE-HEALTH-001)
    ├── linear-client.ts
    └── error-log.ts                 — D1 factory-ops linear_sync_errors
```

---

## 12. Open Items

| Item | Blocking |
|------|---------|
| D1 `factory-artifacts` DDL for `linear_bindings` and `workgraph_milestone_bindings` tables | Yes |
| ArtifactGraphDO `IssueBindingEvent` node type registration | Yes |
| Linear state UUIDs (Backlog, In Progress, etc.) — discoverable at runtime, cache in KV | No |
| Linear GraphQL service account provisioning | No |
