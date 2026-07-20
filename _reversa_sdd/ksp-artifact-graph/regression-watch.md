# Regression Watch — @factory/artifact-graph

> Phase: ksp-artifact-graph | Generated: 2026-06-10

---

## Watch Items

| ID | Source File + Section | Expected Rule After Change | Check Type | Violation Signal |
|----|----------------------|---------------------------|------------|-----------------|
| W001 | `src/queries.ts` — `upsertNode`, `upsertEdge` | Nodes and edges are NEVER deleted; `upsertNode` uses `ON CONFLICT DO UPDATE SET data = excluded.data, updated = excluded.updated`; `upsertEdge` uses `ON CONFLICT DO UPDATE SET props = excluded.props`. No DELETE statement in queries.ts. | Static (code grep) | Any `DELETE FROM nodes` or `DELETE FROM edges` in queries.ts; or `ON CONFLICT DO REPLACE` instead of `DO UPDATE` |
| W002 | `src/queries.ts` — `upsertEdge` | Edge ID is deterministic: `` `${source}::${rel}::${target}` ``. `UNIQUE(source, target, rel)` constraint enforced at DDL level (migrations/v00_base.ts). | Static (DDL + code) | Edge ID generation not matching `source::rel::target` pattern; DDL missing UNIQUE constraint |
| W003 | `src/do.ts` — `ArtifactGraphDOBase.upsertNode`, `getNodesByType` | All node queries include `this.config.namespace` injection. `upsertNode` sets `ns = this.config.namespace`. `getNodesByType` filters `WHERE ns = ?`. No query crosses namespace boundaries. | Dynamic (test) | Adding a query that omits `ns` filter; namespace isolation violation in tests |
| W004 | `src/do.ts` — constructor | `migrate()` is called inside `ctx.blockConcurrencyWhile()`. No DO method can run before migrations complete. | Static (code review) | `migrate()` called outside `blockConcurrencyWhile`; or `blockConcurrencyWhile` removed |
| W005 | `src/migrate.ts` — `migrate()` | `storage.transactionSync()` wraps both the schema_history bootstrap and all migration application. Partial migration is impossible. | Static (code review) | `migrate()` body not wrapped in `transactionSync`; or multiple separate transactions instead of one |
| W006 | `src/queries.ts` — `walkBoundedPath` | `params` array starts EMPTY (`params = []`), NOT with `startId` at position 0. `startId` appears ONLY ONCE — as the final `WHERE n0.id = ?` bind value. This deviates from the spec's `params = [startId]` initialization (spec bug: initial startId has no matching `?`). | Dynamic (test) | Test failure in Suite 2 "Bounded Path 3-hop" — `RangeError: Too many parameter values were provided` indicates regression to spec-literal buggy form |
| W007 | `src/queries.ts` — `toEdge()` | `toEdge` falls back to `row['properties']` when `row['props']` is absent: `(row['props'] ?? row['properties'] ?? '{}')`. Required for cross-schema compatibility with legacy edge data. | Static (code grep) | `toEdge` loses the `row['properties']` fallback; breaks domains storing props under legacy column name |
| W008 | `packages/artifact-graph/package.json` — `name` field | Package must be named `@factory/artifact-graph`. Never `@koales/artifact-graph` or `knowing-state-sdk` variants. | Static (package.json check) | `name` field changed to any non-`@factory/` prefix |
| W009 | `src/types.ts` — `CORE_NODE_TYPES` | Exactly 14 core node types. Adding/removing types is a breaking contract change for all domain instantiations. | Static (array length check) | `CORE_NODE_TYPES.length !== 14` |
| W010 | `src/types.ts` — `CORE_REL_TYPES` | Exactly 24 core relation types. Adding/removing types is a breaking contract change. | Static (array length check) | `CORE_REL_TYPES.length !== 24` |
| W011 | `migrations/v00_base.ts` — SQL DDL | `schema_history` table is included in the v00_base SQL string. Migration runner creates it idempotently before checking versions. If `schema_history` is absent from the migration SQL, a brand-new DO will still work (migrate.ts bootstraps it), but the table won't be part of the user-visible schema history. | Dynamic (test) | `schema_history` missing from `v00Base.sql`; or migrate() bootstrap clause removed |
| W012 | `src/do.ts` — `getActiveSpecification` | Declared `abstract`. Every domain instantiation MUST implement this method. If it becomes non-abstract (e.g., returns a default), domain instantiations that forget to override it will silently return wrong data. | Static (code check) | `abstract` keyword removed from `getActiveSpecification` declaration |
