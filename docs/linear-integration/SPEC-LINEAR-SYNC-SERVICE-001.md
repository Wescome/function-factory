# LinearSyncService Specification
**ID**: SPEC-LINEAR-SYNC-SERVICE-001
**Status**: Draft — pending Architect sign-off
**Date**: 2026-06-05
**Layer**: I-layer runtime — Linear integration
**Package**: `@factory/linear-sync`
**Depends on**: `@factory/schemas`, `@factory/knowing-state-sdk`,
               Linear GraphQL API (MCP or direct)

---

## 0. Conceptual Preamble

### 0.1 What LinearSyncService IS

LinearSyncService is the single responsible party for keeping Linear
consistent with the Factory's artifact graph. It is not a two-way sync
engine — it is a one-way projection layer. The Factory's ArangoDB graph is
the source of truth. Linear is a human-readable view over that graph,
maintained by this service.

The service has four projection responsibilities:

| Responsibility | Source artifact | Linear artifact |
|----------------|----------------|-----------------|
| P1: Atom projection | `AtomDirective` (on CommissionEvent) | Issue under WorkGraph milestone |
| P2: Trace state sync | `TraceEvent` (on Bead flush) | Issue state transition |
| P3: Divergence projection | `DivergenceEvent` (on Bead flush) | Issue under parent atom issue |
| P4: Health document | `HealthSummary` (on Architect Agent alarm) | Living Linear document |

Direction 5 (commit tracing) and Direction 4 (cycle cadence) are consumers
of this service, not part of it. Direction 2 (ff-linear-bridge) depends on
issues created by P1 and P3. This service creates them; the bridge reads them.

### 0.2 What LinearSyncService is NOT

It is not a webhook receiver. It does not receive events from Linear and
push them to the Factory. That is `ff-linear-bridge`'s responsibility
(SPEC-FF-LINEAR-BRIDGE-001, to be written).

It does not own the Linear project, team, or milestone structure. Those
are created manually or by a one-time bootstrap script. This service
operates within an existing project structure.

It does not make governance decisions. It projects what the Factory has
already decided. If an atom fails, this service updates the Linear issue
to reflect that failure — it does not decide how to respond.

### 0.3 Idempotency Principle

Every operation this service performs must be idempotent. The Factory's
event log may replay events (e.g., on DO wake after hibernation, during
Bead flush retry). Linear must not end up with duplicate issues or
duplicate state transitions.

Idempotency is enforced via a binding table in ArangoDB:

```typescript
// ArangoDB collection: linear_bindings
type LinearBinding = {
  _key: string             // factory artifact ID (directiveId, divergenceId, etc.)
  linearIssueId: string    // WEO-N identifier
  linearIssueInternalId: string  // Linear UUID (for API calls)
  bindingType: 'atom' | 'divergence' | 'escalation' | 'health-document'
  workGraphVersion: string
  createdAt: string
  lastSyncedAt: string
}
```

Before any Linear write, the service checks this table. If a binding
exists, it updates the existing issue. If not, it creates a new issue
and writes the binding.

---

## 1. Architecture

LinearSyncService is a **stateless Cloudflare Worker** invoked by three
callers:

```
MediationAgentDO alarm (Bead flush)
  → POST /sync/atoms         P1 + P2 (atom projection + trace state)
  → POST /sync/divergences   P3 (divergence projection)

ArchitectAgentDO alarm (15-min health scan)
  → POST /sync/health        P4 (health document update)

CommissioningAgent (on escalation)
  → POST /sync/escalation    Creates escalation issue (D2 dependency)
```

All endpoints are internal — not exposed to the public internet.

The Worker calls the Linear GraphQL API directly. It does not use the
Linear MCP in the runtime path (MCP is session-based; this Worker runs
on alarms without a user session). It uses a Linear API key stored in
CF Worker secrets.

---

## 2. P1: Atom Projection

### 2.1 Trigger

Called from `MediationAgentDO.alarm()` after Bead flush, once per
`CommissionEvent` in the flush batch.

### 2.2 Input

```typescript
type AtomSyncRequest = {
  repoId: string
  workGraphId: string
  workGraphVersion: string
  policyBeadId: string
  projectId: string          // Linear project ID
  milestoneId: string        // Linear milestone ID for this WorkGraph version
  atoms: AtomDirective[]
  elucidationArtifactId: string  // ELC-* ref — for A9 content in issue description
}
```

`milestoneId` is resolved by the service from a `WorkGraphMilestoneBinding`
table (see §5.1). If no milestone exists for this WorkGraph version, the
service creates one before creating atom issues.

### 2.3 Issue creation

For each `AtomDirective` in `atoms`:

1. Check `linear_bindings` for `_key: directive.directiveId`
2. If binding exists and `workGraphVersion` matches: skip (already synced)
3. If binding exists and `workGraphVersion` differs: this is a WorkGraph
   version change — label the old issue `factory:superseded`, move to
   `Cancelled` state, create a new issue for the new version
4. If no binding: create issue

**Issue fields:**

```typescript
{
  title: truncate(directive.instruction, 80),
  teamId: LINEAR_TEAM_ID,
  projectId: request.projectId,
  milestoneId: request.milestoneId,
  stateId: BACKLOG_STATE_ID,
  labelIds: [LABEL_FACTORY_ATOM, LABEL_FACTORY_ACTIVE],
  description: buildAtomDescription(directive, elucidationArtifact),
}
```

**Description template:**

```markdown
## Instruction
{directive.instruction}

## Execution parameters
- Permitted tools: {directive.permittedTools.join(', ')}
- Timeout: {directive.timeoutMs}ms
- Retry: {directive.retryPolicy.maxAttempts} attempts,
         isolated={directive.retryPolicy.isolatedRetry}
- Working dir: {directive.workingDir}

## Success condition
{renderSuccessCondition(directive.successCondition)}

## Dependencies
{directive.dependsOn.length > 0
  ? directive.dependsOn.map(id => `- ${id}`).join('\n')
  : 'None'}

## Identity
- Directive ID: `{directive.directiveId}`
- Atom ref: `{directive.atomRef}`
- WorkGraph: `{directive.workGraphVersion}`
- Policy Bead: `{request.policyBeadId}`

## Elucidation (A9)
At the time this WorkGraph was commissioned, the following alternatives
were considered:

{elucidationArtifact.candidateSet.workGraphVersions.map(v =>
  v === elucidationArtifact.selectedOption
    ? `- **${v}** ← selected`
    : `- ${v} — rejected: ${elucidationArtifact.rejectedOptions
        .find(r => r.workGraphVersion === v)?.rejectionReason ?? 'not recorded'}`
).join('\n')}
```

5. Write `LinearBinding` to ArangoDB
6. Append `IssueBindingEvent` to Mediation Agent DO event log:

```typescript
type IssueBindingPayload = {
  directiveId: string
  linearIssueId: string     // WEO-N
  linearIssueInternalId: string
  workGraphVersion: string
}
```

### 2.4 Dependency linking

After all atom issues are created, for each atom with non-empty `dependsOn`:

```graphql
mutation {
  issueRelationCreate(input: {
    issueId: $issueInternalId,
    relatedIssueId: $dependencyInternalId,
    type: blocks
  })
}
```

The `dependsOn` directive IDs are resolved to Linear internal IDs via
the `linear_bindings` table. If a dependency's binding does not yet
exist (possible if atoms are synced in an unexpected order), this step
is deferred and retried on the next flush.

---

## 3. P2: Trace State Sync

### 3.1 Trigger

Same alarm as P1 — called after each Bead flush. For each `CommitBead`
written to ArangoDB in the flush, resolve the corresponding Linear issue
via `linear_bindings` and update its state.

### 3.2 State machine mapping

| TraceEvent outcome + context | Linear state | Labels added |
|------------------------------|-------------|-------------|
| Atom dispatched (CommitBead written, no OutcomeBead yet) | `In Progress` | — |
| `outcome: success` | `Done` | `factory:success` |
| `outcome: failure`, `attemptNumber < maxAttempts` | `In Review` | `factory:retrying` |
| `outcome: failure`, `attemptNumber >= maxAttempts` | `Cancelled` | `factory:divergence`, `factory:failure` |
| `outcome: timeout`, retries exhausted | `Cancelled` | `factory:divergence`, `factory:timeout` |
| `outcome: cancelled` (dependency failed) | `Cancelled` | `factory:dependency-failed` |

### 3.3 Retry comment

When an atom transitions to `In Review` (retry in progress), append a
comment to the issue:

```
Retry {attemptNumber} of {maxAttempts} in progress.
Previous failure: {rawOutput.slice(0, 500)}
Full output: {sandboxOutputRef ?? 'not available'}
```

### 3.4 Success comment

When an atom transitions to `Done`, append a comment:

```
Atom completed successfully on attempt {attemptNumber}.
Duration: {durationMs}ms
Commit: {commitSha ?? 'no git operation performed'}
```

The `commitSha` is populated by the `post_execution.ts` hook (Direction 5).
If no git operation was performed by this atom, it is omitted.

---

## 4. P3: Divergence Projection

### 4.1 Trigger

Called from Bead flush for each `BuildOutcomeBead` with
`outcome: 'divergence'` written in that flush.

### 4.2 Input

```typescript
type DivergenceSyncRequest = {
  repoId: string
  workGraphVersion: string
  divergenceId: string       // DIV-* ref
  atomRef: string
  detectorId: string         // INV-* ref
  severity: 'blocking' | 'advisory' | 'informational'
  evidence: {
    rawOutputFragment: string    // first 500 chars
    sandboxOutputRef?: string
    traceSeqRef: string
  }
  elucidationArtifactId: string  // ELC-* from original commission
}
```

### 4.3 Issue creation

1. Check `linear_bindings` for `_key: divergenceId`
2. If binding exists: skip (already projected)
3. Resolve parent atom issue via `linear_bindings` on `atomRef`
4. Create divergence issue:

```typescript
{
  title: `[DIVERGENCE ${severity.toUpperCase()}] ${detectorId} on ${atomRef}`,
  teamId: LINEAR_TEAM_ID,
  projectId: parentAtomIssue.projectId,
  parentId: parentAtomIssueInternalId,
  stateId: resolveDivergenceState(severity),
  labelIds: buildDivergenceLabels(severity),
  description: buildDivergenceDescription(request, elucidationArtifact),
}
```

**State by severity:**

| Severity | Initial state |
|----------|--------------|
| `blocking` | `In Progress` (requires immediate governance attention) |
| `advisory` | `Backlog` (queued for cycle-boundary review) |
| `informational` | `Backlog` + `factory:informational` label |

**Labels by severity:**

| Severity | Labels |
|----------|--------|
| `blocking` | `factory:divergence`, `factory:blocking` |
| `advisory` | `factory:divergence`, `factory:advisory` |
| `informational` | `factory:divergence`, `factory:informational` |

**Description template:**

```markdown
## What fired
Detector `{detectorId}` matched on output from atom `{atomRef}`.

Severity: **{severity}**

## Evidence
{rawOutputFragment}

{sandboxOutputRef ? `Full output: ${sandboxOutputRef}` : ''}

## Elucidation (A9)
At the time this atom's WorkGraph was commissioned, the following
alternatives were available. These are preserved here to support
Hypothesis formation.

{renderElucidationContent(elucidationArtifact)}

## Identity
- Divergence ID: `{divergenceId}`
- Detector: `{detectorId}`
- WorkGraph: `{workGraphVersion}`
- Trace ref: `{traceSeqRef}`
```

5. Write `LinearBinding` for `divergenceId`

### 4.4 Divergence lifecycle updates

When the Commissioning Agent forms a Hypothesis (HYP-*), it calls
`POST /sync/hypothesis`:

```typescript
type HypothesisSyncRequest = {
  divergenceId: string
  hypothesisId: string     // HYP-* ref
  hypothesisContent: string  // rendered hypothesis text
  amendmentId?: string       // AMD-* if already proposed
}
```

The service appends a comment to the divergence issue:

```
**Hypothesis formed**: {hypothesisId}

{hypothesisContent}

{amendmentId ? `**Amendment proposed**: ${amendmentId}` : ''}
```

When the Commissioning Agent closes a Divergence (`DivergenceClosedEvent`),
it calls `POST /sync/divergence-closed`:

```typescript
type DivergenceClosedRequest = {
  divergenceId: string
  closedBy: string         // AMD-* or 'commissioning-agent-override'
  resolution: string       // human-readable resolution summary
}
```

The service transitions the divergence issue to `Done` and appends:

```
**Divergence resolved** by {closedBy}.
{resolution}
```

---

## 5. P4: Health Document

### 5.1 Trigger

Called from `ArchitectAgentDO.alarm()` after each anomaly scan. Also
called on any factory lifecycle state change (EMERGENCY_SUSPEND,
MAINTENANCE).

### 5.2 Document management

The service maintains two Linear documents per Factory deployment:

- **`Factory Health — Live`**: current-state snapshot, full-replace on
  each call
- **`Factory Health — History`**: append-only daily snapshot at midnight

Both documents live in the `Function Factory Agent Infrastructure`
project. Document IDs are stored in a CF KV namespace
(`FACTORY_LINEAR_KV`) under keys `health-doc-live-id` and
`health-doc-history-id`. If they don't exist on first call, the service
creates them.

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
  producedAt: string
}

type RepoHealthSummary = {
  repoId: string
  healthStatus: string
  lifecycleState: string
  lastCommissionAt: string
  escalationLinearIssueId?: string  // WEO-N if suspended with open escalation
}

type EscalationSummary = {
  escalationId: string
  repoId: string
  escalationType: string
  linearIssueId: string    // WEO-N
  openSince: string
}

type PatchSummary = {
  patchId: string
  trigger: string
  appliedToRepoIds: string[]
  pendingRepoIds: string[]
}
```

### 5.4 Live document template

```markdown
# Factory Health
_Last updated: {producedAt}_

{factoryLifecycleState !== 'ACTIVE'
  ? `> ⚠️ FACTORY ${factoryLifecycleState} — see escalation issues below\n`
  : ''}

## Status
**Factory lifecycle**: {factoryLifecycleState}
**Active repos**: {activeRepos.length}
({activeRepos.filter(r => r.healthStatus === 'healthy').length} healthy,
 {activeRepos.filter(r => r.healthStatus === 'degraded').length} degraded,
 {activeRepos.filter(r => r.lifecycleState === 'SUSPENDED').length} suspended)

## Open Governance Items
| Type | Count | Action |
|------|-------|--------|
| Blocking Divergences | {openDivergences.blocking} | {openDivergences.blocking > 0 ? 'Requires Hypothesis formation' : '—'} |
| Open Escalations | {openEscalations.length} | {openEscalations.length > 0 ? 'Requires We-layer Disposition' : '—'} |
| Open CRPs | {pendingCrpCount} | {pendingCrpCount > 0 ? 'In Architect Agent D2 resolution' : '—'} |
| Active Patches | {activePatches.length} | {activePatches.length > 0 ? 'D1 propagation in progress' : '—'} |
| Advisory Divergences | {openDivergences.advisory} | Queued for cycle boundary review |

{openEscalations.length > 0 ? `
## Open Escalations
${openEscalations.map(e =>
  `- **${e.escalationType}** on \`${e.repoId}\` — ${e.linearIssueId} — open since ${e.openSince}`
).join('\n')}
` : ''}

{activeRepos.some(r => r.healthStatus !== 'healthy') ? `
## Degraded / Suspended Repos
${activeRepos
  .filter(r => r.healthStatus !== 'healthy')
  .map(r => {
    const line = `- \`${r.repoId}\` — ${r.lifecycleState}`
    return r.escalationLinearIssueId
      ? `${line} → escalation: ${r.escalationLinearIssueId}`
      : line
  }).join('\n')}
` : ''}

{activePatches.length > 0 ? `
## Active Patches
${activePatches.map(p =>
  `- ${p.patchId} — ${p.trigger}\n` +
  `  Applied: ${p.appliedToRepoIds.length} repos | Pending: ${p.pendingRepoIds.join(', ')}`
).join('\n')}
` : ''}

## Pipeline Config
- Config ID: \`{pipelineConfig.configId}\` (effective {pipelineConfig.effectiveFrom})
- Pass routing: {renderPassRouting(pipelineConfig.passRouting)}
- Coherence threshold: {pipelineConfig.gateThresholds.coherenceMinCoverage * 100}%
- Fidelity max blocking: {pipelineConfig.gateThresholds.fidelityMaxOpenBlockingDivergences}
- Staleness threshold: {pipelineConfig.gateThresholds.assuranceMaxDetectorStalenessHours}h
- Vertical slicing: isolated={pipelineConfig.verticalSlicePolicy.atomRetryIsolation},
                    parallel threshold={pipelineConfig.verticalSlicePolicy.parallelSliceThreshold},
                    DAG dispatch={pipelineConfig.verticalSlicePolicy.dagDispatchEnabled}
```

---

## 6. Escalation Issue Creation

This endpoint is called by the Commissioning Agent when it calls
`escalateToWeLayer()`. It creates the Linear issue that Direction 2
(`ff-linear-bridge`) will watch for human disposition.

### 6.1 Input

```typescript
type EscalationSyncRequest = {
  escalationId: string          // ESC-* ref in ArangoDB
  repoId: string
  escalationType: EscalationType
  requestedAction: string
  evidence: {
    divergenceIds?: string[]
    hypothesisId?: string
    amendmentId?: string
    coherenceVerdictDetail?: string
    crpId?: string
    patchId?: string
    proposedConfigId?: string
  }
  linearDivergenceIssueIds: string[]  // WEO-N refs for linked divergences
}
```

### 6.2 Issue creation

```typescript
{
  title: `[ESCALATION] ${repoId} — ${escalationType}`,
  teamId: LINEAR_TEAM_ID,
  projectId: FACTORY_PROJECT_ID,
  stateId: IN_PROGRESS_STATE_ID,
  priority: escalationType === 'AutoSuspend' ? 1 : 2,  // Urgent for suspensions
  labelIds: buildEscalationLabels(escalationType),
  description: buildEscalationDescription(request),
}
```

**Labels by escalation type:**

| EscalationType | Labels |
|----------------|--------|
| `AutoSuspend` | `factory:escalation`, `factory:requires-resume` |
| `AmendmentCoherenceFail` | `factory:escalation`, `factory:requires-new-workgraph` |
| `CommissionFail` | `factory:escalation`, `factory:requires-new-workgraph` |
| `CRPFail` | `factory:escalation`, `factory:requires-crp-resolution` |
| `PatchPropagationFail` | `factory:escalation`, `factory:requires-patch-auth` |
| `PipelineAnomalyDetected` | `factory:escalation`, `factory:requires-pipeline-config` |

**Blocking links**: if `linearDivergenceIssueIds` is non-empty, each
divergence issue is linked as blocking the escalation issue. The
escalation is unresolvable until its constituent Divergences are closed.

**Description template:**

```markdown
## Escalation
**Type**: {escalationType}
**Repo**: `{repoId}`
**Requested action**: {requestedAction}

## Evidence
{renderEvidenceSection(evidence)}

## Disposition instructions
To resolve this escalation, post a comment with the following structure:

\`\`\`
DISPOSITION: {inferDispositionVerb(escalationType)}
{inferDispositionFields(escalationType)}
rationale: <your rationale>
candidatesConsidered: [<list of WorkGraph versions or config IDs considered>]
rejectedOptions: <version or ID> — <reason>
\`\`\`

Then add the label \`factory:disposition-recorded\` to close this issue.
The \`ff-linear-bridge\` webhook handler will pick up the disposition
and fire the appropriate signal to the WeOps gateway.

## Identity
- Escalation ID: `{escalationId}`
- Factory artifact refs: {renderArtifactRefs(evidence)}
```

---

## 7. Linear Label Bootstrap

Before the service can run, the following labels must exist in the
Linear workspace. The service checks for them on startup and creates
any that are missing.

```typescript
const REQUIRED_LABELS = [
  { name: 'factory:atom',               color: '#0ea5e9' },  // sky blue
  { name: 'factory:active',             color: '#22c55e' },  // green
  { name: 'factory:superseded',         color: '#94a3b8' },  // slate
  { name: 'factory:success',            color: '#22c55e' },  // green
  { name: 'factory:retrying',           color: '#f59e0b' },  // amber
  { name: 'factory:divergence',         color: '#ef4444' },  // red
  { name: 'factory:blocking',           color: '#dc2626' },  // dark red
  { name: 'factory:advisory',           color: '#f97316' },  // orange
  { name: 'factory:informational',      color: '#94a3b8' },  // slate
  { name: 'factory:failure',            color: '#ef4444' },  // red
  { name: 'factory:timeout',            color: '#a855f7' },  // purple
  { name: 'factory:dependency-failed',  color: '#6b7280' },  // gray
  { name: 'factory:escalation',         color: '#dc2626' },  // dark red
  { name: 'factory:requires-resume',    color: '#f59e0b' },  // amber
  { name: 'factory:requires-new-workgraph', color: '#f59e0b' },
  { name: 'factory:requires-patch-auth',    color: '#f59e0b' },
  { name: 'factory:requires-pipeline-config', color: '#f59e0b' },
  { name: 'factory:requires-crp-resolution',  color: '#f59e0b' },
  { name: 'factory:disposition-recorded', color: '#22c55e' }, // green
  { name: 'factory:cycle-boundary',     color: '#8b5cf6' },  // violet
  { name: 'factory:carried-over',       color: '#6b7280' },  // gray
]
```

Labels are stored in a `LabelBinding` KV namespace after creation to
avoid redundant API calls on every startup.

---

## 8. Milestone Management

### 8.1 WorkGraph version → Linear milestone

For every distinct `workGraphVersion` commissioned to a repo, the
service ensures a corresponding Linear milestone exists under the
project.

```typescript
// KV: FACTORY_LINEAR_KV
// Key: milestone:{repoId}:{workGraphVersion}
// Value: { milestoneId: string, milestoneInternalId: string }
```

On P1 atom projection, if no milestone binding exists:

```graphql
mutation {
  projectMilestoneCreate(input: {
    projectId: $projectId,
    name: "WG-{workGraphVersion}",
    description: "WorkGraph {workGraphId} version {workGraphVersion}"
  })
}
```

### 8.2 WorkGraph version change

When a new WorkGraph version supersedes an old one, the old milestone
is not deleted — it remains as a historical record. All atom issues
under the old milestone are labeled `factory:superseded` and moved to
`Cancelled`. New atom issues are created under the new milestone.

---

## 9. Rate Limiting and Batching

The Linear API has rate limits. The service batches writes to stay
within limits.

**Per-flush batch limits:**
- Max 50 issue creates per flush call
- Max 100 issue state updates per flush call
- Max 20 comment appends per flush call
- If batch exceeds limits: split into sub-batches with 500ms delay

**Backoff on 429:** exponential backoff starting at 1s, max 16s, max 5
retries. On persistent rate limit: log to ArangoDB `linear_sync_errors`
collection; do not block the Bead flush.

**GraphQL batching:** use Linear's multi-mutation GraphQL support to
batch multiple issue creates into a single request where possible.

---

## 10. Error Handling

All Linear API failures are non-blocking for the Factory's governance
loop. A Linear write failure must never cause a Mediation Agent flush
to fail or a Commissioning Agent to halt.

On failure:
1. Log error to ArangoDB `linear_sync_errors` collection with artifact
   ID, error type, timestamp
2. Mark the `LinearBinding` (if partially created) with
   `syncStatus: 'error'`
3. Retry on next flush cycle (the binding table prevents duplicates)
4. After 5 consecutive failures for the same artifact: surface in
   Health Document as `linear_sync_degraded: true`

---

## 11. Environment Bindings

```typescript
type Env = {
  LINEAR_API_KEY: string           // Linear personal API key (service account)
  LINEAR_TEAM_ID: string           // WeOps team ID
  LINEAR_PROJECT_ID: string        // Function Factory Agent Infrastructure project ID
  ARANGO_URL: string
  ARANGO_DB: string
  ARANGO_TOKEN: string
  FACTORY_LINEAR_KV: KVNamespace   // milestone bindings, document IDs, label bindings
}
```

---

## 12. Package Structure

```
packages/linear-sync/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts                 — CF Worker default export + router
    ├── types.ts                 — request/response types + LinearBinding
    ├── label-bootstrap.ts       — ensure required labels exist on startup
    ├── milestone-manager.ts     — WorkGraph version → milestone binding
    ├── p1-atom-projection.ts    — atom issue create/update
    ├── p2-trace-state-sync.ts   — issue state transitions on trace events
    ├── p3-divergence-projection.ts — divergence issue create/lifecycle
    ├── p4-health-document.ts    — live + history document management
    ├── escalation-sync.ts       — escalation issue creation (D2 support)
    ├── linear-client.ts         — GraphQL API wrapper with batching + backoff
    └── binding-store.ts         — ArangoDB linear_bindings CRUD
```

---

## 13. Open Items

| Item | Owner | Blocking |
|------|-------|---------|
| Linear GraphQL API auth — service account vs. OAuth token for worker runtime | Engineering | No — personal API key acceptable for v1 |
| `ff-linear-bridge` spec — the D2 webhook handler that reads escalation issues and fires gateway signals | Architect | No — LinearSyncService creates the issues; bridge spec is separate |
| `CycleAwarenessService` spec — D4 cycle cadence, advisory surfacing at cycle boundary | Architect | No — independent of this service |
| Direction 5 commit tracing — `post_execution.ts` hook writes `commitSha` back to atom issue via this service | Engineering | No — hook calls `POST /sync/commit-sha` (endpoint not yet specified here) |
| Linear state IDs — Backlog, In Progress, In Review, Done, Cancelled state UUIDs must be read from the API at bootstrap and stored in KV | Engineering | No — discoverable at runtime |
