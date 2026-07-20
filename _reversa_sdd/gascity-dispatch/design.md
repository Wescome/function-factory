# Design — gascity-dispatch

> Unit: gascity-dispatch
> Phase 4 · Writer · Generated 2026-06-08

---

## Components

### GasCitySupervisor Container

```typescript
class GasCitySupervisor extends Container<Env> {
  defaultPort = 9443
  sleepAfter = "30m"
  enableInternet = true
  envVars = { FF_OPERATOR_CONTROL_TOKEN, GC_SUPERVISOR_TOKEN, ... Dolt/R2 creds }
}
```

Handles internal routes directly; proxies all others to `localhost:9443` via `containerFetch`.

### FactoryStore DO

SQLite-backed Durable Object using `ctx.storage.sql`. Tables: `beads`, `deps`, `specifications`, `verification_processes`.

Auth: `X-FF-Internal: factory-store` header check on every request.

---

## Request Flow

```
ff-pipeline Worker
  → env.GAS_CITY.fetch('/path') [CF Service Binding to gascity-supervisor Worker]
  → GasCitySupervisor.fetch()
      [internal routes: /v0/keepalive/*, /__supervisor/fence, /internal/telemetry]
      [all other routes: proxy to localhost:9443 with X-GC-Request: true]
  → Gas City daemon (port 9443)
  → response forwarded back
```

---

## FactoryStore Route Dispatch

```
POST /tx        → handleTx()     [transactional batch ops]
GET/POST /beads → handleBeads()  [bead CRUD]
GET/POST /deps  → handleBeads()  [dependency CRUD]
GET/POST /artifacts → handleArtifacts() [spec/verification CRUD]
```

All routes require `X-FF-Internal: factory-store` header.
