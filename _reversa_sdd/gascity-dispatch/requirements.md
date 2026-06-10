# Requirements — gascity-dispatch

> Unit: gascity-dispatch (GasCitySupervisor Container + FactoryStore DO)
> Phase 4 · Writer · Generated 2026-06-08

---

## JTBD

When a compiled Function is dispatched to Gas City for molecule execution, I want the system to securely proxy requests to the Gas City daemon, persist bead state in a reliable SQLite store, and maintain container liveness, so that execution is reliable and auditable without exposing the Gas City internal API publicly.

---

## Functional Requirements

### FR-01: GasCitySupervisor Container Keepalive
The GasCitySupervisor MUST implement a keepalive refcount: POST /v0/keepalive/start increments the refcount, POST /v0/keepalive/stop decrements it. The container MUST remain warm while refcount > 0, overriding the default `sleepAfter: '30m'` behavior.
- Priority: **Must**
- 🟢 CONFIRMED — `workers/gascity-supervisor/src/index.ts:onActivityExpired()`

### FR-02: CSRF Header Injection
All proxied requests to the Gas City container MUST have the header `X-GC-Request: true` injected before forwarding. All other routes are proxied as-is.
- Priority: **Must**
- 🟢 CONFIRMED — `workers/gascity-supervisor/src/index.ts` headers injection

### FR-03: Container Fetch Proxy
The supervisor MUST rewrite all non-internal routes to `http://localhost:9443`, strip HTTPS protocol, and proxy via `containerFetch`. If container is not ready, return `{ error: 'container_not_ready' }` with 503.
- Priority: **Must**
- 🟢 CONFIRMED — `workers/gascity-supervisor/src/index.ts:fetch()` default route

### FR-04: Fence Endpoint
The supervisor MUST expose `GET /__supervisor/fence` returning `{ active: bool, refcount: number }` for liveness checks.
- Priority: **Must**
- 🟢 CONFIRMED — `workers/gascity-supervisor/src/index.ts:/__supervisor/fence`

### FR-05: Telemetry Event Ingest
The supervisor MUST expose `POST /internal/telemetry` (HMAC-authenticated) accepting up to 50 events per batch and forwarding them to `TELEMETRY_QUEUE`. Return 401 on auth failure, 400 on parse/limit error, 503 if queue unbound.
- Priority: **Should**
- 🟢 CONFIRMED — `workers/gascity-supervisor/src/index.ts:/internal/telemetry`

### FR-06: FactoryStore SQLite Schema Initialization
FactoryStore MUST initialize 4 SQLite tables on construction: `beads`, `deps`, `specifications`, `verification_processes`. Foreign keys MUST be enabled (`PRAGMA foreign_keys = ON`). Auto-vacuum MUST be enabled (`PRAGMA auto_vacuum = INCREMENTAL`).
- Priority: **Must**
- 🟢 CONFIRMED — `workers/gascity-supervisor/src/factory-store-do.ts:initSchema()`

### FR-07: FactoryStore Internal Auth
All FactoryStore requests MUST include the header `X-FF-Internal: factory-store`. Requests without this header MUST return 401.
- Priority: **Must**
- 🟢 CONFIRMED — `factory-store-do.ts:fetch()` auth check

### FR-08: FactoryStore Weekly Vacuum
FactoryStore MUST set an alarm for `VACUUM_INTERVAL_MS (7 days)`. On alarm, run `PRAGMA incremental_vacuum` and set the next alarm.
- Priority: **Should**
- 🟢 CONFIRMED — `factory-store-do.ts:alarm()`

---

## Non-Functional Requirements

### NFR-01: Max Payload Size
FactoryStore MUST reject payloads exceeding 1MB (MAX_PAYLOAD_BYTES = 1024 * 1024).
- 🟢 CONFIRMED — `factory-store-do.ts:MAX_PAYLOAD_BYTES`

### NFR-02: Internet Access Required
GasCitySupervisor Container MUST have `enableInternet = true` to reach the Gas City execution platform.
- 🟢 CONFIRMED — `index.ts:enableInternet = true`

---

## Acceptance Criteria

**Scenario: Container keepalive prevents sleep**
```
Dado: GasCitySupervisor receives POST /v0/keepalive/start (twice)
Quando: 30 minutes elapse without activity
Então: Container remains warm (onActivityExpired returns early, refcount > 0)
```

**Scenario: CSRF injection on proxied request**
```
Dado: A POST request arrives at GasCitySupervisor for any non-internal path
Quando: fetch() processes the request
Então: Forwarded request contains X-GC-Request: true header
```

**Scenario: Telemetry batch exceeds limit**
```
Dado: POST /internal/telemetry with 51 events
Quando: handler processes request
Então: Response 400 with { error: 'max 50 events per batch' }
```
