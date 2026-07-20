# ADR-KSP-003: KV Hot Cache for Knowing-State Retrieval

**Status**: Accepted
**Date**: 2026-06-10
**Deciders**: Wislet J. Celestin / Koales.ai
**Context**: SPEC-KSP-BEAD-GRAPH-001 §7, SPEC-KSP-ARCH-001 §6 (I2 enforcement map)

---

## Context

The `retrieveKnowingState()` call is on the critical path of every session open (Invariant I2 — Retrieval Enforcement). The call must succeed before any `writeExecutionBead()` is permitted, meaning it is invoked on every agent session before the agent takes any action.

At expected execution volume, this call could be made hundreds of times per minute across all sessions. The Bead Graph DO SQLite query involves:
1. A policy lookup (most recent active policy for org/role scope)
2. An approved trust bead lookup (all non-superseded trust beads for the org)
3. An active consent lookup

These queries are individually fast but require a DO stub call, which involves a Cloudflare edge-to-DO network hop on every cache miss. The latency of this hop is acceptable occasionally but not on every session open.

---

## Decision

Layer a KV hot cache in front of the Bead Graph DO for `retrieveKnowingState()`.

Six key patterns are defined with explicit TTLs and invalidation rules:

| Key pattern | Value | TTL | Invalidated by |
|-------------|-------|-----|----------------|
| `ks:{orgId}:{roleId}:{category}` | JSON: `{ trustedSubjects, policy }` | 1 hour | Any TrustBead or PolicyBead write for org/role/category |
| `head:{orgId}:trust:{subjectId}` | bead_id string | None (invalidated on write) | Any TrustBead write for this org/subject |
| `consent:{orgId}:{roleId}` | JSON: `{ grants: string[] }` | 15 min | Any ConsentBead write for org/role |
| `policy:{orgId}:{roleId}` | JSON: PolicyBead content | 1 hour | Any PolicyBead write for org/role |
| `session:{sessionId}` | JSON: session state | 24 hours | Session expiry |
| `maintenance:{orgId}` | JSON: maintenance health | 6 hours | Any OutcomeBead or AmendmentBead write |

On cache miss, the DO SQLite query is the authoritative fallback. KV is never authoritative — it is a read-through cache. The DO is always the source of truth.

On Amendment adoption (`LoopClosureService.adoptAmendment()`), KV is invalidated before returning (INV-KSP-006 / INV-LC-006). The keys invalidated are `ks:{orgId}:*`, `head:{orgId}:*`, and `maintenance:{orgId}`.

---

## Rationale

**I2 enforcement requires sub-10ms retrieval on the hot path**: the DO hop latency (even intra-region) is 1-5ms but involves serialization overhead at scale. KV edge cache reads are sub-1ms from nearby edge nodes. At session open volume, this difference is material.

**KV is edge-distributed**: CF KV is served from edge nodes globally. A session open from a Conducting Agent running anywhere in the CF network gets a KV hit from the nearest edge node, not from the DO's home region.

**Invalidation is well-bounded**: the invalidation surface is small. TrustBead and PolicyBead writes are rare (they happen only on Amendment adoption). The KV invalidation on adoption (delete `ks:{orgId}:*` + `head:{orgId}:*` + `maintenance:{orgId}`) can be performed synchronously before the adoption result returns, ensuring the next session sees the amended state.

**Stale-read window is bounded by TTL or invalidation**: a session that opens between an Amendment adoption and the KV propagation of the invalidation (sub-second) will get a stale KV read. The DO fallback will return the correct head bead on the subsequent request. This is an accepted tradeoff (see INV-LC-006).

---

## Consequences

**Positive**:
- `retrieveKnowingState()` is served from KV edge cache on hot path with sub-1ms latency.
- DO SQLite is the authoritative fallback on cache miss — correctness is never compromised.
- The six key patterns cover all session-open data requirements.
- Invalidation is deterministic: adoption triggers specific key deletes, not a full cache flush.

**Negative**:
- A bounded stale-read window exists between Amendment adoption and KV invalidation propagation. Sessions opened in this window may get the prior knowing-state. This is accepted: the DO fallback returns correct state on the next request.
- Missed invalidation (if `adoptAmendment()` crashes before KV delete) leaves stale cache until TTL expiry (max 1 hour for `ks:*` keys). Recovery: the DO SQLite query on cache miss always returns the correct current head bead.
- Six key patterns to maintain: any new Bead type that affects session-open state must add a corresponding KV key pattern and invalidation rule.

---

## Rejected Alternatives

**No cache — query DO on every session open**: acceptable at low volume; degrades at scale when many Conducting Agent sessions are opening simultaneously. The I2 enforcement requirement ("at the moment of execution") makes latency visible to the agent. Rejected for production.

**Cache in DO storage (not KV)**: DO storage is per-DO-instance and not edge-distributed. Would not provide the sub-1ms edge-local read benefit. Rejected.

**Redis / Upstash**: external service, adds latency on cache write/invalidate path, requires additional infra provisioning. CF KV is CF-native and requires zero additional infra. Rejected.
