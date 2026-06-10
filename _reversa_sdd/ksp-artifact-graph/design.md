# Design — @factory/artifact-graph

> Module: ksp-artifact-graph | Package: `packages/artifact-graph` | Published: `@factory/artifact-graph`
> doc_level: completo | Generated: 2026-06-10 | Source spec: SPEC-KSP-ARTIFACT-GRAPH-001 v1.0

---

## 1. Package Structure

```
packages/artifact-graph/
├── package.json                    # name: @factory/artifact-graph; workspace dep of factory-graph, ksp-sdk
├── tsconfig.json                   # extends project root; includes @cloudflare/workers-types
├── bindings.ts                     # Env interface + DO namespace export for wrangler
├── wrangler.jsonc                  # new_sqlite_classes: [ArtifactGraphDO]; for local dev only
├── migrations/
│   └── v00_base.ts                 # SQL string export: nodes + edges + schema_history DDL
├── src/
│   ├── types.ts                    # ArtifactNode, ArtifactEdge, LineageChain, PathResult, PathStep, DomainConfig, NodeType, RelType
│   ├── migrate.ts                  # Migration runner: transactionSync on ctx.storage; schema_history tracking
│   ├── queries.ts                  # All 9 query/traversal functions (pure, synchronous, SqlStorage-typed)
│   ├── do.ts                       # ArtifactGraphDOBase<Env> — abstract DO class wrapping queries
│   └── worker.ts                   # Minimal Worker fetch handler for wrangler dev; routes DO stub calls
└── tests/
    └── generic.test.ts             # 3 required test suites: lineage backward, bounded path 3-hop, bi-directional collect
```

### File Responsibilities

| File | Responsibility |
|------|---------------|
| `src/types.ts` | All TypeScript interfaces and type exports. No runtime logic. Contains `CORE_NODE_TYPES`, `CORE_REL_TYPES`, `CoreNodeType`, `CoreRelType`, `NodeType` (=`string`), `RelType` (=`string`). |
| `migrations/v00_base.ts` | Exports a single SQL string constant containing the full DDL for `nodes`, `edges`, `schema_history`, and all 7 indexes. |
| `src/migrate.ts` | Exports `migrate(storage: DurableObjectStorage, migrations: Migration[])`. Uses `transactionSync` to apply each migration not yet recorded in `schema_history`. Exports the `Migration` interface: `{ version: number; name: string; sql: string }`. |
| `src/queries.ts` | 9 exported functions: `upsertNode`, `getNode`, `getNodesByType`, `upsertEdge`, `getEdgesFrom`, `getEdgesTo`, `walkLineageBackward`, `walkLineageForward`, `walkBoundedPath`, `collectLineageIds`. All synchronous. Accept `SqlStorage` as first argument. |
| `src/do.ts` | `ArtifactGraphDOBase<Env>` abstract class. All 10 DO methods (`upsertNode` through `collectLineageIds`) are `async` wrappers around `Q.*` calls. Initializes `this.sql` and runs `migrate()` inside `blockConcurrencyWhile`. |
| `bindings.ts` | Exports `Env` interface with `ARTIFACT_GRAPH: DurableObjectNamespace`. Exports `ArtifactGraphDO` class (a minimal non-abstract subclass used only for wrangler dev). |
| `src/worker.ts` | Exports `default` Worker with a minimal `fetch` handler that routes requests to the `ARTIFACT_GRAPH` DO stub. Used by `wrangler dev` to validate the DO binding. |
| `wrangler.jsonc` | Declares `durable_objects.bindings` and `new_sqlite_classes: ["ArtifactGraphDO"]`. Not used in production (domain instantiations define their own `wrangler.jsonc`). |
| `tests/generic.test.ts` | Vitest tests using Cloudflare test harness. Three required suites: (1) 3-version lineage backward walk, (2) 3-hop bounded path, (3) bi-directional lineage collect from middle node. |

---

## 2. Key Algorithms and Data Flows

### 2.1 `walkLineageBackward` — Recursive Backward CTE

Walks a directed `rel` edge from a starting node toward its root ancestors. Edge direction: child node's `source` → parent node's `target`.

```sql
WITH RECURSIVE lineage(id, depth) AS (
  SELECT ?, 0                        -- seed: startId at depth 0
  UNION ALL
  SELECT e.target, l.depth + 1       -- follow: edge.source → edge.target (child → parent)
  FROM edges e
  JOIN lineage l ON e.source = l.id
  WHERE e.rel = ? AND l.depth < ?    -- bounded by maxDepth (default: 1000)
)
SELECT n.*, l.depth
FROM nodes n
JOIN lineage l ON n.id = l.id
ORDER BY l.depth ASC                 -- start → deepest ancestor
```

Return: `LineageChain { nodes: ArtifactNode[], depth: nodes.length - 1 }`.

The `maxDepth=1000` acts as a cycle guard. SQLite recursive CTEs do not natively detect cycles; this bound prevents infinite expansion.

### 2.2 `walkLineageForward` — Recursive Forward CTE

Walks the same edge type in the reverse direction (root → descendants). Traversal follows `edge.target → edge.source` (inverted, so "forward" in the conceptual lineage maps to backward in the storage direction).

```sql
WITH RECURSIVE successors(id, depth) AS (
  SELECT ?, 0
  UNION ALL
  SELECT e.source, s.depth + 1       -- reversed: follow source of edges whose target is in set
  FROM edges e
  JOIN successors s ON e.target = s.id
  WHERE e.rel = ? AND s.depth < ?
)
SELECT n.*, s.depth
FROM nodes n
JOIN successors s ON n.id = s.id
ORDER BY s.depth ASC
```

Return: same `LineageChain` shape.

### 2.3 `walkBoundedPath` — Dynamic SQL JOIN Builder

The key algorithm in the package. Constructs a variable-length equi-join chain at runtime from a `PathStep[]` input. Called once per query; SQL is built fresh each time (no prepared statement cache needed — each call may have a different step count).

**Algorithm (step-by-step):**

1. Initialize: `params = [startId]`, `joins = []`, `prevAlias = 'n0'`.
2. For each step at index `i` (0-indexed over `steps`):
   - Push `JOIN edges e{i+1} ON e{i+1}.source = {prevAlias}.id AND e{i+1}.rel = ?` to `joins`; push `step.rel` to `params`.
   - If `step.targetType` is present:
     - Push `JOIN nodes n{i+1} ON n{i+1}.id = e{i+1}.target AND n{i+1}.type = ?`; push `step.targetType` to `params`.
   - Else:
     - Push `JOIN nodes n{i+1} ON n{i+1}.id = e{i+1}.target`.
   - Update `prevAlias = 'n{i+1}'`.
3. Build SELECT clause with columns for all `n0..nN` aliased as `n{i}_id`, `n{i}_type`, `n{i}_data`, `n{i}_ns`, `n{i}_created`, `n{i}_updated`; and all `e1..eN` aliased as `e{i}_id`, `e{i}_source`, `e{i}_target`, `e{i}_rel`, `e{i}_props`, `e{i}_created`.
4. Final query form:
   ```sql
   SELECT {nodeSelects}, {edgeSelects}
   FROM nodes n0
   {joins joined with newline}
   WHERE n0.id = ?
   ORDER BY n{N}.created DESC
   ```
   Note: `startId` appears **twice** in `params` — once as the initial anchor when building the join chain (position 0), and once as the final `WHERE n0.id = ?` predicate.
5. Execute with spread params. Map each result row to `PathResult { path: ArtifactNode[], edges: ArtifactEdge[] }` by reconstructing nodes and edges from their aliased column groups.

**Example 3-hop expansion:**
```
steps = [
  { rel: 'governs',   targetType: 'Execution' },
  { rel: 'produces',  targetType: 'ExecutionTrace' },
  { rel: 'evidences', targetType: 'Divergence' },
]
```
Produces:
```sql
SELECT n0.id AS n0_id, ..., n1.id AS n1_id, ..., n2.id AS n2_id, ..., n3.id AS n3_id, ...,
       e1.id AS e1_id, ..., e2.id AS e2_id, ..., e3.id AS e3_id, ...
FROM nodes n0
JOIN edges e1 ON e1.source = n0.id AND e1.rel = 'governs'
JOIN nodes n1 ON n1.id = e1.target AND n1.type = 'Execution'
JOIN edges e2 ON e2.source = n1.id AND e2.rel = 'produces'
JOIN nodes n2 ON n2.id = e2.target AND n2.type = 'ExecutionTrace'
JOIN edges e3 ON e3.source = n2.id AND e3.rel = 'evidences'
JOIN nodes n3 ON n3.id = e3.target AND n3.type = 'Divergence'
WHERE n0.id = ?
ORDER BY n3.created DESC
```

### 2.4 `collectLineageIds` — Bi-directional UNION CTE

Two sibling CTEs run simultaneously: one walks backward (predecessors), one walks forward (successors). Both use `anyNodeInLineage` as seed. The final `UNION` (not `UNION ALL`) deduplicates the full set.

```sql
WITH RECURSIVE
  predecessors(id) AS (
    SELECT ?
    UNION ALL
    SELECT e.target FROM edges e JOIN predecessors p ON e.source = p.id WHERE e.rel = ?
  ),
  successors(id) AS (
    SELECT ?
    UNION ALL
    SELECT e.source FROM edges e JOIN successors s ON e.target = s.id WHERE e.rel = ?
  )
SELECT id FROM predecessors
UNION
SELECT id FROM successors
```

Parameters (in order): `anyNodeInLineage`, `rel`, `anyNodeInLineage`, `rel`.

### 2.5 Migration Pattern

```typescript
interface Migration {
  version: number;   // integer, e.g. 0
  name: string;      // human label, e.g. 'v00_artifact_graph_base'
  sql: string;       // full DDL string to execute
}

function migrate(storage: DurableObjectStorage, migrations: Migration[]): void {
  storage.transactionSync(() => {
    // ensure schema_history exists first
    storage.sql.exec(`CREATE TABLE IF NOT EXISTS schema_history (
      version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied INTEGER NOT NULL
    )`);
    const applied = new Set(
      [...storage.sql.exec('SELECT version FROM schema_history')].map(r => r.version)
    );
    for (const m of migrations) {
      if (!applied.has(m.version)) {
        storage.sql.exec(m.sql);
        storage.sql.exec(
          'INSERT INTO schema_history (version, name, applied) VALUES (?, ?, ?)',
          m.version, m.name, Date.now()
        );
      }
    }
  });
}
```

### 2.6 Edge ID Derivation

Edge IDs are deterministic composites: `` `${source}::${rel}::${target}` ``. This is consistent with the `UNIQUE(source, target, rel)` DDL constraint — the same logical edge always has the same ID regardless of how many times it is written.

---

## 3. Cloudflare Primitives Used

| Primitive | Usage | Why |
|-----------|-------|-----|
| **Durable Objects (SQLite)** | `ArtifactGraphDOBase` extends `DurableObject`; `ctx.storage.sql` is `SqlStorage`. One DO per namespace. | Single-writer serialization guarantee required by INV-AG-006. |
| **`ctx.blockConcurrencyWhile`** | Migration runner is wrapped in `blockConcurrencyWhile` at DO construction. | Guarantees migrations complete before any RPC is dispatched to the DO. |
| **`ctx.storage.transactionSync`** | Used inside `migrate.ts` to atomically apply a migration and write the `schema_history` row. | Prevents partial migration state if the DO is evicted mid-migration. |
| **`SqlStorage.exec`** | Used directly in `queries.ts` for all reads and writes. Returns a `SqlStorageCursor` that is spread into arrays. | Cloudflare DO SQLite API; synchronous within the single-writer model. |
| **`new_sqlite_classes`** | Declared in `wrangler.jsonc` to activate the SQLite backend for the dev DO. | Required to enable `ctx.storage.sql` on a DO class in Cloudflare Workers. |

---

## 4. Integration Points

### 4.1 What This Package Calls

| Dependency | Import | Purpose |
|-----------|--------|---------|
| `cloudflare:workers` | `DurableObject` | Base class for `ArtifactGraphDOBase` |
| `@cloudflare/workers-types` | `SqlStorage`, `DurableObjectState`, `DurableObjectStorage` | Type-only imports |

No other packages are imported. This package has zero internal `@factory/*` dependencies (it is Phase 1 with no upstream factory packages).

### 4.2 What Calls This Package

| Consumer | How | When |
|----------|-----|------|
| `@factory/factory-graph` (Phase 4) | Extends `ArtifactGraphDOBase`; imports `CORE_NODE_TYPES`, `CORE_REL_TYPES`, `PathStep`, `ArtifactNode`, `ArtifactEdge` | `FactoryArtifactGraphDO` is the factory domain instantiation |
| `@factory/ksp-sdk` (Phase 2) | Imports `ArtifactNode`, `ArtifactEdge` types only | Used at the loop-closure boundary (SPEC-KSP-LOOP-CLOSURE-001) |
| `@factory/loop-closure` (Phase 3) | Imports `ArtifactGraphDOBase` stub type for bridge field handling | Cross-layer bridge fields reference artifact graph node IDs |

### 4.3 Domain Instantiation Contract

Domain instantiations must:
1. Declare node types and rel types as extensions: `[...CORE_NODE_TYPES, 'MyDomainType']`
2. Extend `ArtifactGraphDOBase` and call `super(ctx, env, domainConfig, migrations)` in constructor
3. Provide their own `migrations` array starting with `v00_artifact_graph_base`
4. Set `DomainConfig.namespace` as `domain:orgId:scope`
5. Optionally declare `contentHashedTypes` — the instantiation is responsible for computing the hash before calling `upsertNode`

```typescript
// Factory instantiation example (lives in packages/factory-graph, NOT in this package)
import { ArtifactGraphDOBase, CORE_NODE_TYPES, CORE_REL_TYPES } from '@factory/artifact-graph';

const FACTORY_NODE_TYPES = [...CORE_NODE_TYPES, 'WorkGraph', 'FunctionProposal', 'Pressure', 'Capability'] as const;
const FACTORY_REL_TYPES = [...CORE_REL_TYPES, 'compiles_to', 'source_ref'] as const;

export class FactoryArtifactGraphDO extends ArtifactGraphDOBase<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env, {
      namespace: `factory:${ctx.id.toString()}`,
      nodeTypes: FACTORY_NODE_TYPES,
      relTypes: FACTORY_REL_TYPES,
      contentHashedTypes: ['ExecutionTrace', 'ElucidationArtifact'],
    }, factoryMigrations);
  }
  // Domain-specific traversal methods added here
}
```

---

## 5. SQLite Schema

### Table: `nodes`

```sql
CREATE TABLE nodes (
  id        TEXT    PRIMARY KEY,
  type      TEXT    NOT NULL,
  data      TEXT    NOT NULL DEFAULT '{}',   -- JSON-serialized domain payload
  ns        TEXT    NOT NULL,                -- namespace: "domain:org:scope"
  created   INTEGER NOT NULL,               -- Unix ms
  updated   INTEGER NOT NULL                -- Unix ms
);
```

### Table: `edges`

```sql
CREATE TABLE edges (
  id        TEXT    PRIMARY KEY,             -- "${source}::${rel}::${target}"
  source    TEXT    NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  target    TEXT    NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  rel       TEXT    NOT NULL,
  props     TEXT    NOT NULL DEFAULT '{}',   -- JSON-serialized edge metadata
  created   INTEGER NOT NULL,
  UNIQUE(source, target, rel)
);
```

### Table: `schema_history`

```sql
CREATE TABLE schema_history (
  version INTEGER PRIMARY KEY,
  name    TEXT    NOT NULL,
  applied INTEGER NOT NULL                  -- Unix ms when migration was applied
);
```

### Indexes

| Index | Columns | Serves |
|-------|---------|--------|
| `idx_nodes_ns_type` | `(ns, type)` | `getNodesByType` — combined namespace+type filter |
| `idx_nodes_ns_created` | `(ns, created DESC)` | recency listing; ORDER BY `created DESC` |
| `idx_edges_source` | `(source)` | `getEdgesFrom` without rel filter |
| `idx_edges_target` | `(target)` | `getEdgesTo` without rel filter |
| `idx_edges_rel` | `(rel)` | relation-type scans |
| `idx_edges_src_rel` | `(source, rel)` | `getEdgesFrom` with rel filter (hot path) |
| `idx_edges_tgt_rel` | `(target, rel)` | `getEdgesTo` with rel filter (hot path) |

---

## 6. Invariants Enforced by Design

| ID | Invariant | Enforcement Mechanism |
|----|-----------|----------------------|
| INV-AG-001 | Nodes never updated except `data.retired = true`; corrections use `corrects` edge | Behavioral convention; no DDL enforcement. Domain instantiations and callers must comply. |
| INV-AG-002 | Edge uniqueness: `UNIQUE(source, target, rel)` — idempotent writes | DDL `UNIQUE` constraint + `ON CONFLICT DO UPDATE` in `upsertEdge` |
| INV-AG-003 | Namespace isolation: all queries filter by `ns` | Implemented in each `queries.ts` function; DO injects `config.namespace` automatically |
| INV-AG-004 | Referential integrity: `ON DELETE CASCADE` on edges | DDL `REFERENCES nodes(id) ON DELETE CASCADE` |
| INV-AG-005 | Successor Specification's `version_of` edge written in same `transactionSync` | Caller responsibility; the base class does not enforce atomicity at the application level |
| INV-AG-006 | DO is the sole write path | Architecture: Workers call DO RPC methods; no direct `SqlStorage` access from outside the DO |

---

## 7. Design Gaps (Documented from Code Analysis)

| Gap ID | Description | Severity |
|--------|-------------|---------|
| GAP-AG-001 | No retry logic, error wrapping, or typed error classes. SQLite constraint violations surface as raw `sql.exec` exceptions. | 🟡 Medium — caller must handle `null` from `getNode` |
| GAP-AG-002 | No RPC fetch handler is defined in `ArtifactGraphDOBase`. The `worker.ts` entry point is a separate thin wrapper, not part of the base class. | 🟡 Medium — `worker.ts` contract left to implementer |
| GAP-AG-003 | No `canonical_json` helper is defined for content-addressed IDs. Domain instantiations declaring `contentHashedTypes` must implement their own deterministic JSON serialization. | 🔴 Spec gap — no normalization standard specified |
| GAP-AG-004 | `Migration` type and full `migrate.ts` implementation are not explicit in the spec (§9 step 4 defers to implementation). Design above is inferred from the `blockConcurrencyWhile` + `transactionSync` pattern. | 🟡 Inferred |
