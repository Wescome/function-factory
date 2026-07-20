# Contracts — @factory/bead-graph (ksp-bead-graph)

> Reversa Writer · doc_level: completo · Generated 2026-06-10
> Source spec: SPEC-KSP-BEAD-GRAPH-001 (v1.0) §8–9
> Package: `packages/bead-graph/`

---

## Overview

`@factory/bead-graph` exposes two contract surfaces:

1. **DO RPC Interface** — the `BeadGraphDOBase` abstract class methods, called via Cloudflare Durable Object RPC stubs from the SDK layer and loop-closure service
2. **SDK Interface** — the `KnowingStateSDK<P,T,E,O>` TypeScript interface, consumed by domain instantiation packages

There are no public HTTP routes exposed by this package itself. The `src/worker.ts` provides a routing shim that proxies all requests to the DO, but the protocol between the Worker and the DO is internal CF RPC — not a public HTTP API. Domain instantiation packages may expose their own HTTP routes wrapping this package's DO.

---

## Contract 1: Durable Object RPC Interface (`BeadGraphDOBase`)

Called via CF Durable Object RPC stubs. All methods are `async`. Auth: the DO is accessed only through the Worker binding; no external caller reaches the DO directly.

### `writeBead`

**Intent:** Atomically write a Bead and its AuditBead to the SQLite store.

| Field | Value |
|-------|-------|
| Transport | CF DO RPC |
| Auth | Internal — CF binding only; no external access |
| Idempotency | Yes — `INSERT OR IGNORE` on duplicate `bead_id` |

**Request shape:**
```typescript
writeBead(bead: AnyBead, auditBead?: AnyBead): Promise<void>
```

**Invariants enforced:**
- `bead.type !== 'audit'` AND `auditBead` absent → throws `Error('writeBead: auditBead required for type=...')`
- Both beads written in a single `BEGIN/COMMIT` block
- AuditBead linked to primary bead via `bead_edges` (`rel = 'audits'`)

**Response:** `void` on success; throws on constraint violation or transaction failure

---

### `getBead`

**Intent:** Read a single Bead by ID, reconstituting its `parent_ids` from the edges table.

**Request shape:**
```typescript
getBead(beadId: string): Promise<(BaseBead & { content: Record<string, unknown> }) | null>
```

**Response:** Full bead object with `parent_ids` array reconstituted from `bead_edges WHERE rel = 'parent'`; `null` if not found

---

### `getCurrentTrustBead`

**Intent:** Find the head (non-superseded) TrustBead for a given subject within an org.

**Request shape:**
```typescript
getCurrentTrustBead(orgId: string, subjectId: string): Promise<(BaseBead & { content: Record<string, unknown> }) | null>
```

**Response:** The TrustBead with no `supersedes`-typed incoming edge, ordered `ts DESC LIMIT 1`; `null` if none exists

---

### `getActiveConsent`

**Intent:** Read the current active ConsentBead for a role within an org.

**Request shape:**
```typescript
getActiveConsent(orgId: string, roleId: string): Promise<(BaseBead & { content: Record<string, unknown> }) | null>
```

**Response:** ConsentBead where `content.status = 'ACTIVE'`, most recent; `null` if none

---

### `getTrustLineage`

**Intent:** Return the full trust lineage for a subject — all trust, outcome, and amendment beads in chronological order.

**Request shape:**
```typescript
getTrustLineage(orgId: string, subjectId: string): Promise<(BaseBead & { content: Record<string, unknown> })[]>
```

**Response:** Ordered array by `ts ASC`; may be empty

---

### `getOpenAmendments`

**Intent:** Return all PENDING amendments for an org.

**Request shape:**
```typescript
getOpenAmendments(orgId: string): Promise<(BaseBead & { content: Record<string, unknown> })[]>
```

**Response:** Ordered array by `ts DESC`; may be empty

---

### `retrieveKnowingState` (I2 entry point)

**Intent:** Composite read — returns the three-component knowing-state required at session open.

**Request shape:**
```typescript
retrieveKnowingState(
  orgId: string,
  roleId: string,
  category?: string
): Promise<{
  policy: (BaseBead & { content: Record<string, unknown> }) | null;
  trustedSubjects: (BaseBead & { content: Record<string, unknown> })[];
  consent: (BaseBead & { content: Record<string, unknown> }) | null;
}>
```

**Response components:**
- `policy`: most recent PolicyBead scoped to `roleId` or `'org'`; `null` if none
- `trustedSubjects`: all APPROVED, non-superseded TrustBeads; filtered by `subject_type` if `category` is provided; sorted by `trust_score DESC`
- `consent`: active ConsentBead for role; `null` if none

**Fail-closed behavior:** If this call throws (DO unavailable, storage error), the SDK layer must set `session.autonomyFloor = 'SUGGEST'` (I4 / INV-BG-008)

---

### `computeBeadId` (convenience method)

**Intent:** Expose `computeBeadId` on the DO instance so SDK callers do not need a separate import.

**Request shape:**
```typescript
computeBeadId(type: string, content: Record<string, unknown>, parentIds: string[]): string
```

**Response:** 64-character hex SHA-256 string

---

## Contract 2: SDK TypeScript Interface (`KnowingStateSDK<P,T,E,O>`)

This is the **primary consumer-facing contract**. Domain packages depend on this interface, not on `BeadGraphDOBase` directly (ADR-KSP-005).

### Type Parameters

| Parameter | Meaning |
|-----------|---------|
| `P` | PolicyContent — domain-specific content shape for PolicyBead |
| `T` | TrustContent — domain-specific content shape for TrustBead |
| `E` | ExecutionContent — domain-specific payload for `writeExecutionBead` |
| `O` | OutcomeContent — domain-specific payload for `writeOutcomeBead` |

### `openSession`

**Intent:** Open a new SDK session for an agent. Creates session state in KV.

```typescript
openSession(orgId: string, roleId: string, agentId: string): Promise<Session>
```

**Session initial state:**
```json
{
  "sessionId": "<uuid>",
  "orgId": "...",
  "roleId": "...",
  "agentId": "...",
  "autonomyFloor": "EXECUTE_FULL",
  "ksRetrievedAt": undefined
}
```

**KV side effect:** Writes `session:{sessionId}` with TTL 86400s

---

### `closeSession`

```typescript
closeSession(sessionId: string): Promise<void>
```

**KV side effect:** Deletes `session:{sessionId}`

---

### `retrieveKnowingState` (I2 enforcement)

**Intent:** Retrieve the knowing-state at session open. Sets `ksRetrievedAt` on success. Degrades `autonomyFloor` on failure.

```typescript
retrieveKnowingState(sessionId: string, category?: string): Promise<KnowingState<T, P>>
```

**KnowingState shape:**
```typescript
{
  policy:          P | null;
  trustedSubjects: T[];
  consent:         { grants: string[] } | null;
  retrievedAt:     number;  // epoch ms
}
```

**Failure behavior (I4):**
- On any error: `session.autonomyFloor` → `'SUGGEST'` in KV; `ksRetrievedAt` remains unset
- Subsequent `writeExecutionBead` will throw `SessionNotInitialized` or `AutonomyDegradedError`

---

### `evaluateTrust`

```typescript
evaluateTrust(sessionId: string, subjectId: string): Promise<TrustEvaluation<T>>
```

**TrustEvaluation shape:**
```typescript
{
  trusted:   boolean;
  trustBead: T | null;
  autonomy:  Autonomy;  // derived from trust_score + status
}
```

---

### `writeExecutionBead`

**Intent:** Write an ExecutionBead for an agent action. Enforces I2 and I4 preconditions.

```typescript
writeExecutionBead(sessionId: string, payload: E): Promise<string>  // returns bead_id
```

**Preconditions (throws if violated):**
- `session.ksRetrievedAt` must be set → `SessionNotInitialized`
- If `session.autonomyFloor = 'SUGGEST'` AND `payload.autonomy_level !== 'SUGGEST'` → `AutonomyDegradedError`

**Side effects:**
1. `computeBeadId('execution', payload, parentIds)`
2. Build AuditBead for the transaction
3. DO RPC `writeBead(executionBead, auditBead)`
4. `invalidateKV(orgId, ...)` for affected keys

---

### `writeOutcomeBead`

**Intent:** Record the outcome of an execution. Triggers PENDING AmendmentBead creation if `triggers_amendment = true`.

```typescript
writeOutcomeBead(
  sessionId: string,
  executionBeadId: string,
  outcome: O
): Promise<string>  // returns bead_id
```

**Side effects:**
1. Write OutcomeBead + AuditBead via DO RPC
2. If `outcome.triggers_amendment === true`: auto-create and write PENDING AmendmentBead (I3 continuous maintenance)
3. Invalidate `maintenance:{orgId}` in KV

---

### `getOpenAmendments`

```typescript
getOpenAmendments(orgId: string): Promise<AmendmentBeadContent[]>
```

**Returns:** All PENDING AmendmentBead content objects for the org, ordered `ts DESC`

---

### `checkConsent`

```typescript
checkConsent(sessionId: string, action: string): Promise<boolean>
```

**Logic:** Read active ConsentBead for session's role; return `content.grants.includes(action)`

---

## Error Types Exported

| Error class | Thrown by | Condition |
|-------------|-----------|-----------|
| `BeadImmutabilityError` | Storage layer | Any UPDATE/DELETE on `beads` table attempted (INV-BG-001) |
| `BeadIntegrityError` | `sdk.ts` | Computed `bead_id` does not match expected (INV-BG-002) |
| `SessionNotInitialized` | `sdk.ts:writeExecutionBead` | `session.ksRetrievedAt` is undefined (INV-BG-003) |
| `AutonomyDegradedError` | `sdk.ts:writeExecutionBead` | Execution-level autonomy attempted while `autonomyFloor = 'SUGGEST'` (INV-BG-008) |

---

## KV Key Contract

All KV keys written by this package follow these patterns. Consumers (loop-closure, factory-graph) must not write to these keys directly — only through the SDK methods.

| Key pattern | Writer | TTL |
|-------------|--------|-----|
| `session:{sessionId}` | `openSession` | 86400s (24h) |
| `ks:{orgId}:{roleId}:{category}` | `retrieveKnowingState` | 3600s (1h) |
| `head:{orgId}:trust:{subjectId}` | `writeExecutionBead` / `writeBead` | None |
| `consent:{orgId}:{roleId}` | `writeBead` (ConsentBead) | 900s (15m) |
| `policy:{orgId}:{roleId}` | `writeBead` (PolicyBead) | 3600s (1h) |
| `maintenance:{orgId}` | `writeOutcomeBead` / `writeBead` (Amendment) | 21600s (6h) |

---

## Breaking Change Policy

This package is consumed by `@factory/ksp-sdk`, `@factory/loop-closure`, and `@factory/factory-graph`. Changes to:

- `BeadGraphDOBase` method signatures → **breaking for all downstream packages**
- `KnowingStateSDK` interface → **breaking for all domain instantiation packages**
- Zod schemas (type fields, required fields) → **breaking for any package validating beads**
- `computeBeadId` algorithm → **breaking — existing bead IDs will not match recomputed values**
- SQLite base schema → **breaking — requires a new migration, not an in-place change**

Additive changes (new optional fields, new exported helpers) are non-breaking.
