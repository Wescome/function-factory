# Factory External Interface — gRPC + GraphQL

**Status:** Draft v3 · **Date:** 2026-06-13 · **Author:** Wislet J. Celestin / Koales.ai  
**v2 → v3:** Gas City retired; Orchestrator DO retired; WOSSM entry state corrected; pipeline states updated to SM1 (ThinkExecutor/Mastra stack); `SessionEventKind` extended with bead and amendment events; deployment topology rewritten; OPEN-Q-2 closed (DO SQLite + ArtifactGraphDO). Stack now: Commissioning Agent (Mastra Workflow T1) · Mediation Agent DO (compile-only) · CoordinatorDO (bead DAG) · ThinkExecutor + Mastra Agent (per-atom) · LoopClosureService (outcome + amendment).  
**Predecessor specs:** WGSP-Envelope-SRD-v1.0.0 · Decision-Field-SDK-Integration-SRD-v1.0.0 · FF-ONTOLOGY-v0.2 · SPEC-FF-ILAYER-EXEC-001 v2.0 · SPEC-WEOPS-GATEWAY-BOUNDARY-001 v1.1 · SPEC-FF-COORDINATOR-DO-001 · SPEC-FF-GAP-CLOSURES-001 · AOMA-KDS-v1.4.0

**Retired vocabulary (hard-fail if used in implementation):**  
Gas City · `birthGate` · `SYNTHESIS_QUEUE` · Orchestrator DO · DREAM-DO-SPEC · `RESOURCE_EXHAUSTED` (Gas City budget) · WOSSM `SUBMITTED` as Factory entry gate · `GasCitySupervisor` keepalive · `COMPILATION_STAGE` event kind

---

## §0 — Purpose and Scope

This document specifies the external interface surface through which callers outside the Factory's Cloudflare-native substrate submit, observe, and query governed compilation sessions.

Two transports are specified:

**gRPC** — the submission and control plane. Low-latency, strongly-typed, bidirectional-streaming. Used by CI/CD pipelines, coding-agent triggers, and WeOps Kernel submitting intent specifications for compilation and dispatching agent calls.

**GraphQL** — the observation and query plane. Used by developer tooling, dashboards, and audit consumers reading session state, lineage graphs, verification reports, and durable artifact paths.

The two surfaces are complementary and non-overlapping. gRPC owns writes and lifecycle control. GraphQL owns reads and subscriptions.

---

## §1 — Architectural Ground

### 1.1 What "external" means

The Factory's execution substrate is Cloudflare-native: Durable Objects (Mediation Agent DO, CoordinatorDO, ArtifactGraphDO), Workers (Commissioning Agent, ThinkExecutor), Queues (AtomDirective delivery), CF Sandbox (execution boundary), `@cloudflare/shell` (workspace filesystem). All internal coordination is intra-Cloudflare.

"External" means any caller that does not run inside the Cloudflare boundary. This includes: CI/CD pipelines (GitHub Actions, Linear triggers), developer CLI tools, WeOps Kernel (dispatching governed work orders to Factory), and strategy/formulation layers submitting intent specifications.

### 1.2 The WGSP Envelope is the canonical payload

Per WGSP-Envelope-SRD-v1.0.0 §0.1, the WGSP Universal Governance Envelope is the canonical wire-level value crossing every agent boundary. This applies to the Factory external interface without exception.

Every gRPC submission is an envelope. Every gRPC response is an envelope. The gRPC service is not a bespoke Factory API — it is a WGSP envelope transport with Factory-specific content in the `work_graph` slot.

GraphQL queries read the durable state that Factory components have written to D1, DO SQLite, and ArtifactGraphDO. They do not modify state.

### 1.3 Durable State Module — storage substrate

| Store | Contents |
|---|---|
| DO SQLite (Mediation Agent DO, per-repo) | `compiled_molecules`, `meta` — compile-time artifacts |
| DO SQLite (CoordinatorDO, per-run) | `execution_beads`, `bead_edges`, `consent_beads`, `meta` |
| ArtifactGraphDO (DO, per-repo, append-only) | `SpecificationNode`, `AtomDirective`, `ExecutionTrace`, `Hypothesis`, `Amendment`, `Verdict` nodes |
| D1 `factory-artifacts` | artifact metadata rows (id, kind, session_id, r2_path, content_hash), lineage_edges |
| D1 `factory-ops` | session_state, pipeline_run_state, bead audit rows, evidence_bundles |
| D1 `factory-registry` | provider_registry, trust_scores, assembly_manifests, domain_packs |
| R2 `factory-blobs` | artifact content, WGSP envelopes, reports (content > 2 MB D1 row limit) |

### 1.4 Factory Execution Stack

```
CommissioningSignal (WeOps Gateway)
  │
  ▼
Commissioning Agent  (CF Worker · Mastra Workflow T1)
  │  deliberates → awaiting_approval → disposition_event
  │  POST /commission → Mediation Agent DO
  ▼
Mediation Agent DO  (CF Durable Object · compile-only)
  │  nine-step compile sequence → SEEDED
  │  POST /init + /seed → CoordinatorDO
  │  CF Queue message → ThinkExecutor (one per atom)
  ▼
CoordinatorDO  (CF Durable Object · bead DAG owner)
  │  claimBead / releaseBead / failBead loop
  │  5-min alarm rescues stale in_progress beads
  ▼
ThinkExecutor  (@cloudflare/think · durable fiber)
  │  executeAtom(directive, mastraAgent, coordinatorDO)
  │  writes specFiles to @cloudflare/shell workspace
  ▼
Mastra Agent  (buildConductingAgent() · LLM loop)
  │  ConsentBeadAuditProcessor → ConsentBead written per tool call
  │  ToolCallFilter (secondary gate)
  ▼
LoopClosureService  (outcome + amendment lifecycle)
  │  recordOutcome() → ExecutionTrace → ArtifactGraphDO
  │  BP1–BP3 divergence detection → Hypothesis → Amendment
  └── ArtifactGraphDO (append-only governance node store)
```

### 1.5 Pipeline Run States (SM1)

The Commissioning Agent Mastra Workflow T1 owns the top-level pipeline state machine:

```
signal_received → deliberating → awaiting_approval
  → disposition_event → compiling → executing
  → synthesis_passed → deploying → monitored [terminal]
  → synthesis_failed → divergence → amendment loop [or terminal]
  → compile_failed [terminal]
  → rejected [terminal]
```

The gRPC `SessionEventKind` enum maps to these states (§2.2).

---

## §2 — gRPC Service Definition

### 2.1 Service: `FactoryGateway`

```protobuf
syntax = "proto3";
package weops.factory.v1;

import "google/protobuf/timestamp.proto";
import "google/protobuf/struct.proto";

service FactoryGateway {
  rpc SubmitSession(SubmitSessionRequest)
      returns (stream SessionEvent);

  rpc CancelSession(CancelSessionRequest)
      returns (CancelSessionResponse);

  rpc AcknowledgeReview(AcknowledgeReviewRequest)
      returns (AcknowledgeReviewResponse);

  rpc ResumeStream(ResumeStreamRequest)
      returns (stream SessionEvent);
}
```

### 2.2 Core message types

```protobuf
message SubmitSessionRequest {
  WGSPEnvelope envelope    = 1;
  StreamMode   stream_mode = 2;

  enum StreamMode {
    EVENTS_ONLY    = 0;
    WITH_ARTIFACTS = 1;
  }
}

message SessionEvent {
  string                   session_id    = 1;
  string                   work_order_id = 2;
  google.protobuf.Timestamp occurred_at  = 3;
  SessionEventKind         kind          = 4;

  oneof payload {
    StateTransitionPayload state_transition = 10;
    VerificationPayload    verification     = 11;
    ArtifactPayload        artifact         = 12;
    ReviewPromptPayload    review_prompt    = 13;
    BeadPayload            bead             = 14;
    AmendmentPayload       amendment        = 15;
    ErrorPayload           error            = 16;
    TerminalPayload        terminal         = 17;
  }
}

enum SessionEventKind {
  // Pipeline-level (SM1 — Commissioning Agent Mastra Workflow T1)
  SESSION_SUBMITTED        = 0;   // signal_received → deliberating
  CANDIDATE_SET_BUILT      = 1;   // deliberating → awaiting_approval
  APPROVAL_GRANTED         = 2;   // awaiting_approval → disposition_event
  COMPILATION_STARTED      = 3;   // disposition_event → compiling (Mediation Agent DO begins)
  COMPILATION_COMPLETE     = 4;   // compiling → executing (CoordinatorDO seeded, Queue messages sent)
  COMPILATION_FAILED       = 5;   // compile_failed [terminal]
  EXECUTION_COMPLETE       = 6;   // synthesis_passed
  EXECUTION_FAILED         = 7;   // synthesis_failed
  DEPLOYING                = 8;   // synthesis_passed → deploying
  MONITORED                = 9;   // deploying → monitored [terminal]

  // Bead-level (SM3 — CoordinatorDO)
  BEAD_CLAIMED             = 10;  // ready → in_progress (ThinkExecutor claimed atom)
  BEAD_RELEASED            = 11;  // in_progress → done (releaseBead)
  BEAD_FAILED              = 12;  // in_progress → failed (failBead)
  BEAD_RESCUED             = 13;  // stale in_progress → ready (5-min alarm)

  // Governance (SM6 — ConsentBead · SM7 — Amendment · SM8 — LoopClosureService)
  CONSENT_BEAD_DENIED      = 14;  // ConsentDeniedError — tool blocked (I4)
  VERIFICATION_PRODUCED    = 15;  // Coherence (at compile) or Fidelity (at outcome via LoopClosureService)
  ARTIFACT_WRITTEN         = 16;  // ArtifactGraphDO append
  DIVERGENCE_DETECTED      = 17;  // LoopClosureService BP1–BP3
  AMENDMENT_PROPOSED       = 18;  // Amendment CANDIDATE written to ArtifactGraphDO
  AMENDMENT_ADOPTED        = 19;  // Mastra eval T4 → ADOPTED
  AMENDMENT_REJECTED       = 20;  // Mastra eval T4 → REJECTED

  // Review (human-in-the-loop)
  REVIEW_REQUIRED          = 21;  // awaiting_approval gate (Mastra suspend())
  REVIEW_RESOLVED          = 22;  // run.resume() called

  // Terminal
  SESSION_COMPLETED        = 23;
  SESSION_FAILED           = 24;
  SESSION_CANCELLED        = 25;
}
```

### 2.3 Payload types

```protobuf
message StateTransitionPayload {
  string from_state          = 1;  // SM1 state name
  string to_state            = 2;
  string trigger             = 3;
  string evidence_chain_hash = 4;  // ArtifactGraphDO evidence chain root at transition
}

message VerificationPayload {
  string          verification_kind = 1;  // COHERENCE | FIDELITY
  bool            passed            = 2;
  string          verdict_summary   = 3;
  string          report_r2_path    = 4;
  repeated string failed_criteria   = 5;
  // COHERENCE: produced by Mediation Agent DO nine-step compile sequence step 4
  // FIDELITY:  produced by LoopClosureService BP1–BP3 after releaseBead/failBead
}

message BeadPayload {
  string atom_id    = 1;
  string run_id     = 2;
  string agent_id   = 3;  // ThinkExecutor instance
  string bead_status = 4; // ready | in_progress | done | failed
  uint32 duration_ms = 5; // for BEAD_RELEASED / BEAD_FAILED
  string error_code  = 6; // for BEAD_FAILED: 'governance_violation' | 'recoverable' | 'provider_error'
}

message AmendmentPayload {
  string amendment_id  = 1;
  string atom_id       = 2;
  string hypothesis_id = 3;
  string status        = 4;  // CANDIDATE | ADOPTED | REJECTED
  string divergence_id = 5;
}

message ArtifactPayload {
  string artifact_kind   = 1;  // ArtifactKind enum value
  string artifact_id     = 2;
  string r2_path         = 3;
  string content_hash    = 4;
  string lineage_edge_id = 5;
}

message ReviewPromptPayload {
  string                   case_id             = 1;
  string                   node_code           = 2;
  EpistemicSurface         epistemic_surface   = 3;
  repeated OptionScore     alternatives        = 4;
  string                   review_deadline_iso = 5;
}

message TerminalPayload {
  string       terminal_state     = 1;  // COMPLETED | FAILED | CANCELLED
  string       outcome_summary    = 2;
  string       final_spec_r2_path = 3;
  string       coverage_r2_path   = 4;
  WGSPEnvelope seal_envelope      = 5;  // SEAL WGEM event envelope
}

message CancelSessionRequest  { string session_id = 1; string work_order_id = 2; string reason = 3; }
message CancelSessionResponse { bool accepted = 1; string reason = 2; }

message AcknowledgeReviewRequest {
  string         session_id         = 1;
  string         work_order_id      = 2;
  string         case_id            = 3;
  ReviewDecision decision           = 4;
  string         justification      = 5;
  string         override_option_id = 6;

  enum ReviewDecision { APPROVE = 0; REJECT = 1; }
}
message AcknowledgeReviewResponse { bool accepted = 1; string reason = 2; }

message ResumeStreamRequest {
  string session_id      = 1;
  string work_order_id   = 2;
  uint64 from_sequence   = 3;  // 0 = replay from session start
}
```

### 2.4 FactoryPayload — the `work_graph` content

```protobuf
message FactoryPayload {
  oneof intent_spec_source {
    string intent_spec_text    = 1;
    string intent_spec_r2_path = 2;
  }
  string                   function_proposal_id = 3;
  string                   assembly_id          = 4;
  string                   domain               = 5;
  FactoryCompilationConfig config               = 6;
}

message FactoryCompilationConfig {
  bool   run_fidelity_verification = 1;
  string provider_id               = 2;  // "anthropic/claude-opus-4-6" | "openai/gpt-5.5" | etc.
  uint32 timeout_seconds           = 3;
  bool   stream_artifacts          = 4;
}
```

### 2.5 Authentication and authorization

All gRPC calls are authenticated via OIDC JWT in the `Authorization: Bearer <token>` metadata header. Validated by the WeOps Kernel PDP before the request reaches any Factory DO. A session not covered by a valid DEL expression for the caller's BCO path is rejected at the PDP with `DENY` before the Commissioning Agent Mastra Workflow is initialized.

### 2.6 Error model

| gRPC Status | Meaning |
|---|---|
| `OK` | Session terminal — check TerminalPayload |
| `UNAUTHENTICATED` | OIDC token missing or invalid |
| `PERMISSION_DENIED` | PDP returned DENY for caller's DEL-gated BCO path |
| `INVALID_ARGUMENT` | Envelope schema validation failed (missing required field, bad `actor_type`, non-BCO `purpose_id`) |
| `FAILED_PRECONDITION` | Commissioning Agent not in state to accept signal (e.g. already compiling) |
| `NOT_FOUND` | `session_id` / `work_order_id` unknown to CoordinatorDO or Mediation Agent DO |
| `UNAVAILABLE` | ThinkExecutor fiber evicted (CF eviction) or CoordinatorDO hibernated — retry with `ResumeStream` |

`UNAVAILABLE` is the only status implying the session may still be live. All others are terminal for the call; the session state is unchanged.

---

## §3 — GraphQL Schema

Read-only. Exposes Factory durable state (DO SQLite + ArtifactGraphDO + D1 + R2) as a typed graph. No mutations.

### 3.1 Root types

```graphql
type Query {
  session(id: ID!): FactorySession
  sessions(assemblyId: ID!, status: SessionStatus, limit: Int = 20, cursor: String): SessionPage!
  artifact(id: ID!): FactoryArtifact
  lineage(artifactId: ID!, depth: Int = 3): LineageGraph!
  sessionsByWorkOrder(workOrderId: ID!): [FactorySession!]!
  beads(runId: ID!): [ExecutionBead!]!
  amendments(runId: ID!): [Amendment!]!
}

type Subscription {
  sessionEvents(sessionId: ID!): FactorySessionEvent!
  artifactWrites(assemblyId: ID!): ArtifactWriteEvent!
  beadUpdates(runId: ID!): BeadUpdateEvent!
}
```

### 3.2 Core types

```graphql
type FactorySession {
  id: ID!
  workOrderId: ID!
  assemblyId: ID!
  functionProposalId: ID!
  domain: String!
  status: SessionStatus!
  pipelineState: String!           # SM1 state name (signal_received | deliberating | compiling | etc.)
  startedAt: String!
  completedAt: String
  intentSpec: IntentSpecRef!
  executableSpec: FactoryArtifact
  verificationReports: [VerificationReport!]!
  artifacts(kinds: [ArtifactKind!]): [FactoryArtifact!]!
  evidenceChain: EvidenceChain!
  epistemicSurface: EpistemicSurface
  lineageEdges: [LineageEdge!]!
  coverageReport: FactoryArtifact
  pendingReview: ReviewPrompt
  beads: [ExecutionBead!]!        # CoordinatorDO bead graph
  amendments: [Amendment!]!       # ArtifactGraphDO amendment nodes
}

enum SessionStatus {
  SUBMITTED DELIBERATING AWAITING_APPROVAL COMPILING EXECUTING
  SYNTHESIS_PASSED DEPLOYING MONITORED
  SYNTHESIS_FAILED COMPILE_FAILED REJECTED
  COMPLETED FAILED CANCELLED
}

type ExecutionBead {
  atomId: ID!
  runId: ID!
  status: BeadStatus!
  assignedTo: String             # ThinkExecutor agent_id when in_progress
  claimedAt: String
  releasedAt: String
  durationMs: Int
  errorCode: String
  consentBeads: [ConsentBead!]!
}

enum BeadStatus { UNSEEDED READY IN_PROGRESS DONE FAILED }

type ConsentBead {
  id: ID!
  atomId: ID!
  toolName: String!
  verdict: ConsentVerdict!
  producedAt: String!
}

enum ConsentVerdict { ALLOWED DENIED }

type Amendment {
  id: ID!
  atomId: ID!
  hypothesisId: ID!
  divergenceId: ID!
  status: AmendmentStatus!
  proposedAt: String!
  resolvedAt: String
}

enum AmendmentStatus { CANDIDATE ADOPTED REJECTED }

type IntentSpecRef {
  sourceKind: String!   # "inline" | "r2"
  r2Path: String
  contentHash: String!
}

type FactoryArtifact {
  id: ID!
  kind: ArtifactKind!
  sessionId: ID!
  r2Path: String!
  contentHash: String!
  createdAt: String!
  lineageEdge: LineageEdge
  upstreamArtifacts: [FactoryArtifact!]!
}

enum ArtifactKind {
  INTENT_SPECIFICATION ATOMIC_CLAIM_SET CONTRACT_SET
  INVARIANT_SPECIFICATION EXECUTABLE_SPECIFICATION
  VERIFICATION_REPORT LINEAGE_EDGE_RECORD ELUCIDATION_ARTIFACT COVERAGE_REPORT
  EXECUTION_TRACE HYPOTHESIS AMENDMENT VERDICT
}

type VerificationReport {
  id: ID!
  kind: VerificationKind!
  sessionId: ID!
  passed: Boolean!
  verdictSummary: String!
  failedCriteria: [String!]!
  producedAt: String!
  artifact: FactoryArtifact!
}

enum VerificationKind {
  COHERENCE          # Mediation Agent DO compile step 4
  FIDELITY           # LoopClosureService BP1–BP3 after bead completion
}

type EvidenceChain {
  sessionId: ID!
  root: String!
  tip: String!
  bundleCount: Int!
  bundles: [EvidenceBundle!]!
}

type EvidenceBundle {
  id: ID!
  workOrderId: ID!
  sequenceNumber: Int!
  kind: String!         # PROPOSAL | RESULT | BOUNDARY | SEAL
  pdpDecision: String   # PERMIT | DENY
  evidenceHash: String!
  priorHash: String!
  producedAt: String!
}

type LineageEdge {
  id: ID!
  sourceArtifactId: ID!
  targetArtifactId: ID!
  transformationType: String!
  explicitnessTag: String!  # STATED | INFERRED | INTERPOLATED
  producedAt: String!
}

type LineageGraph {
  rootArtifactId: ID!
  nodes: [FactoryArtifact!]!
  edges: [LineageEdge!]!
}

type ReviewPrompt {
  caseId: ID!
  nodeCode: String!
  epistemicSurface: EpistemicSurface!
  alternatives: [OptionScore!]!
  reviewDeadline: String!
}

type EpistemicSurface {
  decisionId: String!
  selectedOption: String
  decisionEntropy: Float!
  decisionMargin: Float!
  alternativePressure: Float!
  governanceFriction: Float!
  topKAlternatives: [OptionScore!]!
  policyRefs: [String!]!
  requiresDownstreamReview: Boolean!
}

type OptionScore       { optionId: String!; score: Float! }
type SessionPage       { sessions: [FactorySession!]!; cursor: String; hasMore: Boolean! }
type FactorySessionEvent { sessionId: ID!; workOrderId: ID!; occurredAt: String!; kind: String!; payload: JSON! }
type ArtifactWriteEvent  { artifactId: ID!; kind: ArtifactKind!; sessionId: ID!; r2Path: String!; contentHash: String!; occurredAt: String! }
type BeadUpdateEvent     { atomId: ID!; runId: ID!; status: BeadStatus!; occurredAt: String! }
```

### 3.3 GraphQL resolver data sources

The `factory-graphql` Worker resolves against sources depending on query type:

| Query | Source |
|---|---|
| Live pipeline state (`pipelineState`, `status`) | Commissioning Agent Mastra Workflow state (stub-fetch CF Worker) |
| Bead execution state (`beads`, `ExecutionBead`) | CoordinatorDO stub-fetch — `GET /next`, `execution_beads` DO SQLite |
| Governance nodes (artifacts, amendments, hypotheses, verdicts) | ArtifactGraphDO stub-fetch (append-only DO, per-repo) |
| Historical sessions, artifact metadata, lineage | D1 `factory-ops` + `factory-artifacts` (CoordinatorDO flushes bead audit rows; LoopClosureService flushes trace rows) |
| Artifact content | R2 `factory-blobs` (on demand, via `r2_path` from D1 row) |

The `lineage` query resolves via recursive CTE on `factory-artifacts.lineage_edges` up to the requested depth. Default depth 3. Depth > 5 rejected with query error.

### 3.4 Subscription transport

GraphQL Subscriptions use WebSockets (graphql-ws protocol). The `factory-graphql` Worker fans out from DO event log entries to subscribed clients, consistent with CF DO hibernation semantics. Reconnection and replay contract is an open question (OPEN-Q-3).

---

## §4 — Interface Contracts and Invariants

**I-EXT-01 Envelope primacy.** Every gRPC call carries a well-formed WGSP envelope per WGSP-Envelope-SRD-v1.0.0 §5. Calls without `envelope_schema_version: "1.0.0"`, missing `actor_type`, or carrying non-BCO `purpose_id` are rejected with `INVALID_ARGUMENT` before reaching any Factory DO.

**I-EXT-02 GraphQL is read-only.** No state change is reachable via GraphQL. All writes go through gRPC.

**I-EXT-03 Lineage completeness at the interface.** Every `ArtifactPayload` emitted over gRPC carries a `lineage_edge_id`. Every `FactoryArtifact` returned via GraphQL carries a `lineageEdge`. An artifact without lineage must not be returned.

**I-EXT-04 Evidence chain continuity.** `StateTransitionPayload.evidence_chain_hash` on every gRPC event must equal the `evidence_chain_root` of the current WGSP envelope in ArtifactGraphDO at that transition point.

**I-EXT-05 Commissioning Agent entry state.** A `SubmitSessionRequest` is accepted only when the Commissioning Agent Mastra Workflow for the target repo is in a terminal state or has not yet been initialized for this `work_order_id`. A workflow already in `deliberating` or later rejects with `FAILED_PRECONDITION`. (Note: the prior WOSSM `SUBMITTED` check has been replaced by this Factory-internal state check. WOSSM state is a We-layer concern enforced upstream by the WeOps Gateway before the signal reaches the Commissioning Agent.)

**I-EXT-06 Review prompt exclusivity.** At most one active `ReviewPrompt` per session at any time. Concurrent `REVIEW_REQUIRED` events are serialized by the Commissioning Agent Mastra Workflow `suspend()` call.

**I-EXT-07 Terminal stream close.** Stream closes immediately after `TerminalPayload`. No events follow `SESSION_COMPLETED`, `SESSION_FAILED`, or `SESSION_CANCELLED`.

**I-EXT-08 ResumeStream idempotency.** `from_sequence = 0` replays from session start. Events sourced from ArtifactGraphDO (append-only) and D1 bead audit rows — replay is deterministic for completed sessions.

**I-EXT-09 Artifact content in R2, metadata in D1.** No artifact content exceeding 2 MB is written to D1. Content lives in R2; D1 rows carry `r2_path` and `content_hash` only. Violations are write-time errors in the LoopClosureService artifact write path.

**I-EXT-10 ConsentBead written before tool execution (I4).** Every `CONSENT_BEAD_DENIED` event must be backed by a written ConsentBead in CoordinatorDO `consent_beads` (verdict: `denied`). A denied tool call that lacks a ConsentBead record is an invariant violation.

---

## §5 — Deployment Topology

```
External caller (CI/CD, WeOps Kernel, dashboard)
  │
  │  gRPC (TLS, OIDC JWT)                    HTTP/WebSocket (OIDC JWT)
  │                                           │
  ▼                                           ▼
CF Worker: factory-gateway               CF Worker: factory-graphql
  │  WGSP envelope validation              │  Pipeline: Commissioning Agent stub-fetch
  │  PDP validation (kernel PEP call)      │  Beads: CoordinatorDO stub-fetch
  │                                        │  Governance: ArtifactGraphDO stub-fetch
  ▼                                        │  Historical: D1 (factory-ops, factory-artifacts)
Commissioning Agent (CF Worker)           │  Content: R2 on demand
  │  Mastra Workflow T1                    │
  │  deliberating → disposition_event     ◄┘
  │  POST /commission → Mediation Agent DO
  ▼
Mediation Agent DO  (CF Durable Object · compile-only)
  │  Nine-step compile sequence
  │  POST /init + /seed → CoordinatorDO
  │  CF Queue message per atom
  ▼
CoordinatorDO  (CF Durable Object · bead DAG)
  │  claimBead / releaseBead / failBead
  │  Flushes bead audit rows → D1 factory-ops
  ▼
ThinkExecutor  (@cloudflare/think · durable fiber)
  │  executeAtom(directive, mastraAgent, coordinatorDO)
  │  Writes specFiles → @cloudflare/shell workspace
  ▼
Mastra Agent  (buildConductingAgent() · LLM loop inside fiber)
  │  ConsentBeadAuditProcessor → CoordinatorDO consent_beads
  │  ToolCallFilter (secondary gate)
  ▼
LoopClosureService
  │  recordOutcome() → ExecutionTrace → ArtifactGraphDO
  │  BP1–BP3 divergence detection
  │  Amendment lifecycle → ArtifactGraphDO
  │  Flushes artifact metadata → D1 factory-artifacts
  └──────────────────────────────────────────────────────────┐
                                                              ▼
                                            R2: factory-blobs (artifact content)
                                            D1: factory-artifacts (metadata, lineage_edges)
                                            D1: factory-ops (sessions, bead audit, evidence_bundles)
                                            D1: factory-registry (providers, manifests)
                                            ArtifactGraphDO (governance nodes, append-only)
```

---

## §6 — Open Questions

**OPEN-Q-1: gRPC-over-Cloudflare transport.** Options: (a) gRPC-Web, (b) Connect protocol (buf.build/connect — first-class Workers support, recommended), (c) Cloudflare Tunnel to containerized grpc-gateway sidecar. Architect decision required before implementation.

**OPEN-Q-2: CLOSED.** Event log storage is resolved: DO SQLite in Mediation Agent DO (`compiled_molecules`) and CoordinatorDO (`execution_beads`, `consent_beads`). Governance nodes in ArtifactGraphDO (append-only DO). `ResumeStream` replays from D1 bead audit rows + ArtifactGraphDO. No compaction policy needed — both stores are append-only or bead-status-monotonic.

**OPEN-Q-3: GraphQL subscription fan-out.** CF DO hibernation may disconnect subscribers between events. Reconnection and replay contract for subscription clients requires a companion spec.

**OPEN-Q-4: EpistemicSurface source of truth.** Canonical source is the WGSP envelope (populated by Decision Field SDK per Decision-Field-SDK-Integration-SRD §7.2). Whether `factory-graphql` reads from R2-stored envelope or a denormalized `factory-ops` row is an implementation decision with consistency implications.

**OPEN-Q-5: D1 database-per-assembly vs. shared.** The three-database partition in §1.3 is shared across all assemblies. Per-assembly isolation (multi-tenant, regulatory, blast-radius) requires a routing layer in `factory-graphql` and `factory-gateway`. Architect decision required before DDL is written.

---

## §7 — References

- WGSP-Envelope-SRD-v1.0.0
- Decision-Field-SDK-Integration-SRD-v1.0.0
- FF-ONTOLOGY-v0.2
- SPEC-FF-ILAYER-EXEC-001 v2.0
- SPEC-WEOPS-GATEWAY-BOUNDARY-001 v1.1
- SPEC-FF-COORDINATOR-DO-001
- SPEC-FF-GAP-CLOSURES-001
- AOMA-KDS-v1.4.0
