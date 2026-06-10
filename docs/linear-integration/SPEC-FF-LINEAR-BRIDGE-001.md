# ff-linear-bridge Specification
**ID**: SPEC-FF-LINEAR-BRIDGE-001
**Status**: Draft — pending Architect sign-off
**Date**: 2026-06-05
**Layer**: I-layer / We-layer boundary — Linear webhook handler
**Package**: `@factory/linear-bridge`
**Depends on**: `@factory/schemas`, SPEC-WEOPS-GATEWAY-BOUNDARY-001,
               SPEC-LINEAR-SYNC-SERVICE-001, Linear webhook API

---

## 0. Conceptual Preamble

### 0.1 What ff-linear-bridge IS

`ff-linear-bridge` is the We-layer governance console adapter. It is the
component that converts human Disposition Events performed in Linear into
signed gateway signals that the Factory's I-layer can act on.

In the full governance loop:

```
Factory I-layer (auto-suspend, Amendment failure, CRP failure)
  ↓  escalateToWeLayer() → LinearSyncService creates escalation issue
Linear issue (factory:escalation label)
  ↓  human posts DISPOSITION comment + adds factory:disposition-recorded
Linear webhook → ff-linear-bridge
  ↓  parses disposition, validates authority, writes ELC-* to ArangoDB
  ↓  issues WeOpsDispositionToken (signed JWT)
  ↓  POST to WeOps Gateway /signals
WeOps Gateway
  ↓  validates token, routes to target I-layer agent
Factory I-layer resumes
```

`ff-linear-bridge` occupies exactly one step in this chain: it is the
translation layer between a human act (posting a comment in Linear) and
a machine-recognizable governance signal (a signed JWT + typed payload).

### 0.2 Ontological significance

The bridge is where the Disposition Event actually occurs in the formal
sense. Specifically:

- The human posting a `DISPOSITION:` comment is the authority-bound
  selection from a Candidate Set (ontology §4B.3)
- The bridge's parsing of `candidatesConsidered` and `rejectedOptions`
  produces the Elucidation Artifact (A9 obligation)
- The JWT it issues is the authority binding — it records which human
  authorized the disposition and under which token scope
- The ELC-* artifact written to ArangoDB is the permanent governance
  record of the Disposition Event

A disposition comment without an ELC-* artifact is a degenerate
disposition — it satisfies the operational requirement but fails the
learning requirement (A9). The bridge enforces A9 mechanically: it
refuses to issue a token until the Elucidation Artifact is written.

### 0.3 Authority model

The bridge does not trust all Linear users equally. Authority is derived
from two sources:

1. **Linear team membership**: the commenter must be a member of the
   WeOps team in Linear. Non-members' comments are ignored.

2. **Token scope**: different escalation types require different scopes.
   `we-layer:override` scope requires two-person approval — two distinct
   team members must post `APPROVED` before the override token is issued.

The bridge maintains an `AuthorityRegistry` in CF KV that maps Linear
user IDs to their permitted token scopes.

---

## 1. Webhook Setup

### 1.1 Linear webhook configuration

Linear must be configured with a webhook pointing to the bridge:

```
URL: https://ff-linear-bridge.koales.workers.dev/webhook
Events: IssueCommentCreate, IssueUpdate
Filter: team = WeOps, label contains 'factory:escalation'
```

The webhook is filtered at the Linear level to only fire on
`factory:escalation` issues. This prevents the bridge from processing
every comment in the workspace.

### 1.2 Webhook verification

Linear signs webhooks with an HMAC-SHA256 signature in the
`Linear-Signature` header. The bridge verifies this on every request:

```typescript
function verifyLinearSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex')
  return crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(signature)
  )
}
```

Requests with invalid or missing signatures are rejected with HTTP 401
and logged to ArangoDB `bridge_security_events`. They do not fire
escalations.

---

## 2. Webhook Event Processing

### 2.1 IssueCommentCreate

Fires when any comment is posted on a `factory:escalation` issue.

**Processing pipeline:**

```
1. Verify Linear signature
2. Extract comment body, issue metadata, commenter identity
3. Check commenter is in AuthorityRegistry
   → If not: ignore (not a governance actor)
4. Detect comment type:
   a. DISPOSITION comment → DispositionFlow (§3)
   b. APPROVED comment → ApprovalFlow (§4)
   c. Other → ignore
```

### 2.2 IssueUpdate

Fires when an issue's labels change.

The bridge only cares about one label addition:
`factory:disposition-recorded` added by someone NOT in the bridge's own
service account.

This is a secondary trigger: if a human adds the label directly without
posting a disposition comment (e.g., for a pre-existing verbal
disposition), the bridge treats it as a signal to check whether a
disposition comment already exists and process it if found.

---

## 3. Disposition Flow

### 3.1 Comment format

The disposition comment must follow a structured format. The bridge
parses this format deterministically — no LLM involved:

```
DISPOSITION: {verb}
{field}: {value}
{field}: {value}
...
rationale: {free text — can span multiple lines}
candidatesConsidered: [{comma-separated list}]
rejectedOptions: {id} — {reason}
rejectedOptions: {id} — {reason}
```

**Required fields per disposition verb:**

| Verb | Required fields |
|------|----------------|
| `resume` | `workGraphId`, `workGraphVersion` |
| `commission` | `workGraphId`, `workGraphVersion` |
| `patch` | `changedArtifactId`, `urgency` |
| `pipeline-config` | `proposedConfigId` |
| `override` | `action` (`force-suspend` \| `force-resume` \| `emergency-patch`) |
| `reject` | (no additional fields — closes escalation without action) |

`rationale`, `candidatesConsidered`, and `rejectedOptions` are required
on all verbs except `reject`. Missing these on a non-reject disposition
produces a parsing error: the bridge replies to the comment with a
structured error message explaining what is missing, and does NOT issue
a token.

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
  commenterId: string           // Linear user ID
  commenterName: string
  issueId: string               // Linear internal ID
  escalationId: string          // ESC-* from issue custom field
  repoId: string                // from issue custom field
  escalationType: EscalationType
}
```

Parsing is strict — unexpected fields are logged but do not block
processing. Unknown verbs produce an error reply.

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
    // override requires we-layer:override scope AND two-person approval
    return {
      permitted: actor.scopes.includes('we-layer:override'),
      requiredApprovals: 2
    }
  }

  const scopeRequired = verbToScope[verb]  // e.g. 'resume' → 'we-layer:commission'
  return {
    permitted: actor.scopes.includes(scopeRequired),
    requiredApprovals: 1
  }
}
```

If `permitted: false`: bridge replies to comment explaining the
authority requirement and takes no action.

If `requiredApprovals: 2`: the disposition enters ApprovalFlow (§4)
instead of proceeding immediately.

### 3.4 A9 enforcement — Elucidation Artifact production

Before issuing any token, the bridge produces an ELC-* artifact from
the disposition comment content:

```typescript
type DispositionElucidationArtifact = {
  _key: string                          // ELC-BRIDGE-{escalationId}-{timestamp}
  dispositionEventType: 'linear-disposition'
  commenterLinearId: string
  commenterName: string
  linearIssueId: string                 // WEO-N
  linearCommentId: string
  verb: DispositionVerb
  candidateSet: {
    options: string[]                   // from candidatesConsidered
  }
  selectedOption: string                // the commissioned/resumed/patched artifact
  rejectedOptions: Array<{
    id: string
    rejectionReason: string
  }>
  rationale: string
  constraintsApplied: string[]          // inferred from escalationType + verb
  producedAt: string
  producedBy: 'ff-linear-bridge'
  source: 'ff-linear-bridge'
  explicitness: 'stated'
  immutable: true
}
```

This artifact is written to ArangoDB `elucidation_artifacts` collection
before the JWT is issued. If the ArangoDB write fails: no token is
issued. The bridge replies to the comment:

```
⚠️ Disposition received but Elucidation Artifact could not be written
to ArangoDB. The governance record is incomplete. Please retry or
contact the Factory administrator.

Escalation ID: {escalationId}
Error: {error summary}
```

This is A9 enforcement in operation: no ELC-* = no token = no action.

### 3.5 JWT issuance

```typescript
type WeOpsDispositionTokenClaims = {
  iss: 'weops-gateway'
  sub: string                  // commenterLinearId
  aud: 'factory-i-layer'
  exp: number                  // now + 300s (5 minute window)
  iat: number
  jti: string                  // unique per disposition; stored in KV for replay prevention
  scope: TokenScope[]
  dispositionEventId: string   // ELC-* artifact ID
  elucidationArtifactId: string  // same as dispositionEventId
}
```

Token expiry is 5 minutes. The WeOps gateway validates `exp` strictly.
If the gateway call fails and the token expires, the bridge must re-issue
(starting from the ArangoDB ELC-* write — the artifact already exists,
so re-issue just produces a new JWT against the same ELC-*).

The bridge signs with the WeOps private key stored in CF Worker secrets
(`WEOPS_SIGNING_KEY`). The gateway validates with the corresponding
public key.

### 3.6 Gateway signal construction

The bridge constructs the appropriate signal type from the disposition
verb and fields:

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
      return {
        signalType: 'CommissioningSignal',
        ...base,
        repoId: parsed.repoId,
        workGraphId: parsed.fields.workGraphId,
        workGraphVersion: parsed.fields.workGraphVersion,
        commissionedBy: parsed.commenterName,
      }
    case 'patch':
      return {
        signalType: 'PatchAuthSignal',
        ...base,
        changedArtifactId: parsed.fields.changedArtifactId,
        changeDescription: parsed.rationale,
        urgency: (parsed.fields.urgency ?? 'normal') as 'normal' | 'emergency',
      }
    case 'pipeline-config':
      return {
        signalType: 'PipelineConfigAuthSignal',
        ...base,
        proposedConfigId: parsed.fields.proposedConfigId,
        affectedLiveRepoIds: [],  // populated from ArangoDB lookup
      }
    case 'override':
      return {
        signalType: 'OverrideSignal',
        ...base,
        targetAgentType: parsed.escalationType === 'CRPFail'
          ? 'ArchitectAgentDO'
          : 'CommissioningAgent',
        targetId: parsed.repoId,
        action: parsed.fields.action as OverrideAction,
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      }
    case 'reject':
      return null  // no signal; close escalation only
  }
}
```

### 3.7 Gateway call + Linear reply

```typescript
// 1. POST signal to WeOps Gateway
const gatewayResponse = await fetch(
  `${WEOPS_GATEWAY_URL}/signals`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(signal),
  }
)

// 2. On success: reply to Linear comment + add factory:disposition-recorded label
if (gatewayResponse.ok) {
  await linearClient.createComment(parsed.issueId, buildSuccessReply(parsed, elcArtifactId))
  await linearClient.addLabel(parsed.issueId, LABEL_DISPOSITION_RECORDED)
  await linearClient.updateIssueState(parsed.issueId, DONE_STATE_ID)
}

// 3. On gateway error: reply with error; do NOT add label
if (!gatewayResponse.ok) {
  await linearClient.createComment(parsed.issueId, buildErrorReply(parsed, gatewayResponse))
  // Token is now expired/consumed; operator must retry
}
```

**Success reply template:**

```
✅ Disposition recorded and signal sent to Factory.

**Action**: {verb} on `{repoId}`
**Elucidation Artifact**: `{elcArtifactId}`
**Signal type**: {signalType}
**Authorized by**: {commenterName}
**Issued at**: {issuedAt}

The Factory will resume execution once the signal is processed.
This issue has been closed.
```

---

## 4. Approval Flow (Override Two-Person Rule)

### 4.1 Trigger

When `checkAuthority()` returns `requiredApprovals: 2`, the disposition
enters a pending approval state rather than immediately proceeding.

### 4.2 Pending approval state

The bridge stores the pending disposition in CF KV:

```typescript
// Key: pending-override:{escalationId}
type PendingOverride = {
  parsed: ParsedDisposition
  initiatorLinearId: string
  initiatedAt: string
  approvals: string[]          // Linear user IDs who have posted APPROVED
  expiresAt: string            // now + 1 hour; prevents stale approvals
}
```

The bridge replies to the initiating comment:

```
⏳ Override disposition received from {commenterName}.

This action requires **two-person approval**. A second WeOps team member
with `we-layer:override` scope must post `APPROVED` on this issue within
1 hour.

**Pending action**: {verb} — {action}
**Escalation ID**: {escalationId}
**Expires at**: {expiresAt}
```

### 4.3 APPROVED comment processing

When a second team member posts `APPROVED`:

1. Load pending override from KV
2. Verify approver is different from initiator
3. Verify approver has `we-layer:override` scope in AuthorityRegistry
4. Verify not expired
5. Add approver to `approvals` array
6. If `approvals.length >= 2`: proceed with DispositionFlow §3.4 onward
7. If still < 2: update KV, reply with count

### 4.4 Expiry

If the override expires (1 hour without two approvals), the bridge
moves the issue back to `In Progress` state and posts:

```
⏰ Override approval expired without reaching two approvals.
Approvals received: {approvals.length} of 2 required.
The escalation remains open. Re-post the DISPOSITION comment to restart.
```

---

## 5. Rejection Flow

When verb is `reject`:

1. Validate commenter authority (same as other verbs — must be team member)
2. Write a `RejectionRecord` to ArangoDB:

```typescript
type RejectionRecord = {
  _key: string                 // REJECT-{escalationId}-{timestamp}
  escalationId: string
  repoId: string
  rejectedBy: string           // Linear user ID
  rejectedByName: string
  rationale: string
  producedAt: string
  source: 'ff-linear-bridge'
  explicitness: 'stated'
}
```

3. Post reply to Linear issue:

```
❌ Escalation rejected by {commenterName}.

**Rationale**: {rationale}

The Factory remains in its current suspended/failed state.
No resume or commission signal has been sent.
A new escalation will be created if the Factory detects further
governance violations requiring human action.

Rejection record: `{rejectionRecordId}`
```

4. Add label `factory:disposition-recorded`, close issue

Note: A rejection is still a Disposition Event. The Elucidation Artifact
production step (§3.4) applies to rejections — if `candidatesConsidered`
and `rejectedOptions` are present in the comment, an ELC-* is written.
If absent on a rejection, this is permitted (A9 scope restriction: if
the rejection is a constrained disposition with no real candidate set —
e.g., the only option was to reject — elucidation is vacuous).

---

## 6. AuthorityRegistry

### 6.1 Structure

```typescript
// CF KV namespace: BRIDGE_KV
// Key: authority-registry
type AuthorityRegistry = Map<string, AuthorityRecord>

type AuthorityRecord = {
  linearUserId: string
  linearUserName: string
  scopes: TokenScope[]
  addedAt: string
  addedBy: string
}
```

### 6.2 Bootstrap

The registry is seeded manually via a bootstrap script that reads from
a config file committed to the repo:

```yaml
# config/linear-authority.yaml
authority:
  - linearUserId: "user_abc123"
    linearUserName: "Wes"
    scopes:
      - we-layer:commission
      - we-layer:resume
      - we-layer:patch
      - we-layer:pipeline-config
      - we-layer:override
```

The bootstrap script writes this to CF KV. Updates to the registry
require re-running the bootstrap script — there is no live editing path,
which is intentional (authority changes are themselves governance events
that should be deliberate).

### 6.3 Registry miss

If a commenter is not in the registry: their comment is silently ignored
for governance purposes. The bridge does not reply — replying to every
non-governance comment would be noise. The only exception: if the
comment contains a `DISPOSITION:` prefix but the commenter is not in
the registry, the bridge replies once:

```
⚠️ This comment appears to be a governance disposition, but your
Linear user ID is not registered as a governance actor for this Factory.
Contact the Factory administrator to be added to the authority registry.
```

---

## 7. Error Taxonomy and Recovery

| Error | Bridge behavior | Linear action |
|-------|----------------|---------------|
| Invalid Linear signature | Reject 401; log security event | None |
| Comment parse failure (malformed DISPOSITION) | Log parse error; post error reply | Comment with format guidance |
| Missing required fields | Log; post error reply | Comment with missing field list |
| Commenter not in registry | Log; conditional reply (§6.3) | None or one reply |
| ArangoDB write failure (ELC-*) | No token issued; post error reply | Comment with retry instruction |
| Gateway 4xx | No retry; post error reply | Comment with error detail |
| Gateway 5xx | Retry 3x with exponential backoff; post error if all fail | Comment if all retries fail |
| Token expiry before gateway success | Re-issue against existing ELC-*; retry gateway | None additional |
| Override expired without 2 approvals | Clear KV; move issue to In Progress | Comment (§4.4) |

All errors are written to ArangoDB `bridge_error_log` with:
- `escalationId`, `commentId`, `errorType`, `errorDetail`, `timestamp`

---

## 8. Security Constraints

**No disposition without Linear signature verification.** Every request
is verified before any processing.

**No token without ELC-*.** The A9 invariant is structural: the code
path to JWT signing runs only after the ArangoDB write succeeds.

**No override without two approvals.** The `we-layer:override` scope is
never issued from a single comment, regardless of the commenter's
authority level.

**JTI replay prevention.** Every issued JWT's `jti` is stored in
`BRIDGE_KV` under `jti:{jti}` with a TTL matching token expiry. The
bridge checks this before issuing; the gateway checks it independently.
Two layers of replay prevention.

**Token expiry: 5 minutes.** Short-lived tokens minimize the window for
replay. Gateway calls are made immediately after issuance.

**Service account isolation.** The Linear API key used by this bridge
is a service account with read-only access to issues/comments (to
verify comment content) and write access only to comments and labels.
It cannot create or delete issues. The `LinearSyncService` uses a
separate API key with broader write access.

---

## 9. Package Structure

```
packages/linear-bridge/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts                — CF Worker default export
    ├── types.ts                — webhook payloads, ParsedDisposition, etc.
    ├── webhook-verifier.ts     — Linear HMAC-SHA256 signature verification
    ├── disposition-parser.ts   — structured comment parsing (no LLM)
    ├── authority-registry.ts   — CF KV-backed authority registry
    ├── elucidation-writer.ts   — A9: ELC-* artifact production + ArangoDB write
    ├── token-issuer.ts         — JWT signing with WeOps private key
    ├── signal-builder.ts       — typed gateway signal construction
    ├── gateway-client.ts       — WeOps gateway HTTP client with retry
    ├── approval-flow.ts        — two-person override approval state machine
    ├── rejection-flow.ts       — rejection record + issue close
    ├── linear-client.ts        — Linear GraphQL API (comments, labels, state)
    └── error-log.ts            — ArangoDB bridge_error_log writer
```

---

## 10. Environment Bindings

```typescript
type Env = {
  LINEAR_WEBHOOK_SECRET: string      // for HMAC verification
  LINEAR_API_KEY: string             // service account (read + comment/label write)
  WEOPS_SIGNING_KEY: string          // WeOps private key for JWT signing
  WEOPS_GATEWAY_URL: string          // WeOps gateway base URL
  ARANGO_URL: string
  ARANGO_DB: string
  ARANGO_TOKEN: string
  BRIDGE_KV: KVNamespace             // authority registry, pending overrides, JTI store
}
```

---

## 11. Wrangler Configuration

```toml
name = "ff-linear-bridge"
main = "src/index.ts"
compatibility_date = "2026-01-01"

[[kv_namespaces]]
binding = "BRIDGE_KV"
id = "{kv-namespace-id}"

[vars]
WEOPS_GATEWAY_URL = "https://ff-gateway.koales.workers.dev"

# Secrets (set via wrangler secret put):
# LINEAR_WEBHOOK_SECRET
# LINEAR_API_KEY
# WEOPS_SIGNING_KEY
# ARANGO_URL, ARANGO_DB, ARANGO_TOKEN
```

---

## 12. Open Items

| Item | Owner | Blocking |
|------|-------|---------|
| WeOps public key distribution to gateway — bridge signs, gateway verifies; both need the same key pair | Engineering | Yes — needed before end-to-end test |
| Linear service account provisioning — two separate accounts (LinearSyncService read-write, bridge read + comment/label) | Engineering | No — single account acceptable for v1 |
| `config/linear-authority.yaml` initial content — which Linear user IDs get which scopes | Architect (Wes) | No — bootstrap can run after bridge is deployed |
| `AffectedLiveRepoIds` population for `PipelineConfigAuthSignal` — bridge needs an ArangoDB lookup for currently ACTIVE repos | Engineering | No — can send empty array for v1 (Architect Agent ignores it when empty) |
| Disposition comment format documentation — team needs a reference card for how to write valid disposition comments | Engineering | No — can write after bridge is stable |
