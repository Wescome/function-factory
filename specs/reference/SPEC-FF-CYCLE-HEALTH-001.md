# CycleAwarenessService + Health Document Specification
**ID**: SPEC-FF-CYCLE-HEALTH-001  
**Version**: 2.0  
**Date**: 2026-06-14  
**Status**: Draft — pending Architect sign-off  
**Layer**: I-layer runtime — We-layer cadence + observability  
**Packages**: `packages/linear-sync/src/` (health document + cycle awareness), `packages/commissioning-agent/src/` (advisory surfacing)  
**No new package required**  
**v1.0 → v2.0**: Commissioning Agent polling loop retired (WEO-13 cancelled). Replaced by push-based `/divergence` endpoint on `CommissioningAgentDO`. Advisory HYP-* now in ArtifactGraphDO (not ArangoDB). ArangoDB reads throughout → ArtifactGraphDO + D1. `findRecurringAdvisories()` query rewritten for ArtifactGraphDO. Architect Agent notification path updated.

---

## 0. Why these two are one spec

Direction 4 (cycle cadence) and Direction 6 (health document) share one dependency: both read the current Linear cycle. `CycleAwarenessService` is the shared component.

---

## 1. CycleAwarenessService

### 1.1 What it does

Lightweight read-only module imported by LinearSyncService and CommissioningAgentDO. Reads the active Linear cycle, caches in CF KV (1-hour TTL), returns `CycleContext`.

### 1.2 CycleContext

```typescript
// packages/linear-sync/src/cycle-awareness.ts
export type CycleContext = {
  cycleId: string
  cycleName: string
  startsAt: string
  endsAt: string
  daysRemaining: number
  isLastTwoDays: boolean    // daysRemaining <= 2
  isCycleEnd: boolean       // daysRemaining === 0
}

export async function getCycleContext(
  teamId: string,
  kv: KVNamespace,
  linearApiKey: string
): Promise<CycleContext | null> {
  const cached = await kv.get(`cycle-context:${teamId}`)
  if (cached) return JSON.parse(cached) as CycleContext

  const result = await fetchActiveCycle(teamId, linearApiKey)
  if (!result) return null

  const now = Date.now()
  const daysRemaining = Math.floor((new Date(result.endsAt).getTime() - now) / 86_400_000)

  const context: CycleContext = {
    cycleId: result.id,
    cycleName: result.name,
    startsAt: result.startsAt,
    endsAt: result.endsAt,
    daysRemaining,
    isLastTwoDays: daysRemaining <= 2,
    isCycleEnd: daysRemaining === 0,
  }

  await kv.put(`cycle-context:${teamId}`, JSON.stringify(context), { expirationTtl: 3600 })
  return context
}
```

### 1.3 No cycle → no deferral

If no active cycle: advisory Hypotheses surfaced immediately.

---

## 2. Direction 4 — Cycle-Based Advisory Surfacing

### 2.1 Where it lives

In `CommissioningAgentDO` — triggered via the `POST /divergence` endpoint (push-based, not polling). The cycle check runs when LoopClosureService pushes a Divergence notification to the CommissioningAgentDO, and also on a periodic Think session wake (DO alarm, every 6 hours during non-executing periods).

**WEO-13 is cancelled.** There is no CF Workflow / Cron polling loop. The CommissioningAgentDO uses DO hibernation and alarm for idle periods.

### 2.2 Advisory check (CommissioningAgentDO alarm handler)

```typescript
// CommissioningAgentDO — alarm fires every 6h when not executing
async alarm(): Promise<void> {
  const cycle = await getCycleContext(this.env.LINEAR_TEAM_ID, this.env.FACTORY_LINEAR_KV, this.env.LINEAR_API_KEY)

  // Load pending advisory Hypothesis nodes from ArtifactGraphDO
  const pendingAdvisories = await this.loadPendingAdvisoryHypotheses()

  for (const hyp of pendingAdvisories) {
    if (!cycle || cycle.isLastTwoDays) {
      await this.surfaceAdvisoryHypothesis(hyp, cycle)
    }
  }

  if (cycle?.isCycleEnd) {
    await this.runCycleReconciliation(cycle)
  }

  // Reschedule alarm
  await this.ctx.storage.setAlarm(Date.now() + 6 * 60 * 60 * 1000)
}
```

### 2.3 Loading pending advisory Hypotheses

Advisory Hypothesis nodes are in ArtifactGraphDO (appended by LoopClosureService BP4 during the amendment loop). "Pending" = `status: CANDIDATE` and `surfacedToLinear: false` in the DO SQLite `session_context` supplementary tracking table.

```typescript
private async loadPendingAdvisoryHypotheses(): Promise<HypothesisNode[]> {
  const artifactGraphDO = this.env.ARTIFACT_GRAPH.get(
    this.env.ARTIFACT_GRAPH.idFromName(`artifact-graph:${this.orgId}`)
  )
  const resp = await artifactGraphDO.fetch('/query/hypothesis?status=CANDIDATE&severity=advisory&surfaced=false')
  return (await resp.json()) as HypothesisNode[]
}
```

### 2.4 Advisory surfacing

```typescript
private async surfaceAdvisoryHypothesis(hyp: HypothesisNode, cycle: CycleContext | null): Promise<void> {
  await fetch(`${this.env.LINEAR_SYNC_URL}/sync/advisory-hypothesis`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      hypothesisNodeId: hyp.id,
      orgId: this.orgId,
      divergenceNodeId: hyp.divergenceNodeId,
      hypothesisContent: hyp.content,
      cycleId: cycle?.cycleId,
      cycleName: cycle?.cycleName,
      surfacedBecause: cycle?.isLastTwoDays ? 'cycle-boundary' : 'no-active-cycle',
    }),
  })

  // Mark surfaced in DO SQLite
  await this.markHypothesisSurfaced(hyp.id)
}
```

### 2.5 Cycle reconciliation

At `isCycleEnd`:

```typescript
private async runCycleReconciliation(cycle: CycleContext): Promise<void> {
  // 1. Find open advisory issues in this cycle (via Linear API)
  const openAdvisories = await this.getOpenCycleAdvisories(cycle.cycleId)
  for (const issue of openAdvisories) {
    await linearClient.addLabel(issue.linearIssueInternalId, LABEL_CARRIED_OVER)
  }

  // 2. Write VCR node to ArtifactGraphDO
  const artifactGraphDO = this.env.ARTIFACT_GRAPH.get(
    this.env.ARTIFACT_GRAPH.idFromName(`artifact-graph:${this.orgId}`)
  )
  await artifactGraphDO.fetch('/append', {
    method: 'POST',
    body: JSON.stringify({
      node: {
        nodeType: 'VerdictClosureRecord',
        dispositionEventType: 'cycle-close',
        orgId: this.orgId,
        verdict: 'favorable',
        verdictSource: 'cycle-reconciliation',
        cycleId: cycle.cycleId,
        openAdvisoryCount: openAdvisories.length,
        producedAt: new Date().toISOString(),
      }
    })
  })

  // 3. Check for recurring advisories (carried over >= 2 consecutive cycles)
  const recurringHypotheses = await this.findRecurringAdvisories(2)
  if (recurringHypotheses.length > 0) {
    await this.notifyCommissioningAgentOfRecurring(recurringHypotheses)
  }
}
```

### 2.6 Finding recurring advisories

Queries ArtifactGraphDO for Hypothesis nodes that have been marked `surfacedToLinear: true` in two consecutive cycle periods without being resolved (status still `CANDIDATE`).

```typescript
private async findRecurringAdvisories(consecutiveCycles: number): Promise<HypothesisNode[]> {
  const artifactGraphDO = this.env.ARTIFACT_GRAPH.get(
    this.env.ARTIFACT_GRAPH.idFromName(`artifact-graph:${this.orgId}`)
  )
  const resp = await artifactGraphDO.fetch(
    `/query/hypothesis?status=CANDIDATE&surfacedCycleCount_gte=${consecutiveCycles}`
  )
  return (await resp.json()) as HypothesisNode[]
}
```

Recurring advisories are surfaced to the CommissioningAgentDO's next `/divergence` handler run as high-priority inputs for Hypothesis re-evaluation — closing the feedback loop between We-layer governance cadence and Factory pipeline configuration.

---

## 3. Direction 6 — Health Document Implementation

### 3.1 Where P4 lives

`packages/linear-sync/src/p4-health-document.ts` — specified in SPEC-LINEAR-SYNC-SERVICE-001 v2.0 §5. This section covers the cycle context wiring.

### 3.2 Cycle context in the health document

```markdown
## Current Cycle
**{cycleName}** — {daysRemaining} days remaining
{isLastTwoDays ? '⚠️ Cycle boundary approaching — advisory items will be surfaced' : ''}

Advisory items queued (not yet surfaced): {advisoryMetrics.queued}
Advisory items surfaced this cycle: {advisoryMetrics.surfacedThisCycle}
Carried over from last cycle: {advisoryMetrics.carriedOver}
```

`advisoryMetrics` is read from CommissioningAgentDO DO SQLite `session_context` table at health push time.

### 3.3 Daily history snapshot

Midnight UTC cron on `linear-sync` Worker appends current health state to `Factory Health — History` document:

```toml
# wrangler.toml addition for linear-sync worker
[[triggers.crons]]
cron = "0 0 * * *"
```

The cron handler reads the latest `HealthSyncRequest` from D1 `factory-ops` `health_snapshots` table (written by LoopClosureService on each health push) and appends the timestamped snapshot.

---

## 4. New LinearSyncService endpoint: POST /sync/advisory-hypothesis

```typescript
type AdvisoryHypothesisSyncRequest = {
  hypothesisNodeId: string          // ArtifactGraphDO Hypothesis node ID
  orgId: string
  divergenceNodeId: string          // ArtifactGraphDO Divergence node ID
  hypothesisContent: string
  cycleId?: string
  cycleName?: string
  surfacedBecause: 'cycle-boundary' | 'no-active-cycle'
}
```

Creates Linear issue under current cycle milestone with `factory:advisory` + `factory:cycle-boundary` labels. Writes binding to D1 `factory-artifacts` `linear_bindings`.

---

## 5. Summary of Changes by File

| File | Change | Description |
|------|--------|-------------|
| `packages/linear-sync/src/cycle-awareness.ts` | New file | `CycleAwarenessService` — Linear active cycle + KV cache |
| `packages/linear-sync/src/p4-health-document.ts` | Additive | Cycle section in live document; daily history snapshot via cron |
| `packages/linear-sync/src/index.ts` | Additive | Route `POST /sync/advisory-hypothesis`; add cron handler |
| `packages/linear-sync/src/advisory-hypothesis-sync.ts` | New file | Advisory Hypothesis issue creation |
| `packages/commissioning-agent/src/commissioning-agent-do.ts` | Additive | `alarm()` handler: cycle-aware advisory surfacing + cycle reconciliation |
| `wrangler.toml` (linear-sync) | Additive | Midnight cron |

---

## 6. Environment Bindings (additions)

**linear-sync Worker** (additions to SPEC-LINEAR-SYNC-SERVICE-001 v2.0 §10):
```typescript
{ /* No new bindings — FACTORY_LINEAR_KV already present for cycle cache */ }
```

**CommissioningAgentDO** (additions to SPEC-FF-CA-SKILLS-001 §8):
```typescript
{
  LINEAR_TEAM_ID: string
  LINEAR_API_KEY: string          // read-only; cycle query only
  LINEAR_SYNC_URL: string
  FACTORY_LINEAR_KV: KVNamespace  // cycle context cache
  ARTIFACT_GRAPH: DurableObjectNamespace
}
```

---

## 7. Open Items

| Item | Blocking |
|------|---------|
| ArtifactGraphDO `/query/hypothesis` endpoint — filter by status, severity, surfaced, surfacedCycleCount | Yes |
| `surfacedCycleCount` tracking — ArtifactGraphDO Hypothesis node needs a `surfacedCycleCount` field incremented on each cycle reconciliation | Yes |
| D1 `factory-ops` `health_snapshots` table DDL | No |
| Linear cycle configuration — WeOps team must have cycles enabled | No — manual setup |
