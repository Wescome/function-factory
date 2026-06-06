# CycleAwarenessService + Health Document Specification
**ID**: SPEC-FF-CYCLE-HEALTH-001
**Status**: Draft — pending Architect sign-off
**Date**: 2026-06-05
**Layer**: I-layer runtime — We-layer cadence + observability
**Packages**: `packages/linear-sync/src/` (health document — P4 already
              specified in SPEC-LINEAR-SYNC-SERVICE-001 §5, implemented here),
              `packages/commissioning-agent/src/` (cycle awareness)
**No new package required**

---

## 0. Why these two are one spec

Direction 4 (cycle cadence) and Direction 6 (health document) share one
dependency: both need to read the current Linear cycle. The
`CycleAwarenessService` is the shared component. Speccing them together
avoids duplicating the cycle API access pattern.

---

## 1. CycleAwarenessService

### 1.1 What it does

`CycleAwarenessService` is a lightweight read-only service that:

1. Reads the current active cycle for the WeOps team from Linear
2. Caches the result in CF KV with a 1-hour TTL (cycles don't change
   mid-day; re-fetching every poll would be wasteful)
3. Returns a `CycleContext` to callers

It is not a Worker — it is a module imported by the Commissioning Agent
Worker and the LinearSyncService Worker. Both call it; neither owns it.

### 1.2 CycleContext

```typescript
// packages/linear-sync/src/cycle-awareness.ts
// Also imported by packages/commissioning-agent/src/

export type CycleContext = {
  cycleId: string
  cycleName: string            // e.g. "Sprint 14"
  startsAt: string             // ISO 8601
  endsAt: string               // ISO 8601
  daysRemaining: number        // floored integer; 0 = last day
  isLastTwoDays: boolean       // daysRemaining <= 2
  isCycleEnd: boolean          // daysRemaining === 0
}

export async function getCycleContext(
  teamId: string,
  kv: KVNamespace,
  linearApiKey: string
): Promise<CycleContext | null> {
  // 1. Check KV cache
  const cached = await kv.get(`cycle-context:${teamId}`)
  if (cached) return JSON.parse(cached) as CycleContext

  // 2. Fetch from Linear
  const result = await fetchActiveCycle(teamId, linearApiKey)
  if (!result) return null

  const now = Date.now()
  const endsAt = new Date(result.endsAt).getTime()
  const daysRemaining = Math.floor((endsAt - now) / (1000 * 60 * 60 * 24))

  const context: CycleContext = {
    cycleId: result.id,
    cycleName: result.name,
    startsAt: result.startsAt,
    endsAt: result.endsAt,
    daysRemaining,
    isLastTwoDays: daysRemaining <= 2,
    isCycleEnd: daysRemaining === 0,
  }

  // 3. Cache for 1 hour
  await kv.put(`cycle-context:${teamId}`, JSON.stringify(context), {
    expirationTtl: 3600
  })

  return context
}

async function fetchActiveCycle(
  teamId: string,
  apiKey: string
): Promise<{ id: string; name: string; startsAt: string; endsAt: string } | null> {
  const query = `
    query ActiveCycle($teamId: String!) {
      team(id: $teamId) {
        activeCycle {
          id
          name
          startsAt
          endsAt
        }
      }
    }
  `
  const response = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': apiKey,
    },
    body: JSON.stringify({ query, variables: { teamId } }),
  })

  const data = await response.json() as {
    data?: { team?: { activeCycle?: { id: string; name: string; startsAt: string; endsAt: string } } }
  }
  return data.data?.team?.activeCycle ?? null
}
```

### 1.3 No cycle → no deferral

If no active cycle exists in Linear (`activeCycle` is null), advisory
Hypotheses are surfaced immediately rather than deferred. The cadence
discipline requires cycles to be configured. If they aren't, the system
defaults to always-on advisory surfacing — the less disciplined but
not broken behavior.

---

## 2. Direction 4 — Cycle-Based Advisory Surfacing

### 2.1 Where it lives

In the Commissioning Agent's polling loop, which runs as a CF Workflow
or Cron Trigger (to be wired per open item in SPEC-COMMISSIONING-
AGENT-001). The cycle check runs on every poll cycle alongside the
standard Divergence classification.

### 2.2 Polling loop addition

```typescript
// packages/commissioning-agent/src/commissioning-agent.ts
// Added to the polling loop (§3.2 of SPEC-COMMISSIONING-AGENT-001)

async function runPollCycle(repoId: string, env: Env): Promise<void> {
  // ... existing: get Mediation Agent state, classify Divergences ...

  const cycle = await getCycleContext(env.LINEAR_TEAM_ID, env.FACTORY_LINEAR_KV, env.LINEAR_API_KEY)

  // Advisory Hypotheses queued in ArangoDB but not yet surfaced to Linear
  const pendingAdvisories = await loadPendingAdvisoryHypotheses(repoId, env)

  for (const hyp of pendingAdvisories) {
    if (!cycle || cycle.isLastTwoDays) {
      // Surface now: create/update Linear issue with factory:cycle-boundary label
      await surfaceAdvisoryHypothesis(hyp, cycle, env)
    }
    // else: leave in ArangoDB queue; surface at cycle boundary
  }

  // Cycle end: reconciliation
  if (cycle?.isCycleEnd) {
    await runCycleReconciliation(repoId, cycle, env)
  }
}
```

### 2.3 Advisory surfacing

When `cycle.isLastTwoDays || !cycle`:

```typescript
async function surfaceAdvisoryHypothesis(
  hyp: Hypothesis,
  cycle: CycleContext | null,
  env: Env
): Promise<void> {
  // Check if already has a Linear issue
  const binding = await getLinearBinding(hyp.hypothesisId, env)
  if (binding) return  // already surfaced

  // Create Linear issue for this advisory Hypothesis
  await fetch(`${env.LINEAR_SYNC_URL}/sync/advisory-hypothesis`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      hypothesisId: hyp.hypothesisId,
      repoId: hyp.repoId,
      divergenceId: hyp.divergenceId,
      hypothesisContent: hyp.content,
      cycleId: cycle?.cycleId,
      cycleName: cycle?.cycleName,
      surfacedBecause: cycle?.isLastTwoDays ? 'cycle-boundary' : 'no-active-cycle',
    }),
  })

  // Mark as surfaced in ArangoDB
  await markHypothesisSurfaced(hyp.hypothesisId, env)
}
```

### 2.4 New LinearSyncService endpoint: POST /sync/advisory-hypothesis

```typescript
type AdvisoryHypothesisSyncRequest = {
  hypothesisId: string       // HYP-* ref
  repoId: string
  divergenceId: string       // DIV-* ref
  hypothesisContent: string
  cycleId?: string
  cycleName?: string
  surfacedBecause: 'cycle-boundary' | 'no-active-cycle'
}
```

Creates a Linear issue:

```typescript
{
  title: `[ADVISORY] ${hypothesisId} — ${repoId}`,
  teamId: LINEAR_TEAM_ID,
  projectId: FACTORY_PROJECT_ID,
  milestoneId: cycle?.cycleId,    // assigns to current cycle if available
  stateId: BACKLOG_STATE_ID,
  labelIds: [LABEL_FACTORY_ADVISORY, LABEL_FACTORY_CYCLE_BOUNDARY],
  description: buildAdvisoryDescription(request),
}
```

**Description template:**

```markdown
## Advisory Hypothesis
**Hypothesis**: {hypothesisId}
**Repo**: `{repoId}`
**Surfaced**: {surfacedBecause === 'cycle-boundary' ? `cycle boundary ({cycleName})` : 'no active cycle'}

## Hypothesis Content
{hypothesisContent}

## Linked Divergence
See divergence issue for evidence and Elucidation Artifact.

## Action
This is an advisory item — execution is not blocked. Review and decide:
- Accept the hypothesis and propose an Amendment
- Reject the hypothesis (close this issue with rationale)
- Defer to next cycle (add `factory:carried-over` label)

## Identity
- Hypothesis ID: `{hypothesisId}`
- Divergence ID: `{divergenceId}`
```

### 2.5 Cycle reconciliation

At `isCycleEnd`, the Commissioning Agent runs a reconciliation for the
closing cycle:

```typescript
async function runCycleReconciliation(
  repoId: string,
  cycle: CycleContext,
  env: Env
): Promise<void> {
  // 1. Find all advisory issues in this cycle that are not Done/Cancelled
  const openAdvisories = await getOpenCycleAdvisories(cycle.cycleId, env)

  for (const issue of openAdvisories) {
    // Add factory:carried-over label
    await linearClient.addLabel(issue.linearIssueInternalId, LABEL_CARRIED_OVER)
  }

  // 2. Produce VCR for cycle close
  await writeVCR({
    dispositionEventType: 'cycle-close',
    repoId,
    verdict: 'favorable',
    verdictSource: 'cycle-reconciliation',
    linkedArtifacts: openAdvisories.map(i => i.hypothesisId),
    metadata: {
      cycleId: cycle.cycleId,
      openAdvisoryCount: openAdvisories.length,
      carriedOverCount: openAdvisories.length,
    },
  }, env)

  // 3. If open advisories recurred from previous cycle:
  // check if any HYP-* has been carried over >= 2 consecutive cycles
  const recurringHypotheses = await findRecurringAdvisories(repoId, 2, env)
  if (recurringHypotheses.length > 0) {
    // Surface to Architect Agent as a cross-cycle anomaly signal
    await notifyArchitectAgent(recurringHypotheses, env)
  }
}
```

**Recurring advisory escalation to Architect Agent.** A Hypothesis
that has been carried over across two consecutive cycles without
resolution is a signal that the advisory is either: (a) a systematic
pattern requiring pipeline configuration changes (D4), or (b) a
Hypothesis that the team has implicitly decided not to act on, which
should be formally rejected rather than perpetually deferred.

The Architect Agent receives the recurring advisory list and adds it to
its next D4 anomaly scan input. This closes the feedback loop between
the We-layer governance cadence and the Factory's pipeline configuration.

---

## 3. Direction 6 — Health Document Implementation

### 3.1 Where P4 lives

`packages/linear-sync/src/p4-health-document.ts` — already specified
in SPEC-LINEAR-SYNC-SERVICE-001 §5. This section covers only the
implementation additions needed to wire it to the cycle context.

### 3.2 Cycle context in the health document

The health document gains one section when cycle context is available:

```markdown
## Current Cycle
**{cycleName}** — {daysRemaining} days remaining
{isLastTwoDays ? '⚠️ Cycle boundary approaching — advisory items will be surfaced' : ''}

Advisory items queued (not yet surfaced): {queuedAdvisoryCount}
Advisory items surfaced this cycle: {surfacedAdvisoryCount}
Carried over from last cycle: {carriedOverCount}
```

### 3.3 HealthSyncRequest addition

```typescript
// Addition to HealthSyncRequest in SPEC-LINEAR-SYNC-SERVICE-001 §5.3
type HealthSyncRequest = {
  // ... existing fields ...
  cycleContext?: CycleContext        // null if no active cycle
  advisoryMetrics: {
    queued: number                   // in ArangoDB, not yet surfaced
    surfacedThisCycle: number        // surfaced in current cycle
    carriedOver: number              // carried over from last cycle
  }
}
```

### 3.4 Daily history snapshot

The `p4-health-document.ts` handler already specifies appending a
daily snapshot to `Factory Health — History` at midnight. The snapshot
format is identical to the live document but timestamped and immutable.
The midnight trigger is a CF Cron Trigger on the `linear-sync` Worker:

```toml
# wrangler.toml addition for linear-sync worker
[[triggers.crons]]
cron = "0 0 * * *"    # midnight UTC daily
```

The cron handler reads the current `HealthSyncRequest` from ArangoDB
(the Architect Agent always writes the latest health state there on each
scan) and appends the snapshot.

---

## 4. Summary of Changes by File

| File | Change type | Description |
|------|------------|-------------|
| `packages/linear-sync/src/cycle-awareness.ts` | New file | `CycleAwarenessService` — reads Linear active cycle, caches in KV |
| `packages/linear-sync/src/p4-health-document.ts` | Additive | Add cycle section to live document; daily history snapshot via cron |
| `packages/linear-sync/src/index.ts` | Additive | Route `POST /sync/advisory-hypothesis`; add cron handler |
| `packages/linear-sync/src/advisory-hypothesis-sync.ts` | New file | Handler for advisory Hypothesis issue creation |
| `packages/commissioning-agent/src/commissioning-agent.ts` | Additive | Cycle-aware advisory surfacing in polling loop; cycle reconciliation |
| `wrangler.toml` (linear-sync) | Additive | Midnight cron trigger for daily health snapshot |

---

## 5. Environment Bindings (additions)

**linear-sync Worker** (additions to existing bindings in
SPEC-LINEAR-SYNC-SERVICE-001 §11):

```typescript
{
  LINEAR_TEAM_ID: string          // already present
  FACTORY_LINEAR_KV: KVNamespace  // already present; also used for cycle cache
  // No new bindings needed
}
```

**commissioning-agent Worker** (additions to existing bindings in
SPEC-COMMISSIONING-AGENT-001 §8):

```typescript
{
  LINEAR_TEAM_ID: string          // new
  LINEAR_API_KEY: string          // new — read-only; only for cycle query
  LINEAR_SYNC_URL: string         // new — URL of linear-sync Worker
  FACTORY_LINEAR_KV: KVNamespace  // new — for cycle context cache
}
```

---

## 6. Open Items

| Item | Owner | Blocking |
|------|-------|---------|
| Cron trigger for polling loop — Commissioning Agent needs a CF Workflow or Cron; the cycle check runs inside the existing polling loop so no new cron is needed for Direction 4 specifically | Engineering | No |
| `getOpenCycleAdvisories()` — requires Linear API query for issues in a specific cycle with specific labels; needs the Linear GraphQL `cycle.issues` query | Engineering | No |
| `findRecurringAdvisories()` — ArangoDB query comparing HYP-* `surfacedAt` cycle IDs across two consecutive cycles; query pattern TBD | Engineering | No |
| Architect Agent notification endpoint for recurring advisories — `POST /recurring-advisories` not yet in SPEC-ARCHITECT-AGENT-DO-001 | Architect | No — Architect Agent can receive via existing anomaly scan ArangoDB reads |
| Linear cycle configuration — WeOps team must have cycles enabled and configured in Linear; this is a manual setup step | Wes | No |
