# Design — ff-gateway

> Unit: ff-gateway (Public API Gateway)
> Phase 4 · Writer · Generated 2026-06-10

---

## Overview

`ff-gateway` is the single public-facing Cloudflare Worker for the Factory API. It co-deploys two named entrypoints:
1. `default` — HTTP router (`export default { async fetch(request, env) }`)
2. `QueryService` — named WorkerEntrypoint for Service Binding calls from the same Worker

The `QUERY` service binding points back to `ff-gateway` itself (self-referencing binding), co-deploying read-path logic without a separate Worker.

---

## Component Hierarchy

```
ff-gateway Worker
├── default.fetch (HTTP router)
│   ├── GET  /health             → QUERY.getSystemHealth()
│   ├── GET  /specs/:c/:k        → QUERY.getSpec()
│   ├── GET  /specs/:c           → QUERY.listSpecs() [paginated]
│   ├── GET  /lineage/:c/:k      → QUERY.traceLineage() [recursive SQL]
│   ├── GET  /impact/:c/:k       → QUERY.traceImpact()  [reverse recursive SQL]
│   ├── GET  /gate-status/:g/:id → QUERY.getGateStatus()
│   ├── GET  /trust/:id          → QUERY.getTrustScore()
│   ├── GET  /crps/pending       → QUERY.listPendingCRPs()
│   ├── GET  /mrps/pending       → QUERY.listPendingMRPs()
│   ├── GET  /mentorscript       → QUERY.listMentorRules()
│   ├── POST /coherence-verification → GATES.evaluateCoherenceVerification()
│   ├── POST /gate/1             → GATES.evaluateCoherenceVerification() [alias]
│   ├── POST /pipeline           → PIPELINE.create({ params: { signal, dryRun } })
│   ├── POST /approve/:id        → PIPELINE.get(id).sendEvent('architect-approval')
│   └── GET  /pipeline/:id       → PIPELINE.get(id).status()
└── QueryService (WorkerEntrypoint)
    ├── getSpec(collection, key)
    ├── listSpecs(collection, opts)      [D1: ORDER BY createdAt DESC, 2 queries]
    ├── traceLineage(collection, key, depth)  [D1: recursive CTE OUTBOUND, default depth 10]
    ├── traceImpact(collection, key, depth)   [D1: recursive CTE INBOUND, default depth 5]
    ├── getGateStatus(gate, id)         [D1: verification_status/gate:{gate}:{id}]
    ├── getTrustScore(id)               [D1: trust_scores/trust:{id}]
    ├── getSystemHealth()               [D1: ping + collection counts]
    ├── listPendingCRPs()               [D1: consultation_requests status=pending]
    ├── listPendingMRPs()               [D1: merge_readiness_packs verdict=merge-ready + resolution IS NULL]
    └── listMentorRules()               [D1: mentorscript_rules status=active]
```

---

## Key Data Flows

### Pipeline trigger
```
POST /pipeline { signal, dryRun? }
  ↓ check body.signal present → 400 if absent
  ↓ PIPELINE.create({ params: { signal, dryRun: false } })
  ↓ 201 { instanceId, status:"started", statusUrl, approveUrl }
```

### Architect approval
```
POST /approve/:id { decision?, reason?, by? }
  ↓ resolve architect identity:
      cf-access-authenticated-user-email header
      ?? body.by
      ?? "unknown"
  ↓ PIPELINE.get(id).sendEvent({
      type: "architect-approval",
      payload: { decision: "approved", reason, by }
    })
  ↓ 200 { ok: true }
```

### Coherence verification
```
POST /coherence-verification { ...executableSpecification }
  ↓ GATES.evaluateCoherenceVerification(body)
  ↓ report.passed=true  → 200 + report
  ↓ report.passed=false → 422 + report
```

### Read path (example: lineage traversal)
```
GET /lineage/executable-specifications/ES-abc?depth=5
  ↓ resolveCollection("executable-specifications") → "executable_specifications"
  ↓ QUERY.traceLineage("executable_specifications", "ES-abc", 5)
  ↓ D1 recursive CTE OUTBOUND, 5 hops
  ↓ 200 [ LineageNode, ... ]
```

---

## Critical Design Decisions

### Collection Name Resolution
Two-stage lookup in `resolveCollection(collection: string)`:
1. Check `SPEC_COLLECTIONS` map (handles hyphenated aliases like `"intent-specifications"` → `"intent_specifications"`)
2. If in `NON_SPEC_COLLECTIONS` set → return as-is (no prefix)
3. Otherwise → prefix with `specs_` (e.g., `"foo"` → `"specs_foo"`)

```typescript
const SPEC_COLLECTIONS = {
  signals: 'specs_signals',
  pressures: 'specs_pressures',
  capabilities: 'specs_capabilities',
  functions: 'specs_functions',
  'intent-specifications': 'intent_specifications',
  intent_specifications: 'intent_specifications',
  'executable-specifications': 'executable_specifications',
  executable_specifications: 'executable_specifications',
  invariants: 'specs_invariants',
  'verification-reports': 'verification_reports',
  verification_reports: 'verification_reports',
}
const NON_SPEC_COLLECTIONS = new Set([
  'execution_artifacts', 'memory_episodic', 'memory_semantic',
  'memory_working', 'memory_personal', 'verification_status'
])
```

### Recursive CTE Traversal (traceLineage / traceImpact)
Both methods use SQLite `WITH RECURSIVE` on the D1 `edges` table.

**traceLineage** — OUTBOUND (follows `from_id` → `to_id`):
```sql
WITH RECURSIVE lineage(id, depth, edge_data) AS (
  SELECT e.to_id, 1, e.data
  FROM edges e WHERE e.collection='lineage_edges' AND e.from_id=?
  UNION ALL
  SELECT e.to_id, l.depth+1, e.data
  FROM edges e JOIN lineage l ON e.from_id=l.id
  WHERE e.collection='lineage_edges' AND l.depth < ?
)
SELECT DISTINCT d.json, l.depth, l.edge_data
FROM lineage l JOIN documents d ON ...
```

**traceImpact** — INBOUND (reverses `from_id`/`to_id` roles):
Starts from `e.to_id=?`, expands via `e.to_id=i.id`. Same max-depth mechanics.

Post-processing: for each node ID in format `{collection}/{key}`, split on `/` to join with `documents` table.

### listSpecs pagination
Two D1 queries per call: items (ORDER BY `json->>'$.createdAt' DESC`, LIMIT+OFFSET) and total count. Defaults: `limit=25, offset=0` — apply if opts.limit/offset are undefined (NaN from parseInt bypasses defaults).

### getSystemHealth
1. `db.ping()` → SELECT 1; false → return degraded immediately
2. COUNT per SPEC_COLLECTIONS entry
3. COUNT per 4 memory tiers (episodic, semantic, working, personal)
4. COUNT lineage_edges

---

## Data Structures

### GatewayEnv (env.ts)
```typescript
interface GatewayEnv {
  GATES: GatesBinding        // Service Binding → ff-gates:GatesService
  QUERY: QueryBinding        // Service Binding → ff-gateway:QueryService (self)
  PIPELINE: PipelineBinding  // Workflow Binding → ff-pipeline:FactoryPipeline
  DB: D1Database             // D1 database (ff-factory)
  ENVIRONMENT: string        // "production"
}
```

### LineageNode (query output)
```typescript
interface LineageNode {
  id: string          // _key of the document
  collection: string  // collection portion of _id
  type: string        // doc.type field
  title?: string
  depth: number       // hop count from startId
  edgeType?: string   // edge_data.type if present
}
```

### SystemHealth
```typescript
interface SystemHealth {
  status: 'healthy' | 'degraded'
  arango: boolean
  collections: Record<string, number>   // collection → document count
  timestamp: string
}
```

---

## Cloudflare Binding Topology (wrangler.jsonc)

| Binding | Type | Target |
|---|---|---|
| `DB` | D1 | `ff-factory` (id: `6a72d5c3-bcbb-41e3-b29d-d8de5834c3b3`) |
| `GATES` | Service | `ff-gates` → `GatesService` entrypoint |
| `QUERY` | Service | `ff-gateway` → `QueryService` entrypoint (self-reference) |
| `PIPELINE` | Workflow | `ff-pipeline` → `FactoryPipeline` class |

Deprecated secrets (database layer migrated to D1): `ARANGO_URL`, `ARANGO_DATABASE`, `ARANGO_JWT`

---

## Known Lacunas

| # | Issue | Severity |
|---|---|---|
| 1 | No programmatic auth check in index.ts — Cloudflare Access is referenced in comments only | LACUNA |
| 2 | ENVIRONMENT binding declared and set in wrangler.jsonc but never branched on in router | LACUNA |
| 3 | parseInt() for limit/offset has no NaN guard — NaN bypasses default values | LACUNA |
| 4 | `getInvariantHealth(id)` implemented in QueryService but not in QueryBinding interface and not routed | LACUNA |
| 5 | `POST /webhook/ci-result` documented in module docstring but not yet implemented | PLANNED GAP |
| 6 | No request body size limits or Content-Type validation on POST routes | LACUNA |
