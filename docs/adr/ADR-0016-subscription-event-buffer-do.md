# ADR-0016 — SubscriptionEventBuffer DO: GraphQL Subscription Fan-Out and Replay

**Status:** ACCEPTED  
**Date:** 2026-06-15  
**Closes:** OPEN-Q-3 from Factory-External-Interface-gRPC-GraphQL_v3.md  
**Spec:** `docs/Factory-Subscription-Replay-Contract-v1.md`

## Decision

GraphQL subscription fan-out and reconnect/replay are owned by a new lightweight Durable Object: **`SubscriptionEventBufferDO`**, one instance per session, named `sub-buffer:{sessionId}`.

## Gate decisions (all cleared 2026-06-15)

| Gate | Decision |
|------|----------|
| TTL window | 30-min sliding live window; 5-min terminal grace |
| Producer auth | Shared-secret HMAC (`SUB_BUFFER_PRODUCER_SECRET`) — loose coupling, no typed service binding per producer |
| Assembly fan-out merge | `factory-graphql` Worker merges across per-session buffers — no per-assembly index DO |
| Reconciliation depth | Trust fire-and-forget projection for live window; reconcile against durable sources (D1 + ArtifactGraph DO) only on TTL-fallback reconnect |
| ADR-0014 sharding | Deferred — fallback resolver selects shard by `assembly_id` when ADR-0014 trigger fires |

## Key invariants

- **I-SUB-01** At-least-once + client `seq` dedupe. Not exactly-once.
- **I-SUB-02** Total per-session ordering via monotonic gap-free `seq` (shared with gRPC `ResumeStream.from_sequence`).
- **I-SUB-03** No synthetic events — `REPLAY_UNAVAILABLE` rather than fabrication on active-session TTL expiry.
- **I-SUB-04** Buffer is subordinate to the system of record. Loss of the DO never affects session correctness.
- **I-SUB-05** Terminal closure — `Complete` sent to all sockets after terminal event; no further appends.

## Rationale

A CF Worker cannot hold a WebSocket across hibernation — only a DO can. Loading WebSocket ownership onto CoordinatorDO or ArtifactGraphDO would put subscriber liveness on the execution critical path. The buffer DO is disposable: execution DOs must never block on an observer.

The `seq` space is shared with gRPC `ResumeStream` so clients move between the live WebSocket tier and the authoritative durable stream without renumbering. The live buffer is a convenience projection; the durable stores (D1 `bead_audit`, ArtifactGraph DO) are truth.

## Implementation order

Phase 1: `@factory/subscription-buffer` package — DO core + SQLite schema + `seq` assignment + disposal alarm + KV shadow  
Phase 2: Hibernatable WebSocket + replay (`GET /ws`, tag filters, broadcast, auto-response keepalive)  
Phase 3: Producer emission — `emitSubscriptionEvent()` helper wired into CoordinatorDO, LoopClosureService, Commissioning Agent, Mediation Agent DO  
Phase 4: `factory-graphql` Worker subscription resolvers + Worker merge + durable fallback  
Phase 5: Parent spec §3.4 update (OPEN-Q-3 CLOSED)
