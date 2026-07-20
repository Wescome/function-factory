# Tasks — @factory/artifact-graph

> Module: ksp-artifact-graph | Package: `packages/artifact-graph` | Published: `@factory/artifact-graph`
> doc_level: completo | Generated: 2026-06-10 | Source spec: SPEC-KSP-ARTIFACT-GRAPH-001 v1.0

All tasks must be executed in order. Each gate must pass with zero errors before proceeding to the next task.

---

## Task 1 — Package Scaffold

**File(s):** `packages/artifact-graph/package.json`, `packages/artifact-graph/tsconfig.json`

**What to implement:**

`package.json`:
```json
{
  "name": "@factory/artifact-graph",
  "version": "0.1.0",
  "private": true,
  "main": "src/do.ts",
  "types": "src/types.ts",
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.0.0",
    "typescript": "^5.0.0"
  }
}
```

`tsconfig.json`:
- Extends the monorepo root tsconfig
- Includes `@cloudflare/workers-types` in `types`
- `"moduleResolution": "bundler"` (or `"node16"`)
- `"strict": true`
- Includes `src/**/*.ts`, `migrations/**/*.ts`, `bindings.ts`, `tests/**/*.ts`

**Gate:** `pnpm install` completes without errors; `packages/artifact-graph` appears in `pnpm list`. [X]

**Confidence:** 🟢

---

## Task 2 — Core Types

**File:** `packages/artifact-graph/src/types.ts`

**What to implement:**
- `CORE_NODE_TYPES` as `const` array of 14 type strings
- `CORE_REL_TYPES` as `const` array of 24 relation strings
- `CoreNodeType = typeof CORE_NODE_TYPES[number]`
- `CoreRelType = typeof CORE_REL_TYPES[number]`
- `NodeType = string` (open — domain instantiations extend by declaring their own string literals)
- `RelType = string`
- `ArtifactNode` interface: `{ id: string; type: NodeType; data: Record<string, unknown>; ns: string; created: number; updated: number; }`
- `ArtifactEdge` interface: `{ id: string; source: string; target: string; rel: RelType; props: Record<string, unknown>; created: number; }`
- `LineageChain` interface: `{ nodes: ArtifactNode[]; depth: number; }`
- `PathResult` interface: `{ path: ArtifactNode[]; edges: ArtifactEdge[]; }`
- `PathStep` interface: `{ rel: RelType; targetType?: string; }`
- `DomainConfig` interface: `{ namespace: string; nodeTypes: readonly string[]; relTypes: readonly string[]; contentHashedTypes?: readonly string[]; }`

**Gate:** `tsc --noEmit` — zero errors.

**Done criterion:** All interfaces and constants exported cleanly with no TypeScript errors. [X]

**Confidence:** 🟢

---

## Task 3 — Base Migration DDL

**File:** `packages/artifact-graph/migrations/v00_base.ts`

**What to implement:**

Export a single `Migration` value (typed once `migrate.ts` is written) or a plain object:

```typescript
export const v00Base = {
  version: 0,
  name: 'v00_artifact_graph_base',
  sql: `
    CREATE TABLE nodes (
      id      TEXT    PRIMARY KEY,
      type    TEXT    NOT NULL,
      data    TEXT    NOT NULL DEFAULT '{}',
      ns      TEXT    NOT NULL,
      created INTEGER NOT NULL,
      updated INTEGER NOT NULL
    );

    CREATE TABLE edges (
      id      TEXT    PRIMARY KEY,
      source  TEXT    NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
      target  TEXT    NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
      rel     TEXT    NOT NULL,
      props   TEXT    NOT NULL DEFAULT '{}',
      created INTEGER NOT NULL,
      UNIQUE(source, target, rel)
    );

    CREATE TABLE schema_history (
      version INTEGER PRIMARY KEY,
      name    TEXT    NOT NULL,
      applied INTEGER NOT NULL
    );

    CREATE INDEX idx_nodes_ns_type    ON nodes(ns, type);
    CREATE INDEX idx_nodes_ns_created ON nodes(ns, created DESC);
    CREATE INDEX idx_edges_source     ON edges(source);
    CREATE INDEX idx_edges_target     ON edges(target);
    CREATE INDEX idx_edges_rel        ON edges(rel);
    CREATE INDEX idx_edges_src_rel    ON edges(source, rel);
    CREATE INDEX idx_edges_tgt_rel    ON edges(target, rel);
  `,
};
```

**Gate:** Syntax check — file parses as valid TypeScript without errors (`tsc --noEmit`).

**Done criterion:** `v00Base` is importable and the SQL string matches the spec §5.1 DDL exactly. [X]

**Confidence:** 🟢

---

## Task 4 — Migration Runner

**File:** `packages/artifact-graph/src/migrate.ts`

**What to implement:**
- `Migration` interface: `{ version: number; name: string; sql: string; }`
- `migrate(storage: DurableObjectStorage, migrations: Migration[]): void`
  - Calls `storage.transactionSync(() => { ... })`
  - Inside the transaction: ensures `schema_history` exists (`CREATE TABLE IF NOT EXISTS`), reads applied versions, iterates `migrations`, executes SQL for any unapplied version, inserts row into `schema_history`
- Each migration's SQL may contain multiple statements separated by `;`. Split and execute each, or rely on `sql.exec` supporting multi-statement strings (verify per CF API behavior; if not: split on `;` and exec each non-empty statement).

**Gate:** `tsc --noEmit` — zero errors.

**Done criterion:** `migrate.ts` compiles clean. `Migration` type is exportable and importable by `do.ts`. [X]

**Confidence:** 🟡 (implementation shape inferred; CF `sql.exec` multi-statement behavior not confirmed in spec)

---

## Task 5 — Query Functions (one at a time)

**File:** `packages/artifact-graph/src/queries.ts`

Implement each function, then run `tsc --noEmit` after EACH before writing the next.

**Function 1 — `upsertNode`**
- Signature: `(sql: SqlStorage, id: string, type: string, ns: string, data: Record<string, unknown>): ArtifactNode`
- Body: `INSERT INTO nodes ... ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated = excluded.updated RETURNING *`
- Gate: `tsc --noEmit`

**Function 2 — `getNode`**
- Signature: `(sql: SqlStorage, id: string): ArtifactNode | null`
- Body: `SELECT * FROM nodes WHERE id = ?`; return `toNode(rows[0])` or `null`
- Gate: `tsc --noEmit`

**Function 3 — `getNodesByType`**
- Signature: `(sql: SqlStorage, ns: string, type: string, limit?: number, offset?: number): ArtifactNode[]`
- Defaults: `limit=100, offset=0`
- Body: `SELECT * FROM nodes WHERE ns = ? AND type = ? ORDER BY created DESC LIMIT ? OFFSET ?`
- Gate: `tsc --noEmit`

**Function 4 — `upsertEdge`**
- Signature: `(sql: SqlStorage, source: string, target: string, rel: RelType, props?: Record<string, unknown>): ArtifactEdge`
- Edge ID: `` `${source}::${rel}::${target}` ``
- Body: `INSERT INTO edges (id, source, target, rel, props, created) VALUES (?,?,?,?,?,?) ON CONFLICT(source,target,rel) DO UPDATE SET props = excluded.props RETURNING *`
- Gate: `tsc --noEmit`

**Function 5 — `getEdgesFrom`**
- Signature: `(sql: SqlStorage, source: string, rel?: RelType): ArtifactEdge[]`
- Body: filter by `source`; optionally add `AND rel = ?`
- Gate: `tsc --noEmit`

**Function 6 — `getEdgesTo`**
- Signature: `(sql: SqlStorage, target: string, rel?: RelType): ArtifactEdge[]`
- Body: filter by `target`; optionally add `AND rel = ?`
- Gate: `tsc --noEmit`

**Function 7 — `walkLineageBackward`**
- Signature: `(sql: SqlStorage, startId: string, rel: RelType, maxDepth?: number): LineageChain`
- Body: `WITH RECURSIVE lineage(id, depth) AS (...)` CTE — see design.md §2.1
- Gate: `tsc --noEmit`

**Function 8 — `walkLineageForward`**
- Signature: `(sql: SqlStorage, startId: string, rel: RelType, maxDepth?: number): LineageChain`
- Body: `WITH RECURSIVE successors(id, depth) AS (...)` CTE — see design.md §2.1
- Gate: `tsc --noEmit`

**Function 9 — `walkBoundedPath`**
- Signature: `(sql: SqlStorage, startId: string, steps: PathStep[]): PathResult[]`
- Body: dynamic JOIN builder — see design.md §2.3 for full algorithm and note that `startId` appears in `params` **twice** (position 0 and final WHERE clause position)
- Gate: `tsc --noEmit`

**Function 10 — `collectLineageIds`**
- Signature: `(sql: SqlStorage, anyNodeInLineage: string, rel: RelType): string[]`
- Body: two-CTE UNION query — see design.md §2.4
- Gate: `tsc --noEmit`

**Also implement:** private `toNode(row)` and `toEdge(row)` helper functions. `toEdge` must handle both `row.props` and `row.properties` (fallback to `'{}'`) per spec §6.2.

**Confidence:** 🟢 (all function bodies explicit in spec §6.2) [X]

---

## Task 6 — DO Base Class

**File:** `packages/artifact-graph/src/do.ts`

**What to implement:**
- Import `DurableObject` from `cloudflare:workers`
- Import `migrate`, `Migration` from `./migrate`
- Import `* as Q` from `./queries`
- Import all types from `./types`
- `export abstract class ArtifactGraphDOBase<Env> extends DurableObject<Env>`
  - Protected fields: `sql: SqlStorage`, `config: DomainConfig`
  - Constructor: `(ctx: DurableObjectState, env: Env, config: DomainConfig, migrations: Migration[])`
    - Calls `super(ctx, env)`
    - Sets `this.sql = ctx.storage.sql`
    - Sets `this.config = config`
    - Calls `this.ctx.blockConcurrencyWhile(async () => { migrate(ctx.storage, migrations); })`
  - All 10 async DO methods delegating to `Q.*` — each injects `this.sql` and `this.config.namespace` where needed
  - **Abstract method** (Q-12 resolution): `abstract getActiveSpecification(ns: string, domain: string): Promise<string>`
    - Declared here, implemented by each domain instantiation (e.g. `FactoryArtifactGraphDO` in `packages/factory-graph`)
    - Contract: returns the node ID of the head `Specification` for the given namespace + domain
    - `LoopClosureService.openSession()` calls this via the DO stub — base class enforces the contract, domain provides the query

**Gate:** `tsc --noEmit` — zero errors.

**Done criterion:** `ArtifactGraphDOBase` is importable from `@factory/artifact-graph`; all 10 methods + abstract `getActiveSpecification` compile clean. [X]

**Confidence:** 🟢

---

## Task 7 — Worker Entry Point and Bindings

**Files:** `packages/artifact-graph/bindings.ts`, `packages/artifact-graph/src/worker.ts`

**What to implement:**

`bindings.ts`:
```typescript
import { ArtifactGraphDOBase } from './src/do';
import type { DomainConfig } from './src/types';
import { v00Base } from './migrations/v00_base';
import type { Migration } from './src/migrate';

// Minimal concrete subclass for wrangler dev only — not for production use
export class ArtifactGraphDO extends ArtifactGraphDOBase<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env, {
      namespace: 'dev:local:generic',
      nodeTypes: [],
      relTypes: [],
    }, [v00Base]);
  }
}

export interface Env {
  ARTIFACT_GRAPH: DurableObjectNamespace<ArtifactGraphDO>;
}
```

`src/worker.ts`:
- Exports `default` Worker with a `fetch` handler
- Handler: routes all requests to the `ARTIFACT_GRAPH` DO stub
- Minimal — used only to validate that `wrangler dev` can instantiate the DO

**Gate:** `tsc --noEmit` — zero errors.

**Done criterion:** Both files compile clean. No test logic in `worker.ts`. [X]

**Confidence:** 🟡 (minimal contract; worker.ts body not defined in spec)

---

## Task 8 — Wrangler Configuration

**File:** `packages/artifact-graph/wrangler.jsonc`

**What to implement:**
```jsonc
{
  "name": "artifact-graph-dev",
  "main": "src/worker.ts",
  "compatibility_date": "2024-09-23",
  "durable_objects": {
    "bindings": [
      {
        "name": "ARTIFACT_GRAPH",
        "class_name": "ArtifactGraphDO"
      }
    ]
  },
  "migrations": [
    {
      "tag": "v1",
      "new_sqlite_classes": ["ArtifactGraphDO"]
    }
  ]
}
```

**Gate:** `wrangler dev` starts without error — DO appears in the local dev dashboard; no `new_sqlite_classes` configuration errors.

**Done criterion:** `wrangler dev` runs to "Ready" state. Sending a request to the dev endpoint receives a response (even an empty 404 is acceptable — the goal is DO instantiation without error).

**Confidence:** 🟢

---

## Task 9 — Generic Test Suite

**File:** `packages/artifact-graph/tests/generic.test.ts`

**What to implement:**

Three required test suites using Cloudflare test harness (`vitest` + `@cloudflare/vitest-pool-workers`):

**Suite 1 — Lineage Walk (3-version chain)**
- Setup: upsert nodes `spec-v1`, `spec-v2`, `spec-v3`; create edges `spec-v3 -[version_of]→ spec-v2`, `spec-v2 -[version_of]→ spec-v1`
- Test `walkLineageBackward('spec-v3', 'version_of')`:
  - Assert `result.nodes.length === 3`
  - Assert `result.nodes[0].id === 'spec-v3'`
  - Assert `result.nodes[2].id === 'spec-v1'`
  - Assert `result.depth === 2`
- Test `walkLineageForward('spec-v1', 'version_of')`:
  - Assert `result.nodes.length === 3`
  - Assert first node is `spec-v1`

**Suite 2 — Bounded Path 3-hop**
- Setup: nodes `spec`, `exec`, `trace`, `div` with corresponding edges: `spec -[governs]→ exec`, `exec -[produces]→ trace`, `trace -[evidences]→ div`
- Test `walkBoundedPath('spec', [{ rel:'governs', targetType:'Execution' }, { rel:'produces', targetType:'ExecutionTrace' }, { rel:'evidences', targetType:'Divergence' }])`:
  - Assert `result.length === 1`
  - Assert `result[0].path.length === 4`
  - Assert `result[0].edges.length === 3`
  - Assert `result[0].path[3].id === 'div'`
- Test with non-matching targetType: assert result is `[]`

**Suite 3 — Bi-directional Lineage Collect**
- Setup: 4-node chain `v1 → v2 → v3 → v4` with `version_of` edges
- Test `collectLineageIds('v2', 'version_of')` (starting from middle):
  - Assert returned array contains all 4 IDs
  - Assert no duplicates (`new Set(result).size === result.length`)
- Test `collectLineageIds('v1', 'version_of')` (starting from end):
  - Assert returned array contains all 4 IDs

**Gate:** All tests pass — zero failures, zero errors.

**Done criterion:** `pnpm test` (or `vitest run`) exits with code 0 for all three suites. [X]

**Confidence:** 🟢 (test shapes explicit in spec §9 step 9)
