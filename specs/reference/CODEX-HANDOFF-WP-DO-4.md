# Codex Handoff — WP-DO-4: ArtifactClient (ff-pipeline → FactoryStore DO)

Date: 2026-05-31  
Spec: `specs/reference/DO-BEAD-STORE-ARCHITECTURE.md` §8.1, §10 Phase 0  
Status: WP-DO-1/2/3 done. FactoryStore DO live. This WP replaces ArangoDB in ff-pipeline.

---

## Context

ff-pipeline currently calls ArangoDB via `createClientFromEnv(env)` from `@factory/arango-client`
for all artifact reads/writes (formulas, dispatch_log, specs_functions, etc.). ArangoDB is
being retired. The FactoryStore Durable Object (live at gascity-supervisor) has full
`/artifacts/*` CRUD already implemented (`factory-store-do.ts` lines 133-144).

ff-pipeline already has a service binding `GAS_CITY: Fetcher` pointing to gascity-supervisor.
The supervisor proxies `/internal/bead-store/<city>/*` to the FactoryStore DO.

**The path is:** ff-pipeline → `env.GAS_CITY.fetch("/internal/bead-store/factory/artifacts/...")` → supervisor → FactoryStore DO `/artifacts/...`

---

## Step 1 — Read these files first

Before writing any code, read:
- `workers/ff-pipeline/src/compilers/formula-compiler-adapter.ts` — the highest-value migration target; all formula + dispatch_log writes
- `workers/gascity-supervisor/src/factory-store-do.ts` lines 46-144 — understand the exact `/artifacts/*` route contract
- `workers/ff-pipeline/src/types.ts` lines 1-111 — PipelineEnv; confirm `GAS_CITY?: Fetcher` exists
- `workers/ff-pipeline/wrangler.jsonc` lines 1-30 — confirm GAS_CITY service binding exists

---

## Step 2 — Create `workers/ff-pipeline/src/artifact-client.ts`

New file. Implements the ArtifactClient from spec §8.1, wrapping the `GAS_CITY` service binding.

The FactoryStore DO routes (from `factory-store-do.ts`):
- `POST /artifacts/<collection>` — insert doc (body = JSON object with `id` field)
- `GET /artifacts/<collection>?query=<json>` — query by field equality
- `GET /artifacts/<collection>/<id>` — get by id
- `PATCH /artifacts/<collection>/<id>` — patch fields
- `POST /artifacts/lineage` — insert lineage edge
- `GET /artifacts/lineage?from_id=<id>&max_depth=<n>` — walk lineage

ff-pipeline reaches them at `/internal/bead-store/factory/artifacts/...` via `env.GAS_CITY`.

```typescript
// ArtifactClient — wraps FactoryStore DO /artifacts/* via GAS_CITY service binding.
// Replaces @factory/arango-client for all artifact reads/writes.

export class ArtifactClient {
  constructor(private gc: Fetcher) {}

  async insert(collection: string, doc: Record<string, unknown>): Promise<void>
  async get<T>(collection: string, id: string): Promise<T | null>
  async patch(collection: string, id: string, fields: Partial<Record<string, unknown>>): Promise<void>
  async query<T>(collection: string, params: Record<string, unknown>): Promise<T[]>
  async save(collection: string, doc: Record<string, unknown>): Promise<void>  // alias for insert
  async update(collection: string, id: string, fields: Partial<Record<string, unknown>>): Promise<void>  // alias for patch
  async addLineageEdge(edge: Record<string, unknown>): Promise<void>
  async walkLineage(fromId: string, maxDepth?: number): Promise<unknown[]>
}
```

Implementation rules:
- Base URL for all calls: `/internal/bead-store/factory/artifacts`
- `insert` / `save`: `POST /artifacts/<collection>` with JSON body. On 409: rethrow with message containing "409" and the doc `id` — the formula-compiler 409-replay handler depends on this.
- `get`: `GET /artifacts/<collection>/<id>`. Returns null on 404.
- `patch` / `update`: `PATCH /artifacts/<collection>/<id>` with JSON body.
- `query`: `GET /artifacts/<collection>?query=<JSON.stringify(params)>`. Returns array.
- `queryOne`: `GET /artifacts/<collection>?query=<json>`. Returns first result or null.
- All non-2xx responses other than 404 should throw with the response body as message.
- No retries — caller decides retry policy.

Also export a factory function:
```typescript
export function createArtifactClient(env: { GAS_CITY?: Fetcher }): ArtifactClient | null {
  if (!env.GAS_CITY) return null
  return new ArtifactClient(env.GAS_CITY)
}
```

---

## Step 3 — Migrate `formula-compiler-adapter.ts` (highest priority)

File: `workers/ff-pipeline/src/compilers/formula-compiler-adapter.ts`

This file creates `FormulaCompilerDeps` from `(env, db: ArangoClient)`. Replace the `db: ArangoClient` parameter with `db: ArtifactClient`.

Changes:
- Line 1: remove `import type { ArangoClient } from "@factory/arango-client"`
- Add: `import { ArtifactClient } from '../artifact-client'`
- Change function signature: `createFormulaCompilerDeps(env, db: ArtifactClient)`
- `db.query<T>(aql, bindings)` → `db.query<T>(collection, params)` — the ArangoDB client took AQL strings; ArtifactClient takes collection + params object. Map each query:
  - `db.query("FOR vr IN verification_reports ...", {esId})` → `db.query("verification_reports", { es_id: esId })` (filter by field)
  - `db.query("FOR dl IN dispatch_log ...", {epId, attempt, excludeKey})` → `db.query("dispatch_log", { ep_id: epId, factory_attempt: attempt })` + client-side filter for `excludeKey`
  - `db.get("formulas", key)` → `db.get("formulas", key)` (same)
  - `db.save("formulas", form)` → `db.insert("formulas", form)`
  - `db.save("dispatch_log", row)` → `db.insert("dispatch_log", row)`
  - `db.update("formulas", key, patch)` → `db.patch("formulas", key, patch)`
  - `db.update("dispatch_log", key, patch)` → `db.patch("dispatch_log", key, patch)`
  - `db.save("uncertainty_entries", entry)` → `db.insert("uncertainty_entries", entry)`

Also update callers of `createFormulaCompilerDeps` in `index.ts` to pass `createArtifactClient(env)` instead of `createClientFromEnv(env)`.

---

## Step 4 — Migrate `gascity/webhook-receiver.ts`

File: `workers/ff-pipeline/src/gascity/webhook-receiver.ts`

Read the file first. Replace `createClientFromEnv(env)` calls with `createArtifactClient(env)`.
Map ArangoDB operations to ArtifactClient (same pattern as Step 3).

If `createArtifactClient(env)` returns null (GAS_CITY unbound), fall back to ArangoDB client for backward compatibility during rollout — wrap in:
```typescript
const db = createArtifactClient(env) ?? createClientFromEnv(env)
```
This allows staged rollout without hard cutover.

---

## Step 5 — Migrate `gascity/autonomy-monitor.ts`

File: `workers/ff-pipeline/src/gascity/autonomy-monitor.ts`

This file uses AQL queries heavily (`db.query("RETURN { ok: 1 }")`, etc.). Read all query calls.

The autonomy monitor uses AQL `FOR` loops with filters. These must be translated to `db.query(collection, params)` calls. For complex multi-field queries, pass all known filter fields in params and post-filter in TypeScript if needed.

Apply the same fallback pattern as Step 4:
```typescript
const db = createArtifactClient(env) ?? createClientFromEnv(env) as unknown as AutonomyDb
```

---

## Step 6 — Migrate remaining call sites in `index.ts`

File: `workers/ff-pipeline/src/index.ts`

There are ~15 `createClientFromEnv` call sites. For each one:
1. Replace with `createArtifactClient(env)` (or fallback pattern from Step 4)
2. Update the db operations using the same mapping from Step 3

Do NOT migrate test files or `_attic/` files.

---

## Step 7 — Verification: synthetic round-trip (VP-DO-INFRA-001)

After all migrations, add a diagnostic route to verify the DO is reachable and writable:

File: `workers/ff-pipeline/src/index.ts`  
Add: `GET /internal/do-health` (guarded by OPERATOR_CONTROL_TOKEN)

Handler:
1. `createArtifactClient(env)` — if null return 503
2. Insert a synthetic doc: `await client.insert("uncertainty_entries", { id: "SMOKE-DO-HEALTH-" + Date.now(), pass_or_skill: "do-health-check", source_ref: "internal", reason: "smoke", blocking_for: [], suggested_resolution: "", timestamp: new Date().toISOString() })`
3. Read it back: `await client.get("uncertainty_entries", id)`
4. Assert round-trip equality
5. Return `{ ok: true, round_trip: "pass" }`

---

## Step 8 — Typecheck + tests

```bash
cd workers/ff-pipeline
npx tsc --noEmit 2>&1 | grep -E "artifact-client|formula-compiler-adapter|webhook-receiver|autonomy-monitor"
```

All errors in the migrated files must be zero. Pre-existing errors in gdk-agent packages are known and not your responsibility.

Run targeted tests:
```bash
npx vitest run src/compilers/formula-compiler.test.ts
npx vitest run src/gascity/webhook-receiver.test.ts
npx vitest run src/gascity/autonomy-monitor.test.ts
```

---

## Step 9 — Deploy + smoke test

```bash
cd workers/ff-pipeline && npx wrangler deploy
```

Then verify round-trip:
```bash
curl -sf -H "Authorization: Bearer $OPERATOR_TOKEN" \
  https://ff-pipeline.koales.workers.dev/internal/do-health | jq .
```

Expected: `{ "ok": true, "round_trip": "pass" }`

---

## What NOT to change

- Do NOT touch `@factory/arango-client` package itself
- Do NOT migrate test files or `_attic/` / `_archive/` directories
- Do NOT remove ArangoDB env vars from `wrangler.jsonc` or `types.ts` — keep them for the fallback path during staged rollout
- Do NOT change the FactoryStore DO (`factory-store-do.ts`) — it is already correct
- Do NOT change `formula-compiler.ts` — only the adapter changes

---

## Commit message

```
INFRA: WP-DO-4 ArtifactClient — ff-pipeline artifact reads/writes via FactoryStore DO
```
