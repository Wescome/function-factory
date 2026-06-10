# Contracts — ff-gateway

> Unit: ff-gateway (Public API Gateway)
> Phase 4 · Writer · Generated 2026-06-10
> doc_level: completo

---

## HTTP Contract

**Base URL:** `https://ff-gateway.{zone}.workers.dev` (or custom domain)
**Auth:** Cloudflare Access (platform-level, no programmatic header check in code)
**Content-Type:** `application/json` on all requests and responses
**CORS:** `Access-Control-Allow-Origin: *` on all responses

---

### GET /health

Returns system health and D1 collection document counts.

**Request:** No body.

**Response 200 (healthy)**
```json
{
  "status": "healthy",
  "arango": true,
  "collections": {
    "specs_signals": 142,
    "specs_pressures": 38,
    "specs_capabilities": 29,
    "specs_functions": 21,
    "intent_specifications": 19,
    "executable_specifications": 15,
    "specs_invariants": 88,
    "verification_reports": 12,
    "memory_episodic": 44,
    "memory_semantic": 17,
    "memory_working": 3,
    "memory_personal": 0,
    "lineage_edges": 230
  },
  "timestamp": "2026-06-10T12:00:00.000Z"
}
```

**Response 200 (degraded — D1 unreachable)**
```json
{
  "status": "degraded",
  "arango": false,
  "collections": {},
  "timestamp": "2026-06-10T12:00:00.000Z"
}
```

---

### GET /specs/:collection/:key

Retrieve a single spec document.

**Path params:**
- `collection` — public slug (e.g., `signals`, `executable-specifications`) or raw D1 collection name
- `key` — document key (e.g., `SIG-abc123`)

**Response 200** — raw document JSON as stored in D1

**Response 404**
```json
{ "error": "Not found" }
```

---

### GET /specs/:collection

List specs with pagination.

**Query params:**
- `limit` — integer, default 25 (NOTE: NaN from non-numeric values bypasses default)
- `offset` — integer, default 0

**Response 200**
```json
{
  "items": [ ...document JSON... ],
  "total": 142
}
```

Items ordered by `createdAt` descending.

---

### GET /lineage/:collection/:key

Traverse lineage (OUTBOUND) from a given artifact.

**Query params:**
- `depth` — integer, default 10, max determined by CTE

**Response 200**
```json
[
  {
    "id": "ES-abc123",
    "collection": "executable_specifications",
    "type": "executableSpecification",
    "title": "My Function",
    "depth": 1,
    "edgeType": "compiled-from"
  }
]
```

---

### GET /impact/:collection/:key

Traverse impact (INBOUND) — downstream artifacts from a given node.

**Query params:**
- `depth` — integer, default 5

**Response 200** — same shape as `/lineage`

---

### POST /coherence-verification

Evaluate an ExecutableSpecification against all 5 coherence checks.

**Request body:** ExecutableSpecification JSON (raw object)

**Response 200 (passed)**
```json
{
  "verification": "coherence",
  "passed": true,
  "timestamp": "2026-06-10T12:00:00.000Z",
  "executableSpecificationId": "ES-abc123",
  "checks": [
    { "name": "atom-coverage", "passed": true, "detail": "All 8 atoms are bound." }
  ],
  "summary": "Coherence Verification PASSED: 5 checks, all clear"
}
```

**Response 422 (failed)**
```json
{
  "verification": "coherence",
  "passed": false,
  "timestamp": "...",
  "executableSpecificationId": "ES-abc123",
  "checks": [
    { "name": "atom-coverage", "passed": false, "detail": "2 atoms unbound: atom-3, atom-7" },
    { "name": "lineage-completeness", "passed": false, "detail": "No signal found within 10 hops." }
  ],
  "summary": "Coherence Verification FAILED: atom-coverage, lineage-completeness"
}
```

---

### POST /gate/1

Legacy alias for `POST /coherence-verification`. Identical request/response contract.

---

### POST /pipeline

Trigger a new FactoryPipeline Workflow instance.

**Request body**
```json
{
  "signal": {
    "signalType": "market",
    "source": "operator",
    "title": "Add retry logic to email sender",
    "description": "Current email sender silently drops failures.",
    "evidence": ["support/ticket-1234"],
    "raw": { "autoApprove": false }
  },
  "dryRun": false
}
```

**Required fields:** `signal` (object). `dryRun` defaults to `false`.

**Response 201 (created)**
```json
{
  "instanceId": "factory-pipeline-abc123",
  "status": "started",
  "statusUrl": "/pipeline/factory-pipeline-abc123",
  "approveUrl": "/approve/factory-pipeline-abc123"
}
```

**Response 400 (missing signal)**
```json
{ "error": "Missing signal field" }
```

---

### POST /approve/:id

Send architect approval to a paused pipeline instance.

**Path param:** `id` — pipeline instance ID

**Request body**
```json
{
  "decision": "approved",
  "reason": "Looks good to build.",
  "by": "wes@factory.dev"
}
```

All fields optional. `decision` defaults to `"approved"`. `by` resolved from CF-Access header if absent.

**Event sent to Workflow:**
```json
{
  "type": "architect-approval",
  "payload": {
    "decision": "approved",
    "reason": "Looks good to build.",
    "by": "wes@factory.dev"
  }
}
```

**Response 200**
```json
{ "ok": true }
```

---

### GET /pipeline/:id

Get status of a pipeline instance.

**Response 200** — raw Cloudflare Workflow status object (shape determined by CF SDK)

---

### GET /gate-status/:gate/:id

Get gate status for an artifact.

**Path params:**
- `gate` — gate number (e.g., `1` for coherence)
- `id` — artifact ID

**Response 200** — raw gate status document from D1 `verification_status/gate:{gate}:{id}`

**Response 404** — `{ "error": "Not found" }`

---

### GET /trust/:id

Get trust score for a Function.

**Response 200** — raw trust score document from D1 `trust_scores/trust:{id}`

**Response 404** — `{ "error": "Not found" }`

---

### GET /crps/pending

List pending Consultation Request Packs (ACE inbox).

**Response 200** — `unknown[]` (raw CRP documents where `status = 'pending'`)

---

### GET /mrps/pending

List merge-ready MRPs without resolution (ACE inbox).

**Response 200** — `unknown[]` (raw MRP documents where `verdict = 'merge-ready'` AND `resolution IS NULL`)

---

### GET /mentorscript

List active MentorScript rules.

**Response 200** — `unknown[]` (raw mentor rule documents where `status = 'active'`)

---

## Error Contract

All error responses follow:
```json
{ "error": "<message string>" }
```

| Status | Condition |
|---|---|
| 400 | Missing required field (e.g., signal), malformed request |
| 404 | Route not found or document not found |
| 422 | Coherence verification failed |
| 500 | Unhandled internal error |

---

## Service Binding Contract (QueryService)

`QueryService` is co-deployed as a named entrypoint. When bound via Service Binding (e.g., from another Worker), it exposes:

```typescript
interface QueryBinding {
  getSpec(collection: string, key: string): Promise<unknown>
  listSpecs(collection: string, opts: { limit: number; offset: number }): Promise<{ items: unknown[]; total: number }>
  traceLineage(collection: string, key: string, maxDepth: number): Promise<unknown[]>
  traceImpact(collection: string, key: string, maxDepth: number): Promise<unknown[]>
  getGateStatus(gate: number, id: string): Promise<unknown>
  getTrustScore(id: string): Promise<unknown>
  getSystemHealth(): Promise<unknown>
  listPendingCRPs(): Promise<unknown[]>
  listPendingMRPs(): Promise<unknown[]>
  listMentorRules(): Promise<unknown[]>
}
```

---

## Compatibility

- `compatibility_date`: `2026-01-01`
- `compatibility_flags`: `["nodejs_compat"]`
- ArangoDB secrets (`ARANGO_URL`, `ARANGO_DATABASE`, `ARANGO_JWT`) bound but marked deprecated
