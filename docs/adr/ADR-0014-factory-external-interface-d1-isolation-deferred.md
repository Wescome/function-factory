# ADR-0014 — Factory External Interface: D1 Per-Assembly Isolation Deferred

**Status:** ACCEPTED  
**Date:** 2026-06-14  
**Closes:** OPEN-Q-5 from Factory-External-Interface-gRPC-GraphQL_v3.md

## Decision

Shared D1 (three databases: `factory-artifacts`, `factory-ops`, `factory-registry`) is the production configuration. Per-assembly D1 isolation is deferred until a real trigger fires.

## Triggers that reopen this decision

- Signed regulatory or contractual requirement mandating assembly-level data isolation (HIPAA BAA, data-residency clause, tenancy contract)
- More than ~12 externally-operated paying assemblies with noisy-neighbor or blast-radius concerns
- D1 per-database size or throughput ceiling hit by the largest assembly

Team size alone is not a trigger.

## Forward design (shelved)

Complete routing architecture designed 2026-06-14:

- **Dispatch Worker** — zero D1 bindings; routes by `assembly_id` via KV `ASSEMBLY_ROUTES` + service bindings
- **Shard Workers** — ≤3 assemblies × 3 DBs = 9 bindings each; shard-0 = today's shared system
- **Registry** — `factory-registry.shard_map` (D1 authority) → `ASSEMBLY_ROUTES` (KV cache)
- **Migration** — backfill → dual-write → KV cut → soak → drain; rollback = single KV write
- **GraphQL** — assembly-scoped queries only; resolver selects binding_prefix from request context

Two architecture gates to clear before implementation:
1. Cross-assembly GraphQL query policy (scoped-only recommended)
2. DDL migration location (Wrangler CI at deploy, Option A, recommended)

When a trigger fires, the upgrade is drop-in: shard-0 is the shared system already running, every unmapped assembly defaults to it — no breaking changes to existing callers.

## Rationale

Shared D1 is simpler, ships faster, and operationally correct for current scale. Routing complexity is real; the static-binding constraint (10 D1 bindings per Worker, declared at deploy) is non-trivial. No value in building it before an isolation requirement exists.
