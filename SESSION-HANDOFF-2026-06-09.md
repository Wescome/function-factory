# Session Handoff — 2026-06-09

## What Was Done

### D1 Migration (ArangoDB → Cloudflare D1) — COMPLETE
- `packages/arango-client` renamed to `packages/db-client` (`@factory/db-client`) — ~60 call sites updated
- `ArangoClient` reimplemented as D1/SQLite backend — same public API, no AQL
- D1 database `ff-factory` provisioned (`id: 6a72d5c3-bcbb-41e3-b29d-d8de5834c3b3`)
- Schema applied: `documents(collection, key, json)` + `edges` tables with indexes
- All wrangler.jsonc files wired with real database_id
- All workers deployed: `ff-gates`, `ff-pipeline`, `ff-gateway`
- Smoke test PASSED: `trace_id: 0cf002d2`, dispatch path healthy

### PRs Merged Today
- **#78** — D1 backend + AQL→SQL Q1-Q9 governor queries
- **#79** — Rename `@factory/arango-client` → `@factory/db-client`
- **#80** — D1 schema SQL file + wrangler database_id
- **#81** — Port remaining AQL: autonomy-monitor, formula-compiler-adapter, ontology-loader

---

## What Is BROKEN / Next Up

### 1. `webhook-receiver.ts` — AQL still present (BLOCKING full e2e)

**File:** `workers/ff-pipeline/src/gascity/webhook-receiver.ts:109`

**Error:** Worker crashes with Cloudflare 1101 when webhook fires.

**The AQL query:**
```typescript
const dispatch = await db.queryOne<DispatchLogMatch>(
  `FOR dl IN dispatch_log
     FILTER dl.gc_bead_id == @beadId
     FILTER dl.outcome == "dispatched"
     LIMIT 1
     RETURN dl`,
  { beadId: payload.bead_id },
)
```

**Fix needed — convert to SQL:**
```typescript
const dispatch = await db.queryOne<{ json: string }>(
  `SELECT json FROM documents WHERE collection='dispatch_log'
   AND json_extract(json,'$.gc_bead_id')=?
   AND json_extract(json,'$.outcome')='dispatched'
   LIMIT 1`,
  [payload.bead_id],
).then(row => row ? JSON.parse(row.json) as DispatchLogMatch : null)
```

Also need to **scan the rest of `webhook-receiver.ts`** for any other AQL (there are likely more — check for `FOR`, `FILTER`, `RETURN`, `@bindVar` patterns).

Then update `webhook-receiver.test.ts` mock to match new SQL patterns.

### 2. Run the full Gas City e2e after fix

Once webhook-receiver.ts is fixed:
```bash
OPERATOR_TOKEN="$(cat /tmp/gc_token.txt)" \
GC_BEARER_TOKEN="$(cat /tmp/gc_supervisor_token.txt)" \
GC_HMAC_SECRET="$(cat /tmp/gc_hmac_secret.txt)" \
bash scripts/ops/smoke-test.sh
```

All 5 steps should pass including the webhook bridge.

### 3. Open PRs to review
- **#74** — 4 agent packages + knowing-state-sdk + AtomDirective schema (`feat/agent-infrastructure-packages`)
- **#75** — Linear integration specs (`feat/linear-integration-specs`)

---

## Key Facts for Next Session

- **D1 database:** `ff-factory` id `6a72d5c3-bcbb-41e3-b29d-d8de5834c3b3`, region ENAM
- **D1 schema:** `workers/ff-pipeline/d1-schema.sql` — `documents` + `edges` tables
- **Tokens in /tmp:** `gc_token.txt` (OPERATOR_TOKEN), `gc_supervisor_token.txt` (GC_BEARER_TOKEN), `gc_hmac_secret.txt` (GC_HMAC_SECRET)
- **D1 SQL pattern:** `SELECT json FROM documents WHERE collection=? AND json_extract(json,'$.field')=?` then `JSON.parse(row.json)` — never use `json_each` in subqueries (D1 bug)
- **Tessera CLI:** `/Users/wes/Developer/tessera/tessera/dist/cli/index.js impact <symbol> --repo function-factory` — run before ANY edit

---

## Architectural State

```
Signal → /seed-dispatch-ep → D1(documents)
       → /dispatch-formula → Gas City
Gas City → /webhooks/gascity (BROKEN — AQL in webhook-receiver.ts)
         → marks function dispatched → D1
         → autonomy monitor (cron) → D1
```
