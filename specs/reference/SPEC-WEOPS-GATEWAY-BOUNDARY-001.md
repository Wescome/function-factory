# WeOps Gateway Boundary Specification
**ID**: SPEC-WEOPS-GATEWAY-BOUNDARY-001  
**Version**: 1.1  
**Date**: 2026-06-13  
**Status**: Canonical  
**Author**: Wislet J. Celestin / Koales.ai  
**Stack**: Cloudflare Worker (ff-gateway.koales.workers.dev) + KV + `ff-linear-bridge`  
**Depends on**: SPEC-FF-ILAYER-EXEC-001, SPEC-WEOPS-PRIMITIVES-001, WGSP-Envelope-SRD-v1.0.0, Decision-Field-SDK-Integration-SRD-v1.0.0  
**Out of scope**: WeOps internal governance primitives (CCI, PII, We-Gradient), I-layer internals, Linear integration internals  
**v1.0 → v1.1**: I → We wire protocol updated. Outbound signals are now WGSP envelopes (§4). I-layer envelope signing added (§4.5). Inbound signals remain bare JSON + JWT. Fail behavior table extended for envelope auth. Open items updated.

---

## 0. Purpose and Scope

This document specifies the boundary between the We-layer (WeOps governance) and the I-layer (Factory execution) as enforced by the WeOps Gateway. It defines every signal type that crosses the boundary, the authorization token that governs inbound signals, the gateway's routing and fail behavior, and the A9 enforcement requirement.

The gateway is the single point through which all We → I authority flows and all I → We evidence returns. Nothing crosses the boundary except through the gateway.

### 0.1 Layer Definitions

**We-layer**: WeOps governance runtime. Holds Governance Steward authority. Issues Disposition Events. Interprets strategic significance of I-layer evidence. Authorizes I-layer actions.

**I-layer**: Factory execution runtime. Executes against Specifications. Produces Execution-Traces, Divergences, Verdicts. Surfaces raw governance artifacts. Does not interpret strategic significance.

### 0.2 Boundary Invariants

**B1 — Direction of authority**: The We-layer authorizes; the I-layer executes. No I-layer agent may self-authorize a governance action that the We-layer has not sanctioned. The gateway enforces this by requiring a signed `WeOpsDispositionToken` on all inbound signals.

**B2 — Direction of evidence**: The I-layer produces Execution-Traces, Divergences, and Verdicts. The We-layer receives these as evidence for Disposition Events. The I-layer does not interpret strategic significance. Interpretation is a We-layer function.

### 0.3 Gateway Topology

```
We-layer (WeOps / Linear disposition surface)
  │  inbound signals:  CommissioningSignal, ResumeSignal, PatchAuthSignal,
  │                    PipelineConfigAuthSignal, OverrideSignal
  │  outbound signals: EscalationEvent, HealthSummary, VCR
  ↕
WeOps Gateway  (ff-gateway.koales.workers.dev — CF Worker)
  │  validates: WeOpsDispositionToken on all inbound
  │  routes:    inbound → I-layer agent endpoints
  │  buffers:   outbound EscalationEvents (KV retry queue)
  ↕
I-layer
  ├── Commissioning Agent  (CF Worker, per-repo)
  └── Architect Agent DO   (CF Durable Object, Factory-wide singleton)
```

---

## 1. Signal Taxonomy

Eight signal types cross the boundary. Six carry authority or evidence content; two are observability-only.

### 1.1 Authority and Evidence Signals

| Signal Type | Direction | Authority | Description |
|-------------|-----------|-----------|-------------|
| `CommissioningSignal` | We → I | We-layer | Authorizes a Commissioning Agent to commission a specific WorkGraph to a repo |
| `ResumeSignal` | We → I | We-layer | Authorizes a suspended Commissioning Agent to resume; optionally carries a new WorkGraph |
| `PatchAuthSignal` | We → I | We-layer | Authorizes the Architect Agent to propagate a patch across affected repos |
| `PipelineConfigAuthSignal` | We → I | We-layer | Authorizes the Architect Agent to apply a pipeline config change affecting live repos |
| `OverrideSignal` | We → I | We-layer (elevated) | Emergency lifecycle directive: force-suspend, force-resume, or emergency-patch |
| `EscalationEvent` | I → We | I-layer | Divergence evidence, Hypothesis chain, and suspension state for We-layer Disposition |

### 1.2 Observability Signals (no authority content)

| Signal Type | Direction | Description |
|-------------|-----------|-------------|
| `HealthSummary` | I → We | Periodic repo and Factory health snapshot |
| `VCR` | I → We | Verdict Closure Record produced on every I-layer Disposition Event |

---

## 2. WeOpsDispositionToken

All inbound signals (We → I) must carry a `WeOpsDispositionToken` — a signed JWT issued by `ff-linear-bridge` after a valid Disposition Event is recorded. The gateway validates this token before routing any signal to an I-layer agent. Signals with invalid or missing tokens are rejected at HTTP 401.

### 2.1 JWT Claims Schema

```typescript
type WeOpsDispositionTokenClaims = {
  iss: 'weops-gateway';
  sub: string;                     // commenterLinearId — identity of the disposition author
  aud: 'factory-i-layer';
  exp: number;                     // iat + 300 (5-minute window)
  iat: number;
  jti: string;                     // unique per disposition; stored in KV for replay prevention
  scope: TokenScope[];             // one or more of the scopes below
  dispositionEventId: string;      // ELC-* Elucidation Artifact node ID
  elucidationArtifactId: string;   // same as dispositionEventId
};

type TokenScope =
  | 'we-layer:commission'          // CommissioningSignal, ResumeSignal
  | 'we-layer:patch'               // PatchAuthSignal
  | 'we-layer:pipeline-config'     // PipelineConfigAuthSignal
  | 'we-layer:override';           // OverrideSignal (elevated; requires two-person approval)
```

### 2.2 Token Signing

Signed with `WEOPS_SIGNING_KEY` — the same key used by WeOps Console. The gateway validates independently. Console Phase 1→3 migration requires no key rotation; no I-layer agent sees any change at the gateway boundary.

### 2.3 Token Validation Steps (gateway, on every inbound request)

1. Extract `Authorization: Bearer <token>` header; reject 401 if absent
2. Verify signature against `WEOPS_SIGNING_KEY`
3. Check `exp` — reject 401 if expired
4. Check `jti` against KV replay store — reject 401 if already seen
5. Write `jti` to KV with matching TTL (5 min)
6. Check `scope` against the signal type being delivered — reject 403 if insufficient
7. Check `dispositionEventId` and `elucidationArtifactId` are non-empty — reject 400 if missing (A9 enforcement, §4)
8. Route signal to target I-layer endpoint

### 2.4 Token Issuance Path

Tokens are issued by `ff-linear-bridge` after the full A9 sequence (§4). The bridge is the only authorized token issuer. The We-layer governance surface (Linear) is where human disposition comments are written; the bridge parses them, writes the Elucidation Artifact, and issues the JWT. No token is issued without a successful Elucidation Artifact write.

---

## 3. Inbound Signal Schemas (We → I)

All inbound signals are delivered via `POST /signals` with the `WeOpsDispositionToken` in the `Authorization` header. The `signalType` field determines routing.

### 3.1 CommissioningSignal

```typescript
type CommissioningSignal = {
  signalType: 'CommissioningSignal';
  repoId: string;               // target repo
  workGraphId: string;          // WG-* to commission
  workGraphVersion: string;
  dispositionEventId: string;   // must match token claim
  elucidationArtifactId: string;
  issuedAt: string;
};
```

Routed to: `{commissioningAgentUrl}/commission`

### 3.2 ResumeSignal

```typescript
type ResumeSignal = {
  signalType: 'ResumeSignal';
  repoId: string;
  newWorkGraphId?: string;          // optional — if provided, resumes with new WorkGraph
  newWorkGraphVersion?: string;
  dispositionEventId: string;
  elucidationArtifactId: string;
  issuedAt: string;
};
```

Routed to: `{commissioningAgentUrl}/resume`

### 3.3 PatchAuthSignal

```typescript
type PatchAuthSignal = {
  signalType: 'PatchAuthSignal';
  patchId: string;              // identifies the patch artifact in ArangoDB
  affectedRepoIds: string[];
  dispositionEventId: string;
  elucidationArtifactId: string;
  issuedAt: string;
};
```

Routed to: `{architectAgentDoUrl}/patch`

### 3.4 PipelineConfigAuthSignal

```typescript
type PipelineConfigAuthSignal = {
  signalType: 'PipelineConfigAuthSignal';
  configChangeId: string;
  affectedRepoIds: string[];
  dispositionEventId: string;
  elucidationArtifactId: string;
  issuedAt: string;
};
```

Routed to: `{architectAgentDoUrl}/pipeline-config-auth`

### 3.5 OverrideSignal

```typescript
type OverrideSignal = {
  signalType: 'OverrideSignal';
  directive: 'force-suspend' | 'force-resume' | 'emergency-patch';
  targetRepoId?: string;       // absent = Factory-wide
  patchId?: string;            // for emergency-patch
  dispositionEventId: string;
  elucidationArtifactId: string;
  issuedAt: string;
  // override requires scope 'we-layer:override' AND two-person approval
  // validated upstream by ff-linear-bridge ApprovalFlow
};
```

Routed to: `{commissioningAgentUrl}/override` (if `targetRepoId` set)  
Routed to: `{architectAgentDoUrl}/override` (if Factory-wide)

---

## 4. Outbound Wire Protocol (I → We)

Per Decision-Field-SDK-Integration-SRD-v1.0.0 §1.5, the WGSP envelope is the canonical wire-level value crossing every agent boundary. All outbound I → We signals are WGSP envelopes. Bare JSON payloads are not accepted at the gateway or the We-layer endpoint.

### 4.1 Envelope Structure for Outbound Signals

Every outbound signal is a WGSP envelope (WGSP-Envelope-SRD-v1.0.0 §5):

```typescript
type OutboundEnvelope = {
  envelope_schema_version: '1.0.0';
  envelope_id: string;                    // env_<uuid_v7>
  parent_envelope_id?: string;            // set when derived from an inbound signal
  correlation_id: string;                 // cor_<uuid_v7>; carried through request/response chain
  timestamp: string;                      // RFC 3339 UTC, microsecond precision — REQUIRED (AC-WE-01)
  source: EndpointDescriptor;             // { kernel_id: 'factory-i-layer', agent_id: 'mediation-agent:{repoId}' }
  target: EndpointDescriptor;             // { kernel_id: 'weops-we-layer', agent_id: 'weops-gateway' }
  identity_context: IdentityContext;      // actor_id: repoId, actor_type: 'agent' (SC INV-14)
  session_context: SessionContext;        // session_id: runId, assembly_id: workGraphId
  governance_context: GovernanceContext;  // work_order_id, evidence_chain_root
  work_graph: WorkGraphSubgraph;          // signal content carried here (see §4.2–4.4)
  epistemic_surface?: EpistemicSurface;   // populated for VCR envelopes (§4.4)
  provenance_pointer?: ProvenancePointer; // Evidence Ledger ref per SRD §5.7:
                                          // { ledger_kernel_id, evidence_root_hash,
                                          //   evidence_count, authentication_required }
                                          // Points to upstream evidence chain — NOT a D1 row key
  signature: EnvelopeSignature;           // REQUIRED cross-kernel — see §4.5
};
```

The WGEM event taxonomy applies to all outbound envelopes:

| Signal | WGEM event | Meaning |
|--------|-----------|---------|
| `EscalationEvent` | `PROPOSAL` | I-layer surfaces evidence; We-layer must disposition |
| `VCR` | `RESULT` | Verdict closure — outcome of a Verification-Process |
| `HealthSummary` | `BOUNDARY` | I-layer crosses observability boundary to We-layer |

### 4.2 EscalationEvent Envelope

Signal content carried in `work_graph.durable_objects`:

```typescript
type EscalationPayload = {
  signalType: 'EscalationEvent';
  escalationId: string;            // unique per escalation; used as KV key for retry
  repoId: string;
  divergenceIds: string[];         // INV-* violations that triggered suspension
  hypothesisChain: string[];       // Hypothesis IDs produced by Mediation Agent
  suspensionState: string;         // current Mediation Agent lifecycle state
  openDivergenceCount: number;
  producedAt: string;
  producedBy: string;              // 'mediation-agent:{repoId}'
};
```

Envelope `wgem_event`: `PROPOSAL`  
Delivered via: `POST /escalations` — body is the full WGSP envelope, `Content-Type: application/json`  
If We-layer unavailable: full envelope stored in KV (`escalation:{escalationId}`), retry every 5 min, 7-day TTL.

### 4.3 HealthSummary Envelope

Signal content carried in `work_graph.durable_objects`:

```typescript
type HealthSummaryPayload = {
  signalType: 'HealthSummary';
  factoryRepos: Array<{
    repoId: string;
    lifecycleState: string;
    lastCommissionAt: string;
    openDivergences: number;
  }>;
  producedAt: string;
};
```

Envelope `wgem_event`: `BOUNDARY`  
Delivered via: `GET /health` returns an envelope on pull; `POST /escalations` with `signalType: 'HealthSummary'` on push from Commissioning Agent on schedule.  
If We-layer unavailable: dropped, not retried.

### 4.4 VCR Envelope (Verdict Closure Record)

Signal content carried in `work_graph.durable_objects`. `epistemic_surface` is populated with the Verification-Process metrics:

```typescript
type VCRPayload = {
  signalType: 'VCR';
  vcrId: string;
  dispositionEventId: string;      // the Disposition Event this closes
  verdictType: 'coherence' | 'fidelity';
  verdict: 'favorable' | 'unfavorable';
  atomId?: string;                 // for fidelity verdicts
  repoId: string;
  producedAt: string;
};

// epistemic_surface populated for VCR envelopes:
type VCREpistemicSurface = {
  decision_id: string;             // '{repoId}:{atomId}:{verdictType}'
  selected_option: string;         // 'favorable' | 'unfavorable'
  decision_entropy: number;        // from Verification-Process probe metrics
  decision_margin: number;
  alternative_pressure: number;
  governance_friction: number;
  top_k_alternatives: OptionScore[];
  policy_refs: string[];           // INV-* ids evaluated
  requires_downstream_review: boolean; // true if verdict is 'unfavorable'
};
```

Envelope `wgem_event`: `RESULT`  
Delivered via: `POST /vcrs` — body is the full WGSP envelope  
If We-layer unavailable: full envelope stored in KV (`vcr:{vcrId}`), best-effort retry, 30-day TTL. No I-layer impact.

### 4.5 I-Layer Envelope Signing

All outbound envelopes carry a `signature` field. This is how the gateway authenticates I-layer callers — the outbound direction has no JWT token; it uses envelope signatures instead.

**Signing key**: each Mediation Agent DO and Commissioning Agent Worker holds an `FF_AGENT_SIGNING_KEY` (CF Secret, per-environment). The key is distinct from `WEOPS_SIGNING_KEY` (which is We-layer authority).

**Signature construction** (per WGSP-Envelope-SRD-v1.0.0 §5.8):
```typescript
type EnvelopeSignature = {
  algorithm: 'HMAC-SHA256' | 'Ed25519';
  signing_kernel_id: string;   // 'factory-i-layer'
  signed_at: string;           // RFC 3339 UTC
  signature: string;           // base64; covers RFC 8785 canonical-JSON of all top-level
                               // envelope fields except the `signature` field itself
  canonicalization: 'RFC8785';
};
```

**Factory signing key**: `FF_AGENT_SIGNING_KEY` (CF Secret, per-environment). Distinct from `WEOPS_SIGNING_KEY`. The `signing_kernel_id` is `'factory-i-layer'`; the specific agent identity (`mediation-agent:{repoId}` or `commissioning-agent`) is carried in `source.agent_id` on the envelope.

**Gateway verification steps (outbound)**:
1. Extract `envelope.signature`; reject 401 if absent
2. Verify `signing_kernel_id` is `'factory-i-layer'`; reject 401 if unknown
3. Verify `source.agent_id` is in the known Factory agent KV registry (`agent-key:{agent_id}`); reject 401 if absent
4. Recompute RFC 8785 canonical-JSON of envelope (excluding `signature` field); verify HMAC or Ed25519 signature; reject 401 if mismatch
5. Check `signed_at` within 60s of gateway receipt; reject 401 if stale
6. Accept envelope; forward to We-layer or buffer in KV per signal class

---

## 5. Gateway Endpoint

Single host: `ff-gateway.koales.workers.dev` (Cloudflare Worker)

```
POST /signals       Inbound: We → I   — body: signal JSON + Authorization: Bearer <JWT>
POST /escalations   Outbound: I → We  — body: WGSP envelope (signed)
POST /vcrs          Outbound: I → We  — body: WGSP envelope (signed)
GET  /health        Outbound: I → We  — response: WGSP envelope (signed, on-demand pull)
```

All endpoints use `Content-Type: application/json`.

**Inbound** (`POST /signals`): validated by `WeOpsDispositionToken` JWT (§2). Signal JSON body is not a WGSP envelope — it is the bare signal schema (§3). The JWT carries the governance authority; the signal body carries the routing payload.

**Outbound** (`POST /escalations`, `POST /vcrs`): validated by WGSP envelope signature (§4.5). Body is the full WGSP envelope. Gateway verifies the signature before forwarding. If the We-layer endpoint is unavailable, the full envelope is stored in KV for retry — not just the payload.

### 5.1 Routing Table

| Signal Type | Target endpoint |
|-------------|----------------|
| `CommissioningSignal` | `{commissioningAgentUrl}/commission` |
| `ResumeSignal` | `{commissioningAgentUrl}/resume` |
| `PatchAuthSignal` | `{architectAgentDoUrl}/patch` |
| `PipelineConfigAuthSignal` | `{architectAgentDoUrl}/pipeline-config-auth` |
| `OverrideSignal` (repo-scoped) | `{commissioningAgentUrl}/override` |
| `OverrideSignal` (Factory-wide) | `{architectAgentDoUrl}/override` |

**URL resolution**: `commissioningAgentUrl` is looked up from Architect Agent DO `factory:state` by `repoId`. `architectAgentDoUrl` is the singleton DO stub URL, statically configured in the gateway Worker.

### 5.2 Idempotency

All inbound signal endpoints are idempotent on `jti`. A signal whose `jti` has already been processed returns HTTP 200 with the original cached response (stored in gateway KV, 24h TTL). This prevents duplicate commissions from network retries.

All outbound envelope endpoints are idempotent on `envelope_id`. A duplicate envelope (same `envelope_id`) is acknowledged HTTP 200 without re-forwarding.

---

## 6. Fail Behavior

| Condition | Gateway behavior | I-layer behavior |
|-----------|-----------------|-----------------|
| Inbound: JWT signature invalid | HTTP 401; security event logged | No action; signal not delivered |
| Inbound: JWT expired (`exp` exceeded) | HTTP 401 | No action |
| Inbound: `jti` replay detected | HTTP 200 with cached response | No duplicate action |
| Inbound: JWT `scope` insufficient for signal type | HTTP 403; logged | No action |
| Inbound: `dispositionEventId` or `elucidationArtifactId` absent | HTTP 400; A9ViolationEvent logged and forwarded to We-layer audit stream | No action |
| Inbound: target I-layer agent unavailable | HTTP 503; no retry | Remains in current state |
| Outbound: envelope signature absent | HTTP 401; rejected | No forwarding |
| Outbound: envelope signature invalid or stale | HTTP 401; security event logged | No forwarding |
| Outbound: `envelope_id` replay detected | HTTP 200; not re-forwarded | No duplicate delivery |
| Outbound: `EscalationEvent` delivery to We-layer fails | Full envelope stored in KV (`escalation:{escalationId}`); retry every 5 min; 7-day TTL | Remains suspended; `/dispatch` blocked |
| Outbound: `VCR` delivery to We-layer fails | Full envelope stored in KV (`vcr:{vcrId}`); best-effort retry; 30-day TTL | No I-layer impact |
| Outbound: `HealthSummary` delivery fails | Dropped; not retried | No impact |
| We-layer unavailable; I-layer suspended | I-layer remains suspended indefinitely | Never self-resumes (I4 — fail-closed) |

The I-layer never unblocks itself while awaiting a We-layer response. Invariant I4 (fail-closed) holds even when the gateway is degraded: a suspended Commissioning Agent that cannot reach the We-layer remains suspended rather than self-resuming.

---

## 7. A9 Enforcement

A9 is the invariant that every Disposition Event at the I-layer must be accompanied by an Elucidation Artifact. The gateway enforces A9 structurally at the token validation step — not by policy instruction.

**Enforcement path**:

1. `ff-linear-bridge` receives a disposition comment from Linear
2. Before issuing any token, the bridge produces an `EluciationArtifact` (ELC-*) and writes it to ArangoDB `elucidation_artifacts`
3. If the ArangoDB write fails: no token is issued; bridge replies to Linear comment with error; operator must retry
4. Token carries `dispositionEventId` = `elucidationArtifactId` = the ELC-* node ID
5. Gateway validates both fields are non-empty on every inbound signal (step 7 of §2.3)
6. Any signal missing either field is rejected HTTP 400; an `A9ViolationEvent` is logged and forwarded to the We-layer audit stream

**What this makes structural**: an I-layer action (commission, resume, patch, override) cannot proceed without a recorded Elucidation Artifact. The chain is: disposition comment → ELC-* written → JWT issued → signal delivered → I-layer acts. Breaking any link in the chain stops the signal. A9 is not advisory.

---

## 8. ff-linear-bridge Role

`ff-linear-bridge` is the We-layer disposition surface adapter. It is not part of the gateway; it is the authorized token issuer that feeds the gateway.

**Responsibilities**:
- Parse Linear disposition comments into structured `ParsedDisposition` payloads
- Run authority check against `AuthorityRegistry` (commenter scope validation)
- For `OverrideSignal` dispositions: run two-person ApprovalFlow before token issuance
- Write `EluciationArtifact` to ArangoDB (A9)
- Issue `WeOpsDispositionToken` JWT signed with `WEOPS_SIGNING_KEY`
- POST the appropriate inbound signal to `POST /signals` at the gateway
- Reply to the Linear comment with disposition confirmation or error

**Key constraint**: the bridge is the only entity authorized to issue tokens. The We-layer does not issue tokens directly. Linear does not issue tokens. Only `ff-linear-bridge`, after completing the full A9 sequence, issues a token.

---

## 9. Open Items

| Item | Blocking |
|------|---------|
| `FF_AGENT_SIGNING_KEY` provisioning — key must be set as a CF Secret in the Factory Worker and Mediation Agent DO environments before outbound envelope signing works. Key rotation strategy not yet specified. | Yes for outbound wire. |
| `agent-key:{kid}` KV registry — the gateway KV store needs a populated registry of known Factory agent `kid` values before outbound signature verification works. Initially static; needs a registration protocol for new repos. | Yes for outbound wire. |
| `AuthorityRegistry` storage — registry of `commenterLinearId → scopes` for inbound token issuance. Needs a home before multi-operator environments are supported. | No — single-operator can hardcode. |
| `A9ViolationEvent` schema — audit stream format for A9 violations is referenced but not formally specified. | No — add in next revision. |
| Gateway Worker rate limiting — no rate limit specified for `POST /signals` or `POST /escalations`. Add before production deployment. | No — implementation-time decision. |
| We-layer webhook endpoint — the URL to which the gateway forwards outbound envelopes is not specified in this document. Must be configured in gateway KV (`weops-endpoint:escalations`, `weops-endpoint:vcrs`) before production. | No — deployment-time configuration. |
