# ff-linear-bridge Specification
**ID**: SPEC-FF-LINEAR-BRIDGE-001  
**Version**: 2.0  
**Date**: 2026-06-14  
**Status**: Draft — pending Architect sign-off  
**Layer**: I-layer / We-layer boundary — Linear webhook handler  
**Package**: `workers/linear-bridge/`  
**Depends on**: `packages/schemas`, SPEC-WEOPS-GATEWAY-BOUNDARY-001 v1.1, SPEC-LINEAR-SYNC-SERVICE-001 v2.0  
**v1.0 → v2.0**: ArangoDB retired from bridge execution path. EluciationArtifact writes → ArtifactGraphDO. Security/error logs → D1 `factory-ops`. RejectionRecord → ArtifactGraphDO. Token issuance and gateway call logic unchanged.

---

## 0. Conceptual Preamble

### 0.1 What ff-linear-bridge IS

`ff-linear-bridge` is the We-layer governance console adapter. It converts human Disposition Events performed in Linear into signed gateway signals that the Factory's I-layer can act on.

```
Factory I-layer (auto-suspend, Amendment failure, Divergence threshold exceeded)
  ↓  LoopClosureService → EscalationEvent → WeOps Gateway → We-layer
  ↓  LinearSyncService.createEscalationIssue() creates Linear issue
Linear issue (factory:escalation label)
  ↓  human posts DISPOSITION comment
Linear webhook → ff-linear-bridge
  ↓  parses disposition, validates authority
  ↓  writes EluciationArtifact node to ArtifactGraphDO (A9 — before token)
  ↓  issues WeOpsDispositionToken (signed JWT)
  ↓  POST to WeOps Gateway /signals
WeOps Gateway
  ↓  validates token, routes to CommissioningAgentDO
Factory I-layer resumes
```

### 0.2 Ontological significance

The bridge is where the Disposition Event formally occurs:
- The human posting a `DISPOSITION:` comment is the authority-bound selection from a Candidate Set
- The bridge's parsing of `candidatesConsidered` / `rejectedOptions` produces the EluciationArtifact (A9)
- The JWT is the authority binding
- The ELC-* node in ArtifactGraphDO is the permanent governance record

A9 is mechanical: no ELC-* node written = no token issued = no I-layer action.

### 0.3 Authority model

The bridge maintains an `AuthorityRegistry` in CF KV mapping Linear user IDs to permitted token scopes. `we-layer:override` requires two-person approval.

---

## 1. Webhook Setup

### 1.1 Linear webhook configuration

```
URL: https://ff-linear-bridge.koales.workers.dev/webhook
Events: IssueCommentCreate, IssueUpdate
Filter: team = WeOps, label contains 'factory:escalation'
```

### 1.2 Webhook verification

```typescript
function verifyLinearSignature(payload: string, signature: string, secret: string): boolean {
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex')
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
}
```

Requests with invalid or missing signatures are rejected HTTP 401 and logged to D1 `factory-ops` (`bridge_security_events` table).

---

## 2. Webhook Event Processing

### 2.1 IssueCommentCreate

```
1. Verify Linear signature
2. Extract comment body, issue metadata, commenter identity
3. Check commenter in AuthorityRegistry → if not: ignore
4. Detect comment type:
   a. DISPOSITION comment → DispositionFlow (§3)
   b. APPROVED comment → ApprovalFlow (§4)
   c. Other → ignore
```

### 2.2 IssueUpdate

Bridge checks for `factory:disposition-recorded` label added by a non-service-account actor. Secondary trigger for pre-existing verbal dispositions.

---

## 3. Disposition Flow

### 3.1 Comment format

```
DISPOSITION: {verb}
{field}: {value}
rationale: {free text}
candidatesConsidered: [{comma-separated list}]
rejectedOptions: {id} — {reason}
```

**Required fields per verb:**

| Verb | Required fields |
|------|----------------|
| `resume` | `workGraphId`, `workGraphVersion` |
| `commission` | `workGraphId`, `workGraphVersion` |
| `patch` | `changedArtifactId`, `urgency` |
| `pipeline-config` | `proposedConfigId` |
| `override` | `action` (`force-suspend` \| `force-resume` \| `emergency-patch`) |
| `reject` | (none — closes escalation without action) |

`rationale`, `candidatesConsidered`, `rejectedOptions` required on all non-reject verbs.

### 3.2 Parsing

```typescript
type ParsedDisposition = {
  verb: DispositionVerb
  fields: Record<string, string>
  rationale: string
  candidatesConsidered: string[]
  rejectedOptions: Array<{ id: string; reason: string }>
  rawComment: string
  commentId: string
  commenterId: string
  commenterName: string
  issueId: string
  escalationId: string        // ESC-* from issue custom field
  repoId: string
  escalationType: EscalationType
}
```

### 3.3 Authority check

```typescript
function checkAuthority(
  commenterId: string,
  verb: DispositionVerb,
  registry: AuthorityRegistry
): { permitted: boolean; requiredApprovals: number } {
  const actor = registry.get(commenterId)
  if (!actor) return { permitted: false, requiredApprovals: 0 }
  if (verb === 'override') {
    return { permitted: actor.scopes.includes('we-layer:override'), requiredApprovals: 2 }
  }
  return { permitted: actor.scopes.includes(verbToScope[verb]), requiredApprovals: 1 }
}
```

### 3.4 A9 enforcement — EluciationArtifact production

Before issuing any token, the bridge writes an ELC-* governance node to **ArtifactGraphDO** (not ArangoDB):

```typescript
type DispositionEluciationArtifact = {
  nodeType: 'EluciationArtifact'
  id: string                          // ELC-BRIDGE-{escalationId}-{timestamp}
  dispositionEventType: 'linear-disposition'
  commenterLinearId: string
  commenterName: string
  linearIssueId: string
  linearCommentId: string
  verb: DispositionVerb
  candidateSet: { options: string[] }
  selectedOption: string
  rejectedOptions: Array<{ id: string; rejectionReason: string }>
  rationale: string
  constraintsApplied: string[]
  producedAt: string
  producedBy: 'ff-linear-bridge'
  explicitness: 'stated'
  immutable: true
}
```

**ArtifactGraphDO write** (per-repo, append-only):
```typescript
const artifactGraphDO = env.ARTIFACT_GRAPH.get(
  env.ARTIFACT_GRAPH.idFromName(`artifact-graph:${parsed.repoId}`)
)
await artifactGraphDO.fetch('/append', {
  method: 'POST',
  body: JSON.stringify({ node: eluciationArtifact })
})
```

If the ArtifactGraphDO write fails: no token is issued. Bridge replies to comment:
```
⚠️ Disposition received but EluciationArtifact could not be written.
Governance record incomplete. Please retry.
Escalation ID: {escalationId}
```

### 3.5 JWT issuance

```typescript
type WeOpsDispositionTokenClaims = {
  iss: 'weops-gateway'
  sub: string                  // commenterLinearId
  aud: 'factory-i-layer'
  exp: number                  // now + 300s
  iat: number
  jti: string                  // stored in BRIDGE_KV for replay prevention
  scope: TokenScope[]
  dispositionEventId: string   // ELC-* node ID
  elucidationArtifactId: string  // same as dispositionEventId
}
```

Token expiry: 5 minutes. Signed with `WEOPS_SIGNING_KEY`.

### 3.6 Gateway signal construction

```typescript
function buildGatewaySignal(
  parsed: ParsedDisposition,
  elcArtifactId: string,
  token: string
): GatewaySignal {
  const base = {
    dispositionToken: token,
    dispositionEventId: elcArtifactId,
    elucidationArtifactId: elcArtifactId,
    authorizedBy: parsed.commenterLinearId,
    issuedAt: new Date().toISOString(),
  }
  switch (parsed.verb) {
    case 'resume':
    case 'commission':
      return { signalType: 'CommissioningSignal', ...base, repoId: parsed.repoId,
               workGraphId: parsed.fields.workGraphId, workGraphVersion: parsed.fields.workGraphVersion }
    case 'patch':
      return { signalType: 'PatchAuthSignal', ...base,
               changedArtifactId: parsed.fields.changedArtifactId,
               urgency: parsed.fields.urgency as 'normal' | 'emergency' }
    case 'pipeline-config':
      return { signalType: 'PipelineConfigAuthSignal', ...base,
               proposedConfigId: parsed.fields.proposedConfigId, affectedLiveRepoIds: [] }
    case 'override':
      return { signalType: 'OverrideSignal', ...base,
               targetId: parsed.repoId, action: parsed.fields.action as OverrideAction }
    case 'reject': return null
  }
}
```

### 3.7 Gateway call + Linear reply

```typescript
const gatewayResponse = await fetch(`${WEOPS_GATEWAY_URL}/signals`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
  body: JSON.stringify(signal),
})

if (gatewayResponse.ok) {
  await linearClient.createComment(parsed.issueId, buildSuccessReply(parsed, elcArtifactId))
  await linearClient.addLabel(parsed.issueId, LABEL_DISPOSITION_RECORDED)
  await linearClient.updateIssueState(parsed.issueId, DONE_STATE_ID)
} else {
  await linearClient.createComment(parsed.issueId, buildErrorReply(parsed, gatewayResponse))
}
```

---

## 4. Approval Flow (Override Two-Person Rule)

Pending approval state stored in CF KV (`pending-override:{escalationId}`):

```typescript
type PendingOverride = {
  parsed: ParsedDisposition
  initiatorLinearId: string
  initiatedAt: string
  approvals: string[]
  expiresAt: string            // now + 1 hour
}
```

Second `APPROVED` comment from a different authority actor with `we-layer:override` scope triggers DispositionFlow §3.4 onward. Expiry after 1 hour without 2 approvals → issue moved back to In Progress.

---

## 5. Rejection Flow

On `verb: reject`:
1. Validate commenter authority
2. Write `RejectionRecord` node to **ArtifactGraphDO**:
```typescript
{ nodeType: 'RejectionRecord', id: 'REJECT-{escalationId}-{ts}',
  escalationId, repoId, rejectedBy, rationale, producedAt, explicitness: 'stated' }
```
3. Post reply to Linear, add `factory:disposition-recorded`, close issue

---

## 6. AuthorityRegistry

```typescript
// CF KV: BRIDGE_KV, key: 'authority-registry'
type AuthorityRegistry = Map<string, AuthorityRecord>
type AuthorityRecord = { linearUserId, linearUserName, scopes: TokenScope[], addedAt, addedBy }
```

Bootstrap: `config/linear-authority.yaml` → bootstrap script → CF KV.

---

## 7. Error Taxonomy

| Error | Bridge behavior | Linear action |
|-------|----------------|---------------|
| Invalid Linear signature | Reject 401; log to D1 `factory-ops` | None |
| Parse failure | Log; post error reply | Comment with format guidance |
| Missing required fields | Log; post error reply | Comment with missing field list |
| Commenter not in registry | Log; conditional reply | None or one reply |
| ArtifactGraphDO write failure (ELC-*) | No token; post error reply | Comment with retry instruction |
| Gateway 4xx | No retry; post error reply | Comment with error detail |
| Gateway 5xx | Retry 3x exponential backoff; post error if all fail | Comment if all retries fail |

All errors logged to D1 `factory-ops` `bridge_error_log` table with `escalationId`, `commentId`, `errorType`, `errorDetail`, `timestamp`.

---

## 8. Security Constraints

- No disposition without Linear signature verification
- No token without ELC-* node in ArtifactGraphDO (A9 structural enforcement)
- No override without two approvals
- JTI replay prevention: `BRIDGE_KV` under `jti:{jti}` + independent gateway check
- Token expiry: 5 minutes
- Service account isolation: bridge key is read + comment/label only

---

## 9. Package Structure

```
workers/linear-bridge/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts                — CF Worker default export
    ├── types.ts
    ├── webhook-verifier.ts     — Linear HMAC-SHA256 verification
    ├── disposition-parser.ts   — structured comment parsing (no LLM)
    ├── authority-registry.ts   — CF KV AuthorityRegistry
    ├── eluciation-writer.ts    — A9: ELC-* node → ArtifactGraphDO
    ├── token-issuer.ts         — JWT signing with WEOPS_SIGNING_KEY
    ├── signal-builder.ts       — gateway signal construction
    ├── gateway-client.ts       — WeOps gateway HTTP client + retry
    ├── approval-flow.ts        — two-person override SM
    ├── rejection-flow.ts       — RejectionRecord → ArtifactGraphDO
    ├── linear-client.ts        — Linear GraphQL API
    └── error-log.ts            — D1 factory-ops bridge_error_log writer
```

---

## 10. Environment Bindings

```typescript
type Env = {
  LINEAR_WEBHOOK_SECRET: string
  LINEAR_API_KEY: string
  WEOPS_SIGNING_KEY: string
  WEOPS_GATEWAY_URL: string
  ARTIFACT_GRAPH: DurableObjectNamespace   // ArtifactGraphDO — replaces ArangoDB
  BRIDGE_KV: KVNamespace                   // authority registry, pending overrides, JTI store
}
```

---

## 11. Open Items

| Item | Blocking |
|------|---------|
| ArtifactGraphDO `append` endpoint schema — node type registration for `EluciationArtifact` and `RejectionRecord` | Yes — needed before end-to-end test |
| `config/linear-authority.yaml` initial content — Linear user IDs and scopes | No |
| `affectedLiveRepoIds` population for `PipelineConfigAuthSignal` — bridge sends empty array for v1 | No |
