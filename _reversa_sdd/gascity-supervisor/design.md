# Design — gascity-supervisor

> Unit: gascity-supervisor (Gas City Container Host)
> Phase 4 · Writer · Generated 2026-06-10

---

## Overview

The `gascity-supervisor` Cloudflare Worker package hosts two layers:
1. **Worker fetch handler** — public auth gate, route dispatcher, telemetry ingestion, bead-store proxy
2. **GasCitySupervisor** — `Container` Durable Object hosting the `gc-linux-amd64` daemon on port 9443

A third component, **FactoryStore**, is a plain Durable Object providing SQLite persistence for Gas City's bead/artifact store.

---

## Component Hierarchy

```
Cloudflare Worker (default.fetch)
├── POST /internal/telemetry → TELEMETRY_QUEUE (auth gate, no container)
├── GET  /internal/telemetry/health → queue binding status
├── * /internal/bead-store/{city}/{...path} → FactoryStore DO (auth gate + proxy)
└── * (all other) → GasCitySupervisor DO (auth gate + proxy)

GasCitySupervisor (Container DO)
├── POST /v0/keepalive/start → increment refcount, renewActivityTimeout
├── POST /v0/keepalive/stop  → decrement refcount, conditionally renewActivityTimeout
├── GET  /__supervisor/fence → { active, refcount } (no auth)
└── * → proxy to gc daemon at localhost:9443
    ├── Inject X-GC-Request: true
    ├── Rewrite URL: http://localhost:9443{path}
    └── Omit body on GET/HEAD

FactoryStore (Durable Object, SQLite)
├── All routes require X-FF-Internal: factory-store header
├── /beads CRUD + /deps + /tx
├── /artifacts/{collection} CRUD + /artifacts/lineage + /artifacts/tx
└── PRAGMA incremental_vacuum alarm (7-day schedule)
```

---

## Worker Route Dispatch (priority order)

| Priority | Method | Path | Handler | Auth |
|---|---|---|---|---|
| 1 | POST | `/internal/telemetry` | Validate → TELEMETRY_QUEUE.send | Bearer GC_SUPERVISOR_TOKEN |
| 2 | GET | `/internal/telemetry/health` | Queue binding status | Bearer GC_SUPERVISOR_TOKEN |
| 3 | * | `/internal/bead-store/{city}/{...}` | FactoryStore DO proxy | Bearer GC_SUPERVISOR_TOKEN |
| 4 | * | `*` | GasCitySupervisor DO proxy | Bearer GC_SUPERVISOR_TOKEN |

---

## Keepalive Reference Count Protocol

State stored in DO storage key: `keepalive_refcount`.

```
POST /v0/keepalive/start:
  current = storage.get('keepalive_refcount') ?? 0
  next = current + 1
  storage.put('keepalive_refcount', next)
  this.renewActivityTimeout()
  return { ok: true, refcount: next }

POST /v0/keepalive/stop:
  current = storage.get('keepalive_refcount') ?? 0
  next = Math.max(0, current - 1)
  storage.put('keepalive_refcount', next)
  if next > 0: this.renewActivityTimeout()   // other molecules still holding
  // if next === 0: do NOT renew — allow natural 30m sleep
  return { ok: true, refcount: next }

GET /__supervisor/fence:
  refcount = storage.get('keepalive_refcount') ?? 0
  return { active: refcount > 0, refcount }  // no auth check

onActivityExpired():
  refcount = storage.get('keepalive_refcount') ?? 0
  if refcount > 0: this.renewActivityTimeout(); return
  super.onActivityExpired()   // normal sleep

onStop():
  storage.delete('keepalive_refcount').catch(() => {})
```

---

## Bead Store Proxy Algorithm

```
path = /internal/bead-store/{city}/{doPath}
rest = pathname.slice("/internal/bead-store/".length)
slash = rest.indexOf("/")
if slash <= 0: return 400 { error: "invalid_path" }
city = rest.slice(0, slash)         // FactoryStore DO name
doPath = rest.slice(slash)          // includes leading "/"

inner = new Request(doPath + url.search, request)
inner.headers.delete('Authorization')       // strip token
inner.headers.set('X-FF-Internal', 'factory-store')

do = env.FACTORY_STORE.idFromName(city)
return do.fetch(inner)
```

Security rationale: Worker validates the always-current bearer secret, strips it, injects the internal sentinel. Token rotation does not require DO update — DO only trusts the sentinel.

---

## GasCitySupervisor Static Configuration

| Property | Value |
|---|---|
| `defaultPort` | 9443 |
| `sleepAfter` | `"30m"` |
| `enableInternet` | `true` |
| Singleton key | `"singleton-v51"` |

Container env injected at startup:
```
FF_OPERATOR_CONTROL_TOKEN = env.OPERATOR_CONTROL_TOKEN
GC_SUPERVISOR_TOKEN        = env.GC_SUPERVISOR_TOKEN
GC_BEAD_STORE_URL          = "https://gascity-supervisor.koales.workers.dev/internal/bead-store/factory"
GAS_CITY_HMAC_SECRET       = env.GAS_CITY_HMAC_SECRET
AWS_ACCESS_KEY_ID          = env.DOLT_R2_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY      = env.DOLT_R2_SECRET_ACCESS_KEY
AWS_REGION                 = "auto"
DOLT_R2_ENDPOINT           = env.DOLT_R2_ENDPOINT
DOLT_AWS_ENDPOINT          = "https://cb56a846c70a38987f31cf6e2b85cb57.r2.cloudflarestorage.com"
```

---

## FactoryStore Schema

### Typed tables

**`beads`** — primary work-item store
```
id TEXT PK (format: "do-{N}" via nextID MAX query)
title TEXT, status TEXT DEFAULT 'open'
issue_type TEXT DEFAULT 'task', priority INTEGER nullable
created_at TEXT, assignee TEXT nullable
from_ TEXT nullable (wire: "from"), parent_id TEXT nullable (wire: "parent")
ref TEXT nullable, needs TEXT DEFAULT '[]' (JSON array)
description TEXT nullable, labels TEXT DEFAULT '[]' (JSON array)
metadata TEXT DEFAULT '{}' (JSON object), ephemeral INTEGER DEFAULT 0
INDEX: idx_status ON beads(status)
```

**`deps`** — bead dependency edges
```
issue_id TEXT → FK beads.id
depends_on_id TEXT, dep_type TEXT
PK: (issue_id, depends_on_id)
```

Typed event tables: `specifications`, `verification_processes`, `verdicts`, `lineage_edges`, `completion_events`, `fidelity_verdicts`, `dispatch_log`, `specs_functions`, `lifecycle_transitions`, `run_envelopes`, `divergences`, `hypotheses`, `specs_signals`, `merge_readiness_packs`, `completion_ledgers`

### Generic event-sourced tables (schema: id, kind, payload, agent_id, emission_bead_id, created_at, updated_at)

`function_proposals`, `workgraphs`, `pressures`, `capabilities`, `prds`, `invariants`, `consultation_requests`, `candidate_sets`, `elucidation_artifacts`, `crps`, `vcrs`, `mrps`, `mentor_rules`, `agents`, `assurance_graph`, `specs_incidents`, `memory_entries`, `orl_telemetry`

---

## Key Algorithms

### nextID (bead auto-increment)
```sql
SELECT COALESCE(MAX(CAST(SUBSTR(id,4) AS INT)), 0) + 1 AS next
FROM beads WHERE id LIKE 'do-%'
```
Returns `"do-{N}"`. Not globally unique — unique within a single FactoryStore DO instance.

### queryBeads filter precedence
1. `status="open"` → clause: `(status='open' OR status='')` — handles legacy empty-string rows
2. Other non-empty status → `status=?`
3. No status + includeClosed=false → `status!='closed'`
4. `label` / `metadata` filters → applied in-memory post-query
5. Sorting: `created_asc`/`created_desc` — in-memory ISO string compare
6. Limit: after in-memory filtering

Supports both camelCase and PascalCase query params to mirror Gas City Go DoStore `ListQuery` format.

### Metadata merge (patchBead)
Shallow `Object.assign` over current JSON metadata. Non-string values coerced via `String()`.

### Label merge (patchBead)
Set semantics: `append` items added, `remove` items deleted. Stored as JSON array.

### Lineage walk (recursive CTE, max 10 hops)
```sql
WITH RECURSIVE lineage_walk AS (
  SELECT id, from_id, to_id, from_kind, to_kind, edge_kind, 1 AS depth
  FROM lineage_edges WHERE to_id = ?1
  UNION ALL
  SELECT le.id, le.from_id, le.to_id, le.from_kind, le.to_kind, le.edge_kind, lw.depth + 1
  FROM lineage_edges le
  JOIN lineage_walk lw ON le.to_id = lw.from_id
  WHERE lw.depth < 10
) SELECT * FROM lineage_walk
```

---

## Error Handling

| Layer | Error | Response |
|---|---|---|
| Worker | Unauthorized | 401 `{ error: "unauthorized" }` |
| Worker | Invalid JSON body | 400 `{ error: "invalid json" }` |
| Worker | Events not array | 400 `{ error: "events must be an array" }` |
| Worker | Batch > 50 | 400 `{ error: "max 50 events per batch" }` |
| Worker | Queue unbound | 503 `{ error: "telemetry_queue_unbound" }` |
| Worker | Invalid bead-store path | 400 `{ error: "invalid_path" }` |
| Worker | Container error | 503 `{ error: "container_not_ready", detail }` |
| FactoryStore | DO auth failed | 401 `{ error: "unauthorized" }` |
| FactoryStore | FK violation | 409 `{ error: "foreign_key_violation" }` |
| FactoryStore | Payload too large | 413 `{ error: "payload_too_large" }` |
| FactoryStore | SQLite error | 500 `{ error: "internal_error", detail }` |
| FactoryStore | Not found | 404 `{ error: "not_found" }` |

`tombstoneBead()` sets `status='deleted'` and `ephemeral=0` — does NOT delete the SQL row.

---

## Data Structures

### Env
```typescript
interface Env {
  SUPERVISOR: DurableObjectNamespace     // GasCitySupervisor DO
  FACTORY_STORE: DurableObjectNamespace  // FactoryStore DO
  TELEMETRY_QUEUE?: Queue                // optional
  GC_SUPERVISOR_TOKEN: string
  OPERATOR_CONTROL_TOKEN: string
  GAS_CITY_HMAC_SECRET: string
  DOLT_R2_ACCESS_KEY_ID: string
  DOLT_R2_SECRET_ACCESS_KEY: string
  DOLT_R2_ENDPOINT: string
}
```

### Domain Constants
| Constant | Value |
|---|---|
| `SUPERVISOR_SINGLETON` | `"singleton-v51"` |
| `MAX_PAYLOAD_BYTES` | `1048576` (1 MB) |
| `VACUUM_INTERVAL_MS` | `604800000` (7 days) |
| `GC_BEAD_STORE_URL` | `"https://gascity-supervisor.koales.workers.dev/internal/bead-store/factory"` |
