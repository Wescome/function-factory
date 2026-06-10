# Requirements — ff-gateway

> Unit: ff-gateway (Public API Gateway)
> Phase 4 · Writer · Generated 2026-06-10

---

## JTBD

When an external operator or internal service needs to interact with the Function Factory, I want a single authenticated HTTP endpoint that routes to the appropriate internal service, so that all external traffic is gated and internal workers are never exposed directly.

---

## Functional Requirements

### FR-01: Single Public Entry Point
All external requests to the Factory API MUST enter via ff-gateway. The Worker MUST route to ff-gates, ff-pipeline, and the co-deployed QueryService via CF Service Bindings. It MUST NOT expose internal workers directly.
- Priority: **Must**
- 🟢 CONFIRMADO — `workers/ff-gateway/src/index.ts`, `wrangler.jsonc` service bindings

### FR-02: Cloudflare Access Authentication
In production, all routes MUST be protected by Cloudflare Access (configured at the CF zone layer). There is no programmatic auth check in `index.ts` — authentication is delegated entirely to the Cloudflare Access gate.
- Priority: **Must**
- 🔴 LACUNA — no programmatic auth check visible in index.ts; CF Access header injected by platform

### FR-03: Pipeline Trigger Route
`POST /pipeline` MUST extract `signal` from the request body. If absent, return 400 `"Missing signal field"`. Otherwise call `env.PIPELINE.create({ params: { signal, dryRun } })` and return 201 `{ instanceId, status: "started", statusUrl, approveUrl }`.
- Priority: **Must**
- 🟢 CONFIRMADO — `src/index.ts:143-160`

### FR-04: Architect Approval Route
`POST /approve/:id` MUST send an `architect-approval` event to the Workflow instance identified by `:id`. Architect identity resolved in priority order: (1) `cf-access-authenticated-user-email` header, (2) `body.by`, (3) fallback `"unknown"`. `decision` defaults to `"approved"`.
- Priority: **Must**
- 🟢 CONFIRMADO — `src/index.ts:162-179`

### FR-05: Coherence Verification Route
`POST /coherence-verification` (and legacy alias `POST /gate/1`) MUST call `env.GATES.evaluateCoherenceVerification()`. Return 200 if passed, 422 if failed.
- Priority: **Must**
- 🟢 CONFIRMADO — `src/index.ts:97-102`

### FR-06: Read-Path Routes (via QueryService)
The following routes MUST delegate to the co-deployed `QueryService` entrypoint:
- `GET /health` → `env.QUERY.getSystemHealth()`
- `GET /specs/:collection/:key` → `env.QUERY.getSpec()`
- `GET /specs/:collection` → `env.QUERY.listSpecs()` (pagination: `?limit` `?offset`, defaults 25/0)
- `GET /lineage/:collection/:key` → `env.QUERY.traceLineage()` (`?depth`, default 10)
- `GET /impact/:collection/:key` → `env.QUERY.traceImpact()` (`?depth`, default 5)
- `GET /gate-status/:gate/:id` → `env.QUERY.getGateStatus()`
- `GET /trust/:id` → `env.QUERY.getTrustScore()`
- `GET /crps/pending` → `env.QUERY.listPendingCRPs()`
- `GET /mrps/pending` → `env.QUERY.listPendingMRPs()`
- `GET /mentorscript` → `env.QUERY.listMentorRules()`
- `GET /pipeline/:id` → `env.PIPELINE.get(id).status()`
- Priority: **Must**
- 🟢 CONFIRMADO — `src/index.ts:43-211`

### FR-07: 404 with Available Routes
Any request not matching a defined route MUST return 404 with a JSON body listing all `availableRoutes`.
- Priority: **Should**
- 🟢 CONFIRMADO — `src/index.ts:207-211`

---

## Non-Functional Requirements

### NFR-01: D1-Backed QueryService
The `QueryService` MUST use D1 via `@factory/db-client` (`ArangoClient` shim) for all spec, lineage, and health queries. ArangoDB secrets are bound but marked deprecated in `wrangler.jsonc`.
- 🟢 CONFIRMADO — `src/query.ts:50-57`, `wrangler.jsonc` deprecated secrets note

### NFR-02: Self-Referencing Service Binding (QueryService)
The `QUERY` service binding in `wrangler.jsonc` points to `ff-gateway` itself (same Worker, `QueryService` named entrypoint). This co-deployment avoids a separate Worker for query traffic. May be split if query load requires independent scaling.
- 🟢 CONFIRMADO — `wrangler.jsonc:15-16`, comment

### NFR-03: CORS Header
All responses MUST include `Access-Control-Allow-Origin: *`. The `json()` helper applies this unconditionally.
- 🟢 CONFIRMADO — `src/index.ts:223-231`

### NFR-04: Error Handler
Any unhandled exception in route dispatch MUST return HTTP 500 `{ error: "<message>" }`. Non-Error throws produce `"Internal error"`.
- 🟢 CONFIRMADO — `src/index.ts:213-217`

### NFR-05: NaN Guard Missing on Pagination
`parseInt()` applied to `?limit` and `?offset` has no NaN guard at the route layer. A non-numeric query param would propagate as NaN to `listSpecs()`, bypassing the default `limit=25/offset=0` (defaults only fire for undefined, not NaN).
- 🔴 LACUNA — `src/index.ts:64-66`

---

## Acceptance Criteria

**Scenario: Pipeline trigger happy path**
```
Dado: POST /pipeline with { signal: { signalType: 'market', title: 'X', ... } }
Quando: Route dispatches to PIPELINE.create()
Então: 201 { instanceId, status: "started", statusUrl: "/pipeline/{id}", approveUrl: "/approve/{id}" }
```

**Scenario: Missing signal field**
```
Dado: POST /pipeline with {} (no signal)
Quando: Route handler checks body.signal
Então: 400 { error: "Missing signal field" }
```

**Scenario: Architect approval with CF Access header**
```
Dado: POST /approve/abc123 with cf-access-authenticated-user-email: wes@factory.dev
Quando: sendEvent called
Então: Event { type: 'architect-approval', payload: { decision: 'approved', by: 'wes@factory.dev' } } sent to Workflow
```

**Scenario: Coherence check fails**
```
Dado: POST /coherence-verification with malformed ExecutableSpecification
Quando: GATES.evaluateCoherenceVerification returns { passed: false }
Então: HTTP 422 with the CoherenceVerificationReport
```

**Scenario: Health degraded (D1 unreachable)**
```
Dado: db.ping() returns false
Quando: GET /health called
Então: { status: 'degraded', arango: false, collections: {}, timestamp }
```

**Scenario: Spec not found**
```
Dado: GET /specs/signals/SIG-NOT-EXIST
Quando: QueryService.getSpec() returns null
Então: HTTP 404 { error: "Not found" }
```
