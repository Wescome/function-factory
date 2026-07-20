# Commissioning Agent Specification
**ID**: SPEC-COMMISSIONING-AGENT-001  
**Status**: Draft — pending Architect sign-off  
**Date**: 2026-06-04  
**Layer**: I-layer runtime — spec-execution governance  
**Implementation**: Cloudflare Worker (stateless request handler) +
                   ArangoDB (artifact and lineage store)  
**Package**: `@factory/harness-bridge`

---

## 0. Conceptual Preamble

This document is self-contained. Every design decision below is derivable
from the ontological commitments stated here. An agent reading only this
document must be able to implement the Commissioning Agent correctly.

### 0.1 What the Commissioning Agent IS

A Commissioning Agent is the I-layer agent that issues Specifications
(WorkGraphs) to a repo's Mediation Agent DO, consumes Verdicts produced by
the Mediation Agent's Verification-Process, and governs the full
specification-execution loop for one commissioned repo scope.

In the cyclic structure of the spec-execution ontology (§6.2):

```
Commissioning Agent
  formalizes  →  knowing-state  →  specification (WorkGraph)
  governs     →  specification  →  execution (via Mediation Agent)
  consumes    →  execution-trace ← (from Mediation Agent /state)
  forms       →  hypothesis     ← (from active Divergences)
  proposes    →  amendment      → (successor WorkGraph, via compiler)
```

The Commissioning Agent is the agent that completes this loop. Without it,
Divergences accumulate in the Mediation Agent DO without being resolved into
Hypotheses and Amendments. The repo specification drifts silently.

### 0.2 What the Commissioning Agent is NOT

It is not the Architect Agent. The Architect Agent is a separate singleton
DO governing Factory-wide concerns (patch governance, CRP resolution, vertical
slicing policy, pipeline configuration). The Commissioning Agent governs one
repo's spec-execution loop only. It does not touch the compiler, the pipeline
configuration, or cross-repo policy.

It is not the Mediation Agent. The Mediation Agent holds the Knowing-State
Prosthesis and hosts the Verification-Process. The Commissioning Agent
commissions the Mediation Agent and reads its state. It does not execute
inside the repo.

It is not a WeOps-layer agent. It does not produce Charter amendments. It
does not govern the We-layer commissioning structure. Divergences with
strategic implication are surfaced upward as evidence for a We-layer
Disposition Event; the Commissioning Agent does not itself dispose of them.

### 0.3 Scope: One Agent Instance Per Commissioned Repo

One Commissioning Agent instance governs one repo. Multiple repos running
in parallel each have their own instance. Instances do not share state.
Cross-repo concerns (dependency conflicts, shared invariant libraries) are
handled by the Architect Agent, not by inter-instance communication.

### 0.4 Implementation Topology

The Commissioning Agent is implemented as a **stateless Cloudflare Worker**
that reads from and writes to ArangoDB, and calls the Mediation Agent DO via
HTTP. It holds no durable state of its own — ArangoDB is the state store for
all governance artifacts. This makes the Commissioning Agent restartable and
replaceable without data loss.

---

## 1. Responsibilities

The Commissioning Agent has five responsibilities, each mapping to a named
process in the spec-execution ontology.

| Responsibility | Ontology mapping |
|----------------|-----------------|
| R1: Commission a WorkGraph to the Mediation Agent | issues Specification; triggers `/commission` on Mediation Agent DO |
| R2: Poll Mediation Agent state | reads Execution-Trace summary, active Divergence set, Verdict state |
| R3: Form Hypotheses from Divergences | Hypothesis category (§3.10); attributes fault, motivates Amendment |
| R4: Propose Amendments | Amendment category (§3.11); submits to compiler for Coherence Verification |
| R5: Govern lifecycle (suspend/resume/escalate) | calls Mediation Agent `/suspend`, `/resume`; escalates to We-layer when warranted |

---

## 2. Inputs and Outputs

### 2.1 Inputs

| Input | Source | Type |
|-------|--------|------|
| Compiled WorkGraph | ArangoDB (written by compiler) | `WG-*` artifact |
| Mediation Agent state poll | Mediation Agent DO `/state` | `VerificationProcessState` + `ActiveDivergenceSet` |
| Amendment Verdict | Compiler Coherence Verification | `Verdict` on proposed Amendment |
| We-layer commissioning signal | WeOps gateway | Commission request with `repoId` + `workGraphId` |
| Architect Agent directive | Architect Agent DO | Lifecycle override (suspend all, resume, emergency patch) |

### 2.2 Outputs

| Output | Destination | Type |
|--------|-------------|------|
| Commission call | Mediation Agent DO `/commission` | `CommissionRequest` |
| Hypothesis | ArangoDB `hypotheses` collection | `HYP-*` artifact |
| Amendment proposal | ArangoDB `amendments` collection + compiler | `AMD-*` artifact |
| Elucidation Artifact | ArangoDB `elucidation_artifacts` collection | `ELC-*` artifact |
| We-layer escalation | WeOps gateway | Escalation event with Divergence evidence |
| VCR (Verdict Closure Record) | ArangoDB `vcrs` collection | Produced on every Disposition Event |

---

## 3. Workflow

### 3.1 Commission Flow

Triggered by: We-layer commissioning signal (new WorkGraph accepted).

```
1. Read WG-* artifact from ArangoDB
2. Verify Coherence Verdict on WG-* is favorable
   → If unfavorable: surface to We-layer; do not commission
3. POST /commission to Mediation Agent DO
   → payload: { workGraphId, workGraphVersion, arangoLineageRefs }
4. Await response
   → success: write CommissionRecord to ArangoDB; produce VCR
   → error: log to ArangoDB; surface to We-layer; do not retry automatically
5. Start polling loop (see §3.2)
```

**Elucidation on commission**: every commission is a Disposition Event
(the Commissioning Agent selects this WorkGraph version from the candidate
set of available versions). Axiom A9 applies. The Commissioning Agent
produces an Elucidation Artifact recording:
- the WorkGraph versions considered (Candidate Set)
- the constraints applied to select among them
- the rejected alternatives and reasons

This is written to ArangoDB before the commission call is made.

### 3.2 Polling Loop

The Commissioning Agent polls the Mediation Agent DO at a configured
cadence (default: every 5 minutes for active repos, every 30 minutes for
idle repos). Each poll:

```
1. GET /state from Mediation Agent DO
2. Read VerificationProcessState + ActiveDivergenceSet
3. For each new open Divergence:
   a. Classify: blocking | advisory | informational
   b. If blocking: trigger Hypothesis formation (§3.3)
   c. If advisory: log to ArangoDB; surface in next We-layer briefing
   d. If informational: log to ArangoDB
4. Update repo health record in ArangoDB
5. If Fidelity Verdict is unfavorable AND blocking Divergences present:
   evaluate auto-suspend threshold (see §3.5)
```

### 3.3 Hypothesis Formation

Triggered by: a `blocking` or `advisory` Divergence in the active set that
does not yet have a corresponding Hypothesis.

```
1. Read Divergence from ArangoDB (full record via lineage ref)
2. Read relevant Elucidation Artifacts (from original commission Disposition)
3. Form Hypothesis:
   - attributes_fault_to: which entity (atom, detector spec, WorkGraph claim)
   - proposes: corrective response
   - supported_by: Execution-Trace fragments + Elucidation Artifact refs
4. Write HYP-* artifact to ArangoDB with lineage edges:
   - explains → Divergence
   - motivated_by → Elucidation Artifact(s)
5. For blocking Hypotheses: immediately trigger Amendment proposal (§3.4)
   For advisory Hypotheses: queue for next Disposition cadence
```

Hypothesis formation is the only place in the Commissioning Agent where
LLM inference is invoked. Model routing: Claude Opus (synthesis/interpretive)
via `@factory/harness-bridge` provider dispatch. The Hypothesis is
structured output against the `Hypothesis` Zod schema in `@factory/schemas`.

### 3.4 Amendment Proposal

Triggered by: a Hypothesis with `proposes: corrective response`.

```
1. Translate Hypothesis corrective response into a WorkGraph diff
   (specific atoms to modify, claims to add/remove/change)
2. Write AMD-* artifact to ArangoDB:
   - proposes_modification_of → current WG-* version
   - motivated_by → HYP-* artifact
3. Submit AMD-* to compiler for Coherence Verification
   → compiler runs Coherence Verification-Process against the proposed diff
   → produces Verdict: favorable | unfavorable
4. If favorable:
   a. Produce successor WG-* (compiler emits new version)
   b. This is a Disposition Event: produce Elucidation Artifact
   c. Call Commission Flow (§3.1) with new WG-* version
   d. Produce VCR
5. If unfavorable:
   a. Log verdict to ArangoDB with lineage to AMD-*
   b. Surface to We-layer for human-authorized Disposition
   c. Mediation Agent remains on current WG-* version
```

Amendments that fail Coherence Verification are not abandoned — they are
surfaced to the We-layer with their Verdict attached. The We-layer agent
(human-authorized) may override, modify, or reject. The Commissioning Agent
does not retry a failed Amendment autonomously.

### 3.5 Auto-Suspend Policy

The Commissioning Agent evaluates auto-suspend on every poll when:
- Fidelity Verdict is `unfavorable`
- One or more `blocking` Divergences are open
- The open blocking Divergences have been present for longer than
  `AUTO_SUSPEND_THRESHOLD` (default: 3 consecutive poll cycles)

On threshold breach:

```
1. POST /suspend to Mediation Agent DO
2. Write SuspensionRecord to ArangoDB with:
   - trigger: the blocking Divergences that caused suspension
   - timestamp
   - auto_suspended: true
3. Emit escalation event to We-layer:
   - payload: Divergence set, Hypothesis (if formed), SuspensionRecord
4. Wait for We-layer Disposition
   (DO NOT auto-resume — resume requires human-authorized Disposition)
```

Auto-resume is not permitted. Resumption requires an explicit We-layer
Disposition Event followed by a new commission call.

### 3.6 We-Layer Escalation

The Commissioning Agent escalates to the We-layer in three cases:

| Case | Payload | Expected We-layer action |
|------|---------|-------------------------|
| Commission failure (Coherence unfavorable) | WG-* + Verdict | Produce new WorkGraph or approve override |
| Blocking Divergences → auto-suspend | Divergences + Hypothesis + SuspensionRecord | Authorize resume + amendment or terminate repo |
| Amendment fails Coherence Verification | AMD-* + Verdict | Authorize manual override or produce new Amendment |

Escalation is a push to the WeOps gateway. The Commissioning Agent does
not poll for a response — it waits for a new We-layer commissioning signal.

---

## 4. Artifact Schema

### 4.1 CommissionRecord

```typescript
// ArangoDB collection: commission_records
// ID prefix: CMR-
type CommissionRecord = {
  _key: string                   // CMR-{repoId}-{timestamp}
  repoId: string
  workGraphId: string
  workGraphVersion: string
  commissionedAt: string         // ISO 8601
  mediationAgentDoKey: string
  elucidationArtifactId: string  // ELC-* ref (required per A9)
  status: 'success' | 'error'
  errorReason?: string
  source: 'commissioning-agent'
  explicitness: 'stated'
}
```

### 4.2 Elucidation Artifact (Commission)

```typescript
// ArangoDB collection: elucidation_artifacts
// ID prefix: ELC-
type CommissionElucidationArtifact = {
  _key: string                   // ELC-CMR-{repoId}-{timestamp}
  dispositionEventType: 'commission'
  candidateSet: {
    workGraphVersions: string[]  // all versions available at time of commission
  }
  selectedOption: string         // workGraphVersion chosen
  rejectedOptions: Array<{
    workGraphVersion: string
    rejectionReason: string
  }>
  constraintsApplied: string[]   // e.g., "Coherence Verdict favorable", "latest version"
  producedAt: string
  producedBy: string             // Commissioning Agent instance ID
  source: 'commissioning-agent'
  explicitness: 'stated'
}
```

### 4.3 VCR (Verdict Closure Record)

```typescript
// ArangoDB collection: vcrs
// ID prefix: VCR-
type VCR = {
  _key: string
  dispositionEventType: 'commission' | 'amendment-adoption' | 'suspension' | 'resumption'
  repoId: string
  workGraphVersion: string
  verdict: 'favorable' | 'unfavorable'
  verdictSource: 'coherence-verification' | 'fidelity-verification' | 'we-layer-override'
  producedAt: string
  linkedArtifacts: string[]      // CMR-*, AMD-*, ELC-* refs
  source: 'commissioning-agent'
  explicitness: 'stated'
}
```

---

## 5. HTTP API

The Commissioning Agent exposes endpoints for the We-layer gateway and
the Architect Agent. It does not expose endpoints to Conducting Agents.

### 5.1 `POST /commission`

Received from: WeOps gateway.

```typescript
// Request
{
  repoId: string
  workGraphId: string
  workGraphVersion: string
  commissionedBy: string         // We-layer agent or human ID
}

// Response
{
  status: 'commissioned' | 'rejected' | 'error'
  commissionRecordId?: string    // CMR-* if commissioned
  reason?: string                // if rejected or error
}
```

### 5.2 `POST /resume`

Received from: WeOps gateway (after We-layer Disposition authorizes resume).

```typescript
// Request
{
  repoId: string
  authorizedBy: string
  newWorkGraphId?: string        // if We-layer provides a new WG-*
  dispositionArtifactId: string  // We-layer Elucidation Artifact ref
}
```

Triggers Commission Flow (§3.1) with the new or current WorkGraph.

### 5.3 `GET /health/{repoId}`

Returns current repo governance health: lifecycle state, active Divergence
count by severity, last commission timestamp, pending Amendment count.

### 5.4 `POST /override` (Architect Agent only)

Emergency override for Factory-wide incidents. Accepts a signed directive
from the Architect Agent DO. Actions: `force-suspend`, `force-resume`,
`emergency-patch`. All overrides produce a VCR with
`verdictSource: 'we-layer-override'`.

---

## 6. Lineage Discipline

Every artifact written to ArangoDB by the Commissioning Agent carries:

```typescript
{
  source: 'commissioning-agent',
  commissioningAgentInstanceId: string,
  repoId: string,
  workGraphVersion: string,
  explicitness: 'stated'
}
```

Lineage edges written on each operation:

| Operation | Edge written |
|-----------|-------------|
| Commission | CMR-* → WG-* (`commissions`) |
| Commission | CMR-* → ELC-* (`elucidated_by`) |
| Hypothesis | HYP-* → DIV-* (`explains`) |
| Hypothesis | HYP-* → ELC-* (`informed_by`) |
| Amendment | AMD-* → HYP-* (`motivated_by`) |
| Amendment | AMD-* → WG-* (`proposes_modification_of`) |
| Amendment adoption | WG-*_successor → AMD-* (`produced_by`) |
| VCR | VCR-* → CMR-* or AMD-* (`closes`) |

---

## 7. Model Routing

The Commissioning Agent makes one category of LLM call: Hypothesis
formation (§3.3). All other operations are deterministic.

| Operation | Model | Rationale |
|-----------|-------|-----------|
| Hypothesis formation | Claude Opus (synthesis) via `@factory/harness-bridge` | Interpretive: fault attribution from Divergence evidence requires conceptual-tier reasoning |
| Amendment diff generation | GPT-5.5 (planning) via `@factory/harness-bridge` | Structural: WorkGraph diff is a planning operation |
| All other operations | No LLM | Deterministic artifact reads/writes |

---

## 8. Environment Bindings

```typescript
// Required Cloudflare Worker bindings
type Env = {
  ARANGO_URL: string
  ARANGO_DB: string
  ARANGO_TOKEN: string
  MEDIATION_AGENT: DurableObjectNamespace     // for DO stub lookup
  WEOPS_GATEWAY_URL: string                   // We-layer escalation endpoint
  HARNESS_BRIDGE_URL: string                  // @factory/harness-bridge for LLM calls
  AUTO_SUSPEND_THRESHOLD_CYCLES: string       // default "3"
  POLL_INTERVAL_ACTIVE_MS: string             // default "300000" (5 min)
  POLL_INTERVAL_IDLE_MS: string               // default "1800000" (30 min)
}
```

---

## 9. Relationship to Architect Agent

The Architect Agent is a separate singleton DO (not specified here) with
governance authority over Factory-wide concerns. The Commissioning Agent
is subordinate to the Architect Agent in one dimension only: emergency
lifecycle overrides via `POST /override` (§5.4).

The Commissioning Agent does not report telemetry to the Architect Agent
on the normal polling path. The Architect Agent reads ArangoDB directly
for cross-repo anomaly detection and pipeline configuration decisions.

---

## 10. Open Items

| Item | Owner | Blocking |
|------|-------|---------|
| WorkGraph diff schema (`AtomDirective` fields) — needed for Amendment diff generation (§3.4) | Architect | Yes — shared blocker with Mediation Agent DO spec |
| Divergence severity classification policy (blocking / advisory / informational thresholds) | Architect | Yes — needed for §3.2 polling and §3.5 auto-suspend |
| WeOps gateway escalation contract (endpoint, auth, payload schema) | WeOps layer | No — can stub initially |
| Hypothesis Zod schema in `@factory/schemas` | Engineering | No — can draft from §4 types |
| We-layer Disposition cadence integration (when does a queued advisory Hypothesis get surfaced?) | Architect | No — advisory path is non-blocking for v1 |
