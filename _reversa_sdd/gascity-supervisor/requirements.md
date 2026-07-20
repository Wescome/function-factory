# Requirements — gascity-supervisor

> Unit: gascity-supervisor (Gas City Container Host)
> Phase 4 · Writer · Generated 2026-06-10

---

## JTBD

When a Formula is dispatched by the factory pipeline, I want a long-running Gas City daemon to receive it inside a Cloudflare Container, so that agent-based code synthesis sessions can run with filesystem access, real test execution, and bi-directional communication with the factory without exposing the daemon to public internet traffic.

---

## Functional Requirements

### FR-01: Gas City Container Lifecycle Management
The `GasCitySupervisor` Container DO MUST host the `gc-linux-amd64` daemon on port 9443 with `sleepAfter="30m"` idle timeout and `enableInternet=true`. The singleton key MUST be `"singleton-v51"` — incrementing the suffix forces a new container image on deploy.
- Priority: **Must**
- 🟢 CONFIRMADO — `workers/gascity-supervisor/src/index.ts:4-10`

### FR-02: Environment Variable Injection at Container Startup
At container startup, the DO MUST inject the following environment variables into the Gas City daemon process:
- `FF_OPERATOR_CONTROL_TOKEN` — auth for outbound calls to ff-pipeline `/__pi-container/execute`
- `GC_SUPERVISOR_TOKEN` — supervisor bearer token used internally by gc daemon
- `GC_BEAD_STORE_URL` — hardcoded internal bead-store proxy URL
- `GAS_CITY_HMAC_SECRET` — HMAC signing secret for webhook requests
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` — R2/Dolt credentials
- `DOLT_R2_ENDPOINT`, `DOLT_AWS_ENDPOINT` — R2 endpoint URLs
- Priority: **Must**
- 🟢 CONFIRMADO — `index.ts:17-26`

### FR-03: Cooperative Keepalive Reference Count
The DO MUST implement a reference count (`keepalive_refcount` in DO storage) so that multiple concurrent molecules can hold the container warm.
- `POST /v0/keepalive/start`: increment refcount, call `renewActivityTimeout()`, return `{ ok, refcount }`
- `POST /v0/keepalive/stop`: decrement refcount (floor 0), call `renewActivityTimeout()` only if next > 0, return `{ ok, refcount }`
- `GET /__supervisor/fence`: return `{ active: refcount > 0, refcount }` (no auth required)
- Priority: **Must**
- 🟢 CONFIRMADO — `index.ts:46-74`

### FR-04: Activity Timeout Override (onActivityExpired)
When the 30-minute idle timer expires, the DO MUST check `keepalive_refcount`. If `refcount > 0`, it MUST call `renewActivityTimeout()` and return early (prevent sleep). If `refcount === 0`, it MUST delegate to `super.onActivityExpired()` (normal sleep).
- Priority: **Must**
- 🟢 CONFIRMADO — `index.ts:30-37`

### FR-05: onStop Cleanup
On container stop, the DO MUST delete `keepalive_refcount` from storage to prevent stale refcount persisting across restarts.
- Priority: **Must**
- 🟢 CONFIRMADO — `index.ts:39-41`

### FR-06: Request Proxying to Container
All Worker requests not matched by keepalive or fence MUST be authenticated then proxied to the container daemon:
1. Inject `X-GC-Request: true` header (Gas City CSRF requirement)
2. Rewrite URL to `http://localhost:9443{path}`
3. Omit body on GET/HEAD requests
4. On container error: return 503 `{ error: "container_not_ready", detail }`
- Priority: **Must**
- 🟢 CONFIRMADO — `index.ts:76-100`

### FR-07: Telemetry Queue Ingestion (Internal Route)
`POST /internal/telemetry` MUST authenticate the request, validate the body (JSON array, max 50 events), and send to `TELEMETRY_QUEUE`. If `TELEMETRY_QUEUE` is unbound, return 503 `{ error: "telemetry_queue_unbound" }`.
- Priority: **Must**
- 🟢 CONFIRMADO — `index.ts:108-148`

### FR-08: Bead Store Proxy (Internal Route)
`* /internal/bead-store/{city}/{...path}` MUST authenticate the request, parse `city` as the DO name, strip the `Authorization` header, inject `X-FF-Internal: factory-store`, and proxy to the `FactoryStore` DO named by `city`. Invalid paths (no slash after city segment) MUST return 400.
- Priority: **Must**
- 🟢 CONFIRMADO — `index.ts:170-200`

### FR-09: FactoryStore SQLite DO — Bead Persistence
The `FactoryStore` DO MUST provide a SQLite-backed bead/artifact store with CRUD operations over beads, dependencies, specifications, verification processes, verdicts, lineage edges, completion events, and all typed/generic event-sourced tables. All operations MUST require the `X-FF-Internal: factory-store` header.
- Priority: **Must**
- 🟢 CONFIRMADO — `factory-store-do.ts:1-500`

### FR-10: FactoryStore — Auto-Vacuum Schedule
The FactoryStore DO MUST schedule a `PRAGMA incremental_vacuum` alarm every 7 days (`VACUUM_INTERVAL_MS = 604800000`). The vacuum MUST run `PRAGMA incremental_vacuum` and reschedule.
- Priority: **Should**
- 🟢 CONFIRMADO — `factory-store-do.ts:29-32`

### FR-11: FactoryStore — Payload Size Enforcement
All `insertCollection` and `patchCollection` operations MUST enforce a maximum payload of 1 MB (`MAX_PAYLOAD_BYTES = 1048576`). Oversized payloads MUST return HTTP 413.
- Priority: **Must**
- 🟢 CONFIRMADO — `factory-store-do.ts:enforcePayloadLimit()`

### FR-12: FactoryStore — Lineage Walk (Recursive CTE)
`GET /artifacts/lineage?from={id}` MUST traverse `lineage_edges` upward from the given artifact ID using a recursive SQLite CTE up to 10 hops, returning all ancestors with their depth.
- Priority: **Must**
- 🟢 CONFIRMADO — `factory-store-do.ts:462-475`

### FR-13: FactoryStore — Transactional Batch Operations
`POST /tx` and `POST /artifacts/tx` MUST wrap batch operations in a SQLite transaction. On any error: ROLLBACK and rethrow. Supported op kinds for `/tx`: `update`, `set_metadata_batch`, `close`.
- Priority: **Must**
- 🟢 CONFIRMADO — `factory-store-do.ts:runTx()`, `artifactTx()`

---

## Non-Functional Requirements

### NFR-01: Auth at Worker Layer, Not DO Layer
The Worker is the auth gate for all routes. The DO trusts only the internal `X-FF-Internal: factory-store` sentinel header (never the user bearer token). This means bearer token rotation does not require updating the DO.
- 🟢 CONFIRMADO — `index.ts:188-190` (code comment)

### NFR-02: Container Instance Rotation via Key Suffix
Incrementing the `SUPERVISOR_SINGLETON` suffix (currently `v51`) forces Cloudflare to start the newly deployed image rather than reusing a warm prior-version container. Must be done on any binary deploy.
- 🟢 CONFIRMADO — `index.ts:211-213` (code comment)

### NFR-03: Binary Opacity
The `gc-linux-amd64` binary is ~98 MB, statically linked, not stripped. Its internal API, routing logic, city.toml configuration, and provider behavior are opaque — source not in this repository.
- 🔴 LACUNA — binary internals not inspectable

### NFR-04: Bead Status Backfill (Legacy Migration)
On `initSchema()`, the FactoryStore MUST normalize `status=''` → `'open'` for beads persisted before the default fix. `queryBeads()` with `status="open"` MUST match `(status='open' OR status='')` to handle legacy rows.
- 🟢 CONFIRMADO — `factory-store-do.ts:55-56`, `queryBeads()` clause

---

## Acceptance Criteria

**Scenario: Molecule holds container warm via keepalive**
```
Dado: Pipeline calls POST /v0/keepalive/start before dispatch
Quando: 30-minute idle timer fires (onActivityExpired)
Then: refcount > 0 → renewActivityTimeout() called; container does NOT sleep
```

**Scenario: Container sleeps after all molecules complete**
```
Dado: All molecules have called POST /v0/keepalive/stop; refcount = 0
Quando: 30-minute idle timer fires
Then: super.onActivityExpired() called; container transitions to sleep
```

**Scenario: Bead store proxy strips auth header**
```
Dado: Worker receives authenticated request for /internal/bead-store/factory/beads
Quando: proxy logic executes
Then: Request forwarded to FactoryStore DO with Authorization header removed; X-FF-Internal: factory-store injected
```

**Scenario: Oversized artifact payload rejected**
```
Dado: POST /artifacts/specs_functions with payload > 1 MB
Quando: FactoryStore enforcePayloadLimit() runs
Then: HTTP 413 returned; no SQLite write occurs
```

**Scenario: Telemetry queue unbound**
```
Dado: TELEMETRY_QUEUE binding is absent from Worker env
Quando: POST /internal/telemetry is called
Then: HTTP 503 { error: "telemetry_queue_unbound" } returned
```

**Scenario: Container restart resets refcount**
```
Dado: Container stops (onStop fires)
Quando: Container is restarted
Then: keepalive_refcount deleted from DO storage; refcount starts at 0 on restart
```
