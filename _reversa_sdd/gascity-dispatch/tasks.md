# Tasks — gascity-dispatch

> Unit: gascity-dispatch
> Phase 4 · Writer · Generated 2026-06-08

---

## Implementation Tasks

### T-01: Implement Keepalive Refcount Logic
**Source:** `workers/gascity-supervisor/src/index.ts:onActivityExpired()`, `/v0/keepalive/*`
**Behavior:** Maintain `keepalive_refcount` in DO storage. start increments, stop decrements (min 0). onActivityExpired: if refcount > 0, call renewActivityTimeout(); else call super.
**Criterion for done:** Container stays warm while any molecule holds a keepalive; sleeps after stop brings refcount to 0.
**Confidence:** 🟢 CONFIRMED

### T-02: Implement CSRF Header Injection and Proxy
**Source:** `workers/gascity-supervisor/src/index.ts` default route handler
**Behavior:** Set `X-GC-Request: true` on headers. Rewrite URL protocol to `http:`, hostname to `localhost`, port to `9443`. Call `containerFetch(forwarded, 9443)`. Return 503 on container error.
**Criterion for done:** All non-internal routes are proxied to port 9443 with CSRF header.
**Confidence:** 🟢 CONFIRMED

### T-03: Implement FactoryStore Schema Initialization
**Source:** `workers/gascity-supervisor/src/factory-store-do.ts:initSchema()`
**Behavior:** CREATE TABLE IF NOT EXISTS for beads, deps, specifications, verification_processes. Create idx_status index on beads. Set auto_vacuum and foreign_keys PRAGMAs.
**Criterion for done:** FactoryStore starts fresh without errors; tables present after first instantiation.
**Confidence:** 🟢 CONFIRMED

### T-04: Implement Telemetry Endpoint with Auth and Batch Limit
**Source:** `workers/gascity-supervisor/src/index.ts:/internal/telemetry`
**Behavior:** Check `Authorization: Bearer {GC_SUPERVISOR_TOKEN}`. Parse JSON array, reject if > 50 items. Send to TELEMETRY_QUEUE. Return 503 if queue unbound.
**Criterion for done:** Authenticated batch of ≤50 events is forwarded to queue; >50 returns 400.
**Confidence:** 🟢 CONFIRMED
