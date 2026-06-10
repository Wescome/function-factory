# Tasks — ff-gateway

> Unit: ff-gateway (Public API Gateway)
> Phase 4 · Writer · Generated 2026-06-10

---

## Implementation Tasks

### T-01: Implement HTTP Router with Route Dispatch
**Source:** `workers/ff-gateway/src/index.ts:36-218`
**Behavior:** Sequential if-chain on (method, pathname). No router framework. Single top-level try/catch returns 500 on unhandled error. Unmatched routes return 404 with `availableRoutes` listing.
**Criterion for done:** All routes in the route table resolve; unmatched route returns 404 with route list; uncaught error returns 500.
**Confidence:** 🟢 CONFIRMADO

### T-02: Implement POST /pipeline (Trigger Workflow)
**Source:** `workers/ff-gateway/src/index.ts:143-160`
**Behavior:**
- Parse JSON body; check `body.signal` present → 400 if absent
- `dryRun = body.dryRun ?? false`
- Call `env.PIPELINE.create({ params: { signal, dryRun } })`
- Return 201 `{ instanceId: instance.id, status: "started", statusUrl: "/pipeline/{id}", approveUrl: "/approve/{id}" }`
**Criterion for done:** Missing signal returns 400; valid signal returns 201 with correct URLs.
**Confidence:** 🟢 CONFIRMADO

### T-03: Implement POST /approve/:id (Architect Approval)
**Source:** `workers/ff-gateway/src/index.ts:162-179`
**Behavior:**
- Resolve architect identity: CF-Access header → body.by → "unknown"
- `decision = body.decision ?? "approved"`
- `env.PIPELINE.get(id).sendEvent({ type: "architect-approval", payload: { decision, reason: body.reason, by } })`
- Return 200 `{ ok: true }`
**Criterion for done:** CF-Access header email used as `by`; body.by used as fallback; missing both uses "unknown".
**Confidence:** 🟢 CONFIRMADO

### T-04: Implement POST /coherence-verification
**Source:** `workers/ff-gateway/src/index.ts:97-102`
**Behavior:**
- Parse body, call `env.GATES.evaluateCoherenceVerification(body)`
- `report.passed=true` → 200; `report.passed=false` → 422
- Same behavior for `POST /gate/1` (legacy alias)
**Criterion for done:** Passing ES returns 200; failing ES returns 422; both return the full CoherenceVerificationReport body.
**Confidence:** 🟢 CONFIRMADO

### T-05: Implement GET /health
**Source:** `workers/ff-gateway/src/query.ts:getSystemHealth()` lines 198-242
**Behavior:**
- `db.ping()` → SELECT 1; if false return `{ status: 'degraded', arango: false, collections: {}, timestamp }`
- Count each SPEC_COLLECTIONS entry
- Count 4 memory tiers (episodic, semantic, working, personal)
- Count lineage_edges
- Return `{ status: 'healthy', arango: true, collections: {...}, timestamp }`
**Criterion for done:** D1 unreachable returns degraded immediately; healthy D1 returns all collection counts.
**Confidence:** 🟢 CONFIRMADO

### T-06: Implement Collection Name Resolution
**Source:** `workers/ff-gateway/src/query.ts:resolveCollection()` lines 45-47
**Behavior:** Two-stage lookup: SPEC_COLLECTIONS map (hyphenated aliases) → NON_SPEC_COLLECTIONS set (verbatim) → fallback: prefix `specs_`.
**Criterion for done:** `"intent-specifications"` → `"intent_specifications"`; `"execution_artifacts"` → `"execution_artifacts"`; `"foo"` → `"specs_foo"`.
**Confidence:** 🟢 CONFIRMADO

### T-07: Implement listSpecs with Pagination
**Source:** `workers/ff-gateway/src/query.ts:listSpecs()` lines 67-87
**Behavior:**
- Default limit=25, offset=0
- Two D1 queries: items (ORDER BY json->>'$.createdAt' DESC, LIMIT+OFFSET) + total COUNT
- Return `{ items: unknown[], total: number }`
**Criterion for done:** `?limit=5&offset=10` returns 5 items starting at position 10; total reflects full collection count.
**Confidence:** 🟢 CONFIRMADO

### T-08: Implement traceLineage (OUTBOUND recursive CTE)
**Source:** `workers/ff-gateway/src/query.ts:traceLineage()` lines 92-134
**Behavior:**
- Build startId: `{collection}/{key}`
- Recursive CTE on D1 `edges` table: OUTBOUND from `from_id=startId`, follow `to_id`, up to maxDepth hops
- Join each visited node ID to `documents` table by splitting `{collection}/{key}` on `/`
- Return LineageNode[] with id, collection, type, title, depth, edgeType
**Criterion for done:** ES with 3-hop forward lineage returns 3 LineageNodes; depth capped at maxDepth.
**Confidence:** 🟢 CONFIRMADO

### T-09: Implement traceImpact (INBOUND recursive CTE)
**Source:** `workers/ff-gateway/src/query.ts:traceImpact()` lines 136-178
**Behavior:** Same as traceLineage but direction reversed: anchor on `e.to_id=startId`, expand via `e.to_id=i.id`. Default depth 5.
**Criterion for done:** Signal with 2 downstream artifacts returns 2 LineageNodes on impact traversal.
**Confidence:** 🟢 CONFIRMADO

### T-10: Implement SDLC Inbox Queries
**Source:** `workers/ff-gateway/src/query.ts:247-278`
**Behavior:**
- `listPendingCRPs()`: D1 query `consultation_requests` WHERE `json->>'$.status' = 'pending'`
- `listPendingMRPs()`: D1 query `merge_readiness_packs` WHERE `json->>'$.verdict' = 'merge-ready'` AND `json->>'$.resolution' IS NULL`
- `listMentorRules()`: D1 query `mentorscript_rules` WHERE `json->>'$.status' = 'active'`
- All return `unknown[]` (raw parsed JSON documents)
**Criterion for done:** Each method returns only matching documents; non-pending CRPs excluded from listPendingCRPs.
**Confidence:** 🟢 CONFIRMADO

### T-11: Implement json() Helper
**Source:** `workers/ff-gateway/src/index.ts:223-231`
**Behavior:** `json(data, status=200)` — serialize with 2-space indent, set `Content-Type: application/json`, `Access-Control-Allow-Origin: *`.
**Criterion for done:** All gateway responses include CORS header and JSON content-type.
**Confidence:** 🟢 CONFIRMADO
