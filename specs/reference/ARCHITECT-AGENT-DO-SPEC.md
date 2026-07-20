# Architect Agent DO Specification
**ID**: SPEC-ARCHITECT-AGENT-DO-001  
**Status**: Draft — pending Architect sign-off  
**Date**: 2026-06-04  
**Layer**: I-layer runtime — Factory-wide governance singleton  
**Implementation**: Cloudflare Durable Object (singleton, Factory-scoped)  
**Package**: `@factory/harness-bridge`

---

## 0. Conceptual Preamble

This document is self-contained. Every design decision is derivable from
the ontological commitments stated here.

### 0.1 What the Architect Agent IS

The Architect Agent is the Factory-wide governance singleton. Where the
Commissioning Agent governs the spec-execution loop for a single repo, the
Architect Agent governs the Factory itself: the compiler pipeline, cross-repo
consistency, patch propagation, and the escalation path for failures that
exceed a single repo's authority to resolve.

In ontology terms: the Architect Agent is a Composite Agent (§3.12) whose
Knowing-State spans all active repos, the compiler pipeline configuration,
and the Factory's own specification-execution structure. It is the agent that
bears the conceptual-framework tier of the Factory's self-knowledge — the tier
that individual Commissioning Agents, operating per-repo, cannot sustain.

This makes the Architect Agent a partial Knowing-State Prosthesis for the
Commissioning Agents: it holds Factory-wide context that no per-repo agent
can hold, and makes it available at the moments Commissioning Agents need it
(cross-repo conflict resolution, pipeline reconfiguration, emergency patch).

### 0.2 Four Decision Domains

The Architect Agent has governance authority over exactly four decision
domains. Authority outside these domains belongs to the We-layer or to
individual Commissioning Agents.

| Domain | Scope | Key artifact produced |
|--------|-------|----------------------|
| **D1: Patch Governance** | Propagating WorkGraph patches across multiple repos when a shared invariant, detector spec, or atom template changes | `PATCH-*` artifact + targeted `/commission` calls |
| **D2: CRP Resolution** | Resolving Coverage Resolution Protocol events — structured escalation when Coherence Verification fails on an Amendment and the Commissioning Agent cannot auto-resolve | `CRP-RESOLUTION-*` artifact |
| **D3: Vertical Slicing** | Governing per-atom retry isolation and parallel vertical slice dispatch on multi-atom WorkGraphs; calibrating the DAG dispatch policy | `VSLICE-CONFIG-*` artifact |
| **D4: Pipeline Configuration** | Adjusting compiler pass routing, model selection, and gate thresholds in response to anomalies surfaced from cross-repo Execution-Trace patterns | `PIPELINE-CONFIG-*` artifact |

### 0.3 Singleton Topology

One Architect Agent DO instance per Factory deployment. DO key:

```
do-key: architect-agent:factory
```

This is a long-lived singleton. It is never recreated; it hibernates between
events. All governance state is held in DO storage backed by ArangoDB
(DO storage for hot state; ArangoDB for lineage and audit).

### 0.4 Authority Boundaries

The Architect Agent does NOT:

- Issue WorkGraphs to repos (that is Commissioning Agent territory)
- Hold or maintain repo-scoped Knowing-State Prosthesis content (Mediation Agent)
- Execute code (Conducting Agent / Gas City)
- Produce Charter amendments or We-layer commissioning signals (WeOps layer)
- Override We-layer Disposition Events

The Architect Agent DOES issue emergency lifecycle overrides to Commissioning
Agents (`POST /override`) when a cross-repo incident requires immediate
coordinated suspension or patch propagation. These overrides are always
recorded as VCRs with `verdictSource: 'architect-agent-override'`.

---

## 1. DO Storage Schema

### 1.1 Factory State

```typescript
// Key: "factory:state"
type FactoryState = {
  activeRepos: RepoSummary[]
  pipelineConfig: PipelineConfig
  verticalSlicePolicy: VerticalSlicePolicy
  lastAnomalyDetectedAt?: string
  lastPatchIssuedAt?: string
  lifecycleState: 'ACTIVE' | 'EMERGENCY_SUSPEND' | 'MAINTENANCE'
}

type RepoSummary = {
  repoId: string
  commissioningAgentUrl: string
  mediationAgentDoKey: string
  lastHealthPollAt: string
  healthStatus: 'healthy' | 'degraded' | 'suspended' | 'unknown'
  activeBlockingDivergences: number
  pendingCrpCount: number
}
```

### 1.2 CRP Queue

```typescript
// Key: "crp:queue"
type CRPQueue = {
  items: CRPItem[]
  lastProcessedAt: string
}

type CRPItem = {
  crpId: string                  // CRP-* ID
  repoId: string
  amendmentId: string            // AMD-* that triggered the CRP
  coherenceVerdict: string       // the unfavorable verdict detail
  status: 'pending' | 'in-resolution' | 'resolved' | 'escalated-to-we-layer'
  receivedAt: string
  resolvedAt?: string
}
```

### 1.3 Patch Registry

```typescript
// Key: "patches:active"
type PatchRegistry = {
  patches: PatchRecord[]
}

type PatchRecord = {
  patchId: string                // PATCH-* ID
  trigger: string                // what caused the patch (invariant change, etc.)
  affectedRepoIds: string[]
  appliedToRepoIds: string[]
  pendingRepoIds: string[]
  status: 'propagating' | 'complete' | 'partial-failure'
  issuedAt: string
  completedAt?: string
}
```

### 1.4 Pipeline Config (Hot)

```typescript
// Key: "pipeline:config"
// This is the hot copy; canonical lives in ArangoDB as PIPELINE-CONFIG-*
type PipelineConfig = {
  configId: string               // PIPELINE-CONFIG-* ID
  passRouting: PassRoutingConfig[]
  gateThresholds: GateThresholdConfig
  verticalSlicePolicy: VerticalSlicePolicy
  effectiveFrom: string
  reason: string                 // why this config is current
}

type PassRoutingConfig = {
  passId: string                 // "pass-1" through "pass-8"
  model: 'gpt-5-5' | 'deepseek-flash' | 'claude-opus' | 'local'
  fallback: 'gpt-5-5' | 'claude-opus'
  maxRetries: number
}

type GateThresholdConfig = {
  coherenceMinCoverage: number   // 0-1; default 1.0 (all atoms bound)
  fidelityMaxOpenBlockingDivergences: number  // default 0
  assuranceMaxDetectorStalenessHours: number  // default 24
}

type VerticalSlicePolicy = {
  atomRetryIsolation: boolean    // true: per-atom retry; false: full WorkGraph retry
  maxAtomRetries: number         // default 3
  parallelSliceThreshold: number // atom count above which parallel dispatch activates
  dagDispatchEnabled: boolean    // true: DAG-aware dispatch ordering
}
```

---

## 2. Decision Domain Workflows

### 2.1 D1: Patch Governance

**Trigger**: A shared artifact changes — invariant library update, detector
spec revision, atom template change — that affects multiple repos.

The source of truth for "which repos are affected" is an AQL traversal:

```aql
// Find all WorkGraphs that reference the changed artifact
FOR wg IN workgraphs
  FOR ref IN 1..3 INBOUND wg GRAPH 'factory-lineage'
    FILTER ref._key == @changedArtifactId
    RETURN DISTINCT wg.repoId
```

**Workflow**:

```
1. Receive patch trigger (from WeOps gateway or internal anomaly detector)
2. Run AQL traversal to identify affected repos
3. For each affected repo:
   a. Fetch current WG-* from ArangoDB
   b. Compute patch diff (atom/invariant/detector changes only)
   c. Run Coherence Verification on patched WG-*
      → If favorable: add to patch propagation queue
      → If unfavorable: open CRP item (§2.2)
4. Write PATCH-* artifact to ArangoDB with:
   - affectedRepoIds
   - diff content
   - Coherence Verdicts per repo
5. For each repo with favorable Coherence Verdict:
   - POST /override (emergency) or /commission (normal) to Commissioning Agent
   - payload: { patchId, newWorkGraphId, authorizedBy: 'architect-agent' }
6. Monitor propagation via polling (alarm-based, every 2 minutes while patch active)
7. On full propagation: write PatchCompletionRecord; produce VCR
8. On partial failure after 3 retry cycles: escalate to We-layer
```

**Patch sequencing rule**: patches propagate in dependency order. A repo
whose WorkGraph depends on another repo's exported invariants receives the
patch only after the upstream repo's patch is confirmed applied. The DAG
dispatch policy (§2.3) informs this ordering.

### 2.2 D2: CRP Resolution

**CRP** = Coverage Resolution Protocol. A CRP event opens when a
Commissioning Agent submits an Amendment (AMD-*) to the compiler, the
compiler returns an unfavorable Coherence Verdict, and the Commissioning
Agent cannot auto-resolve (i.e., the unfavorable verdict is not addressable
by a simple retry or reformulation — it requires cross-cutting knowledge).

**When Commissioning Agents open a CRP**: the Commissioning Agent POSTs
to `POST /crp` on the Architect Agent with the AMD-* ID, the Coherence
Verdict detail, and the originating Divergence/Hypothesis chain.

**Resolution workflow**:

```
1. Receive CRP item; add to crp:queue
2. Classify the Coherence failure:
   a. SCHEMA_VIOLATION: atom references a non-existent artifact type
   b. INVARIANT_CONFLICT: proposed change conflicts with a cross-repo invariant
   c. COVERAGE_GAP: proposed change leaves atoms without detector coverage
   d. LINEAGE_BREAK: proposed change severs a required lineage edge
3. For each class, resolution path:
   a. SCHEMA_VIOLATION → emit corrected AMD-* diff; return to Commissioning Agent
   b. INVARIANT_CONFLICT → check if conflict is cross-repo; if so, open Patch (§2.1)
                           if single-repo: emit resolution guidance to Commissioning Agent
   c. COVERAGE_GAP → emit missing detector spec; attach to AMD-*; re-verify
   d. LINEAGE_BREAK → reconstruct missing lineage edge; re-verify
4. On successful resolution: write CRP-RESOLUTION-* artifact; close CRP item
5. On failed resolution after 2 attempts: escalate to We-layer with full evidence package
   (AMD-*, Verdict, Hypothesis chain, CRP resolution attempts)
```

**CRP artifacts**:

```typescript
// ArangoDB collection: crp_resolutions
// ID prefix: CRP-RESOLUTION-
type CRPResolution = {
  _key: string
  crpId: string
  amendmentId: string
  failureClass: 'SCHEMA_VIOLATION' | 'INVARIANT_CONFLICT' | 'COVERAGE_GAP' | 'LINEAGE_BREAK'
  resolutionAction: string
  correctedArtifactId?: string   // if resolution produced a new artifact
  outcome: 'resolved' | 'escalated'
  resolvedAt: string
  source: 'architect-agent'
  explicitness: 'stated'
}
```

### 2.3 D3: Vertical Slicing

Vertical slicing governs how multi-atom WorkGraphs are dispatched for
execution. The policy has two dimensions:

**Per-atom retry isolation**: when an atom fails, does only that atom retry
(isolated) or does the entire WorkGraph re-execute from the failing atom
forward (sequential rollback)? Isolated retry is correct when atoms are
genuinely independent; sequential rollback is correct when atoms have
implicit ordering dependencies that the DAG does not fully capture.

**Parallel dispatch threshold**: when a WorkGraph has `N` atoms with no
inter-atom dependencies (a wide DAG), the Architect Agent can authorize
parallel dispatch — multiple atoms executed concurrently across Gas City
sessions. The threshold is the atom count above which this activates.

**The Architect Agent's role**: it does not dispatch atoms (that is the
Conducting Agent). It sets and updates the `VerticalSlicePolicy` in
`pipeline:config` based on anomaly evidence from Execution-Traces.

**Policy update workflow**:

```
1. Detect anomaly trigger:
   - High atom retry rate (>20% of atoms retrying across any single WorkGraph)
   - Parallel dispatch timeouts (concurrent atoms deadlocking on shared resources)
   - Sequential failures suggesting implicit ordering dependencies
2. Read cross-repo Execution-Trace summary from ArangoDB
3. Compute updated VerticalSlicePolicy:
   - If retry rate high: reduce parallelSliceThreshold; increase maxAtomRetries
   - If deadlock pattern: disable parallelSliceThreshold temporarily
   - If sequential failures: set dagDispatchEnabled: true; rebuild DAG from lineage
4. Write VSLICE-CONFIG-* to ArangoDB
5. Update pipeline:config in DO storage
6. Notify all active Commissioning Agents of updated policy
   (broadcast to all commissioningAgentUrls in factory:state.activeRepos)
7. Produce VCR
```

### 2.4 D4: Pipeline Configuration

Pipeline configuration covers compiler pass routing (which model runs which
pass), gate thresholds (what constitutes "favorable" for each Verification-
Process), and model fallback chains.

**The Architect Agent's role**: it reads cross-repo anomaly patterns from
ArangoDB, identifies which pass or gate is the source of systematic failure,
and issues a `PIPELINE-CONFIG-*` update.

**Anomaly trigger types**:

| Anomaly | Diagnosis | Config change |
|---------|-----------|--------------|
| Pass-N failure rate > 15% across repos | Model routing for pass-N is producing non-conforming output | Route pass-N to fallback model; flag for per-pass evaluation |
| Gate threshold producing false positives (excessive Amendment churn) | Threshold too tight | Relax by 5%; record rationale |
| Gate threshold missing real failures (Divergences not caught) | Threshold too loose | Tighten by 10%; record rationale |
| Coherence Verification latency > 30s per Amendment | Model for coherence check is overloaded | Route coherence check to faster model |

**Pipeline config update workflow**:

```
1. Detect anomaly (alarm-based scan of cross-repo trace summaries)
2. Diagnose anomaly class (table above)
3. Compute config change
4. Deliberation: is this change reversible? Does it affect live repos?
   → If reversible and affects only future commissions: apply immediately
   → If affects live commissions: require We-layer authorization before applying
5. Write PIPELINE-CONFIG-* to ArangoDB with:
   - previous config ref
   - anomaly evidence refs (Execution-Trace IDs)
   - change made and rationale
   - effectiveFrom timestamp
6. Update pipeline:config in DO storage
7. This is a Disposition Event: produce Elucidation Artifact recording
   alternatives considered (e.g., other model options, other threshold values)
8. Produce VCR
9. Notify harness-bridge of updated routing config
```

---

## 3. HTTP API

### 3.1 `POST /crp`

Received from: Commissioning Agents.

```typescript
// Request
{
  repoId: string
  amendmentId: string            // AMD-* that failed Coherence Verification
  coherenceVerdictDetail: string // reason string from compiler
  hypothesisId: string           // HYP-* that motivated the Amendment
  divergenceIds: string[]        // DIV-* that motivated the Hypothesis
}

// Response
{
  crpId: string
  status: 'queued' | 'in-resolution'
  estimatedResolutionMs?: number
}
```

### 3.2 `POST /patch`

Received from: WeOps gateway or internal anomaly detector.

```typescript
// Request
{
  changedArtifactId: string      // invariant, detector spec, or atom template
  changeDescription: string
  authorizedBy: string
  urgency: 'normal' | 'emergency'
}

// Response
{
  patchId: string
  affectedRepoCount: number
  status: 'propagating'
}
```

### 3.3 `GET /health`

Returns `FactoryState` summary: active repo count by health status, pending
CRP count, active patch count, current pipeline config ID.

### 3.4 `POST /register-repo`

Called by WeOps gateway when a new repo is commissioned into the Factory.

```typescript
{
  repoId: string
  commissioningAgentUrl: string
  mediationAgentDoKey: string
}
```

Adds repo to `factory:state.activeRepos`. Does not trigger a commission —
that is the Commissioning Agent's responsibility.

### 3.5 `POST /deregister-repo`

Called by WeOps gateway when a repo is retired.

### 3.6 `GET /pipeline-config`

Returns current `PipelineConfig`. Called by compiler and harness-bridge
on startup and on config-change notifications.

---

## 4. Cross-Repo Anomaly Detection

The Architect Agent runs a periodic anomaly scan (CF DO alarm, every 15
minutes while factory is active). The scan reads ArangoDB:

```aql
// Scan for cross-repo failure patterns
FOR trace IN execution_traces
  FILTER trace.producedAt > DATE_SUBTRACT(DATE_NOW(), 1, "hour")
  COLLECT passId = trace.passId, outcome = trace.outcome
  AGGREGATE count = LENGTH(1)
  FILTER outcome == 'failure'
  SORT count DESC
  RETURN { passId, failureCount: count }
```

Pattern thresholds:
- Single pass failure rate > 15% across 3+ repos in 1 hour → D4 trigger
- Amendment Coherence failures > 5 in 1 hour across any repos → D2 triage
- Patch propagation stalled > 30 minutes → D1 escalation check

Anomaly records are written to ArangoDB `anomaly_records` collection with
lineage edges to the triggering traces.

---

## 5. Relationship to Other Agents

```
WeOps Gateway
  → POST /patch (authorized patch triggers)
  → POST /register-repo, /deregister-repo
  → Receives escalations (CRP and patch failures)

Commissioning Agents (N instances, one per active repo)
  → POST /crp (when Amendment Coherence Verification fails)
  → Receive: PATCH propagation calls, VSLICE-CONFIG updates,
             PIPELINE-CONFIG change notifications
  → Receive: emergency lifecycle overrides via their /override endpoint

Compiler (@factory/compiler)
  → GET /pipeline-config (on startup, on change notification)
  → Coherence Verification results flow back via Commissioning Agent /crp

harness-bridge (@factory/harness-bridge)
  → GET /pipeline-config (model routing)
  → Updated on PIPELINE-CONFIG change
```

The Architect Agent does not call the Mediation Agent DO directly. All
repo-level interactions flow through Commissioning Agents.

---

## 6. Lineage Discipline

Every artifact written to ArangoDB by the Architect Agent carries:

```typescript
{
  source: 'architect-agent',
  domain: 'D1' | 'D2' | 'D3' | 'D4',
  explicitness: 'stated'
}
```

Every Disposition Event in the Architect Agent (pipeline config change,
vertical slice policy change, CRP resolution) produces:
- An Elucidation Artifact (ELC-*) per Axiom A9
- A VCR

---

## 7. Model Routing

| Operation | Model | Rationale |
|-----------|-------|-----------|
| CRP diagnosis and resolution | GPT-5.5 (planning) | Structural: identifying which artifact is wrong and computing a corrective diff is a planning operation |
| Anomaly pattern interpretation | Claude Opus (synthesis) | Interpretive: cross-repo pattern reading requires conceptual-framework reasoning |
| Patch DAG traversal and sequencing | Deterministic (AQL) | No LLM needed |
| Pipeline config delta computation | Deterministic | Rule-based from anomaly thresholds |
| Elucidation Artifact generation | DeepSeek Flash (validation) | Validation: confirming alternatives are correctly enumerated |

---

## 8. Environment Bindings

```typescript
type Env = {
  ARANGO_URL: string
  ARANGO_DB: string
  ARANGO_TOKEN: string
  WEOPS_GATEWAY_URL: string
  HARNESS_BRIDGE_URL: string
  COMPILER_URL: string
  ANOMALY_SCAN_INTERVAL_MS: string        // default "900000" (15 min)
  PATCH_PROPAGATION_TIMEOUT_MS: string    // default "1800000" (30 min)
  CRP_RESOLUTION_TIMEOUT_MS: string       // default "600000" (10 min)
}
```

DO namespace in wrangler.toml:
```toml
[[durable_objects.bindings]]
name = "ARCHITECT_AGENT"
class_name = "ArchitectAgentDO"
```

---

## 9. Open Items

| Item | Owner | Blocking |
|------|-------|---------|
| `AtomDirective` schema — needed for patch diff computation in D1 | Architect | Yes — shared blocker across all three agent specs |
| Divergence severity classification policy — needed to define which Commissioning Agent failures open a CRP vs. auto-resolve | Architect | Yes — shared blocker |
| DAG structure of WorkGraph atoms — needed for D3 dependency-order patch propagation and parallel dispatch | Engineering | No — can stub with sequential ordering for v1 |
| We-layer authorization contract for pipeline config changes that affect live repos (§2.4, step 4) | WeOps | No — can default to "requires authorization" without the full contract for v1 |
| CRP failure class taxonomy completeness — are there failure classes beyond the four named in §2.2? | Architect | No — four classes cover known cases; can extend |
