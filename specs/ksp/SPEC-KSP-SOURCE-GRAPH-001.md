# SPEC-KSP-SOURCE-GRAPH-001
## CF-Native Source Graph — Cloudflare-Resident Code Intelligence Layer

**Version**: 1.1
**Status**: Draft
**Author**: Wislet J. Celestin / Koales.ai
**Executor**: pi-coding-agent
**Stack**: Cloudflare Workers + Durable Objects + D1 + Vectorize + Workflows + TypeScript
**Depends on**: SPEC-KSP-ARTIFACT-GRAPH-001, SPEC-KSP-LOOP-CLOSURE-001
**Upstream**: Tessera graph engine (`tessera-shared`, `domain-adapter.ts`, `schema-constants.ts`, `graph/types.ts`)
**Also amends**: `tessera-shared` schema constants (§8) and management adapter (§9)

---

## 1. Purpose

This spec defines the Cloudflare-native runtime of the Tessera code intelligence graph. It replaces LadybugDB (KuzuDB — native binary, cannot run in Workers, ≥128 MB at scale) with a CF-native storage stack: D1 for nodes and relationships, Vectorize for embeddings, a Durable Object for query serving, and a CF Workflow for the analysis pipeline.

The Source Graph answers:
- What symbols exist in the codebase and how do they relate? (`context`)
- What breaks if I change X? (`impact`)
- What code/capability/initiative is relevant to this concept? (`query` — BM25 + vector hybrid)
- What execution flows does this symbol participate in? (process resources)
- What Specifications and Elucidations govern this code? (Bridge Point 6 from Loop Closure)
- What capabilities does this initiative decompose into? (SR business layer)

It is the **single queryable intelligence layer** spanning code symbols, SR strategic objects (capability, initiative, decision, thesis), and KSP artifacts (Specification, Elucidation, Signal, Pressure) — all in the same graph, all queryable with the same tools.

---

## 2. Design Constraints

**No native binaries in Workers.** KuzuDB cannot run in a CF Worker. The in-memory `KnowledgeGraph` (`tessera-shared/src/core/graph/graph.ts`) is pure JS Maps — it runs unchanged inside the Workflow. Only the persistence layer changes.

**128 MB D1 limit per database.** function-factory: ~23k symbols + ~31k relationships. Graph data without embeddings: ~20 MB. Embeddings (384-dim floats × 23k nodes): ~35 MB. Total comfortably under 128 MB. Embeddings go in Vectorize by default regardless — D1 holds only nodes and relationships.

**Same DomainAdapter interface, properly typed.** All existing Tessera adapters (`code`, `management`, `reversa`) feed the same `KnowledgeGraph` in memory. The Source Graph replaces only the persistence layer. However, the management adapter currently uses free-form kind/type strings as a workaround for missing schema types — this spec mandates the schema fix (§8) and adapter update (§9) so all SR objects are first-class typed citizens.

**Analysis runs in a CF Workflow.** The pipeline is CPU-intensive and long-running. CF Workflows have no per-request CPU limit and support step checkpointing. Each of the 12 analysis phases is one `step.do()` call.

**Queries served by a DO.** `SourceGraphDO` loads D1 + Vectorize and serves `query`, `context`, `impact`, `clusters`, `processes` over HTTP. One DO per repo namespace.

---

## 3. Storage Schema

### 3.1 D1 — Nodes and Relationships

```sql
-- All node types from NODE_TABLES (schema-constants.ts) + management adapter kinds
CREATE TABLE IF NOT EXISTS sg_nodes (
  id          TEXT    PRIMARY KEY,
  label       TEXT    NOT NULL,    -- NodeTableName (schema-constants.ts)
  name        TEXT    NOT NULL,
  file_path   TEXT    NOT NULL,
  start_line  INTEGER,
  end_line    INTEGER,
  language    TEXT,
  properties  TEXT    NOT NULL,    -- JSON: NodeProperties
  repo        TEXT    NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sg_nodes_label  ON sg_nodes(repo, label);
CREATE INDEX IF NOT EXISTS idx_sg_nodes_file   ON sg_nodes(repo, file_path);
CREATE INDEX IF NOT EXISTS idx_sg_nodes_name   ON sg_nodes(repo, name);

-- All relationship types from REL_TYPES (schema-constants.ts)
CREATE TABLE IF NOT EXISTS sg_relationships (
  id          TEXT    PRIMARY KEY,
  source_id   TEXT    NOT NULL REFERENCES sg_nodes(id),
  target_id   TEXT    NOT NULL REFERENCES sg_nodes(id),
  type        TEXT    NOT NULL,    -- RelType (schema-constants.ts)
  confidence  REAL,
  properties  TEXT,               -- JSON
  repo        TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sg_rel_source ON sg_relationships(repo, source_id);
CREATE INDEX IF NOT EXISTS idx_sg_rel_target ON sg_relationships(repo, target_id);
CREATE INDEX IF NOT EXISTS idx_sg_rel_type   ON sg_relationships(repo, type);

-- FTS5 for BM25 text search
CREATE VIRTUAL TABLE IF NOT EXISTS sg_nodes_fts USING fts5(
  id UNINDEXED, name, label UNINDEXED, file_path UNINDEXED, properties,
  content=sg_nodes, content_rowid=rowid
);

-- Per-repo index metadata
CREATE TABLE IF NOT EXISTS sg_index_meta (
  repo        TEXT    PRIMARY KEY,
  last_commit TEXT    NOT NULL,
  indexed_at  INTEGER NOT NULL,
  node_count  INTEGER NOT NULL,
  rel_count   INTEGER NOT NULL
);
```

### 3.2 Vectorize — Embeddings

One Vectorize index per environment. Each vector:
- `id`: node ID (matches `sg_nodes.id`)
- `values`: 384-dim float32 (snowflake-arctic-embed-xs, same as LadybugDB)
- `metadata`: `{ repo, label, name, filePath }`

Hybrid query: D1 FTS5 BM25 + Vectorize cosine similarity, merged via Reciprocal Rank Fusion. Same weights as the existing Tessera `query` implementation.

---

## 4. Analysis Pipeline (CF Workflow)

`SourceGraphAnalysisWorkflow` — triggered on push or manual request.

```typescript
export class SourceGraphAnalysisWorkflow
  extends WorkflowEntrypoint<Env, { repo: string; commitSha: string }> {

  async run(event, step) {
    const files = await step.do('fetch-source',
      () => fetchRepoFiles(event.payload.repo, env.R2))

    // 12-phase pipeline — same phases as tessera analyze
    // KnowledgeGraph is pure JS Maps, runs unchanged in Worker
    const graph = await step.do('build-graph',
      () => runPipelineFromFiles(files, [
        new CodeAdapter(),        // existing — symbols, calls, imports
        new ManagementAdapter(),  // existing — SR capabilities, initiatives, decisions
        new ReversaAdapter(),     // existing — Specification, Elucidation nodes
      ]))

    await step.do('persist-nodes', () => d1Adapter.flushNodes(graph, env.SOURCE_GRAPH_DB))
    await step.do('persist-rels',  () => d1Adapter.flushRelationships(graph, env.SOURCE_GRAPH_DB))
    await step.do('embed',         () => vectorizeAdapter.embedAll(graph.nodes, env.VECTORIZE))
    await step.do('meta',          () => d1Adapter.updateMeta(
      event.payload.repo, event.payload.commitSha, graph, env.SOURCE_GRAPH_DB))
  }
}
```

---

## 5. D1 Adapter

`D1Adapter` replaces `lbug-adapter.ts`. Same logical interface, D1-backed.

```typescript
export interface SourceGraphAdapter {
  flushNodes(graph: KnowledgeGraph, db: D1Database): Promise<void>
  flushRelationships(graph: KnowledgeGraph, db: D1Database): Promise<void>
  updateMeta(repo: string, commit: string, graph: KnowledgeGraph, db: D1Database): Promise<void>

  queryHybrid(query: string, repo: string, db: D1Database, vec: VectorizeIndex): Promise<QueryResult[]>
  getContext(nodeId: string, repo: string, db: D1Database): Promise<ContextResult>
  getImpact(nodeId: string, direction: 'upstream' | 'downstream', repo: string, db: D1Database): Promise<ImpactResult>
  getClusters(repo: string, db: D1Database): Promise<ClusterResult[]>
  getProcesses(repo: string, db: D1Database): Promise<ProcessResult[]>
}
```

**`flushNodes`** — `INSERT OR REPLACE INTO sg_nodes` for each node. On re-analysis, nodes for changed files are replaced (not accumulated).

**`flushRelationships`** — Delete all relationships whose `source_id` belongs to changed files, then insert new ones. Uses `sg_relationships` table.

**`queryHybrid`**:
1. FTS5: `SELECT id, rank FROM sg_nodes_fts WHERE sg_nodes_fts MATCH ? ORDER BY rank LIMIT 20`
2. Vectorize: `env.VECTORIZE.query(embedding, { topK: 20, filter: { repo } })`
3. RRF merge: `score = 1/(k + rank_bm25) + 1/(k + rank_vector)`, k=60

**`getImpact`** — recursive CTE over `sg_relationships`:
```sql
WITH RECURSIVE impact(id, depth) AS (
  SELECT source_id, 1 FROM sg_relationships WHERE target_id = ? AND repo = ?
  UNION ALL
  SELECT r.source_id, i.depth + 1
  FROM sg_relationships r JOIN impact i ON r.target_id = i.id
  WHERE i.depth < 5
)
SELECT DISTINCT sg_nodes.* FROM sg_nodes JOIN impact ON sg_nodes.id = impact.id
```

---

## 6. SourceGraphDO — Query Serving

One DO per repo namespace.

```
POST /query     → queryHybrid(body.q, repo, db, vectorize)
POST /context   → getContext(body.nodeId, repo, db)
POST /impact    → getImpact(body.nodeId, body.direction, repo, db)
GET  /clusters  → getClusters(repo, db)
GET  /processes → getProcesses(repo, db)
GET  /meta      → index metadata + staleness check (last_commit vs current HEAD)
POST /ingest    → upsert nodes from Bridge Point 6 (Loop Closure)
```

The Loop Closure Service calls `POST /ingest` at Bridge Point 6 when an amendment is adopted. Reversa agents call `POST /query`, `POST /context`, `POST /impact` the same way they call Tessera MCP tools today.

---

## 7. Bridge Point 6 — Amendment Adoption Ingestion

When `LoopClosureService.adoptAmendment()` completes Bridge Point 5, the optional `ingestSpecification` injectable calls `SourceGraphDO POST /ingest` to upsert the new `Specification` and `ElucidationArtifact` nodes without waiting for the next full analysis run.

```typescript
// Factory wiring in LoopClosureService config:
ingestSpecification: async (specId, eaId, artifactGraph) => {
  const spec = await artifactGraph.getNode(specId)
  const ea   = await artifactGraph.getNode(eaId)
  await sourceGraphDO.fetch('/ingest', {
    method: 'POST',
    body: JSON.stringify({ nodes: [spec, ea], repo: 'function-factory' }),
  })
}
```

---

## 8. tessera-shared Schema Updates (Prerequisite)

Both `tessera-shared/src/lbug/schema-constants.ts` and `tessera-shared/src/graph/types.ts` must be updated before any other step. These are the canonical single source of truth — the management adapter's free-form strings exist only because these were never updated.

### 8.1 NODE_TABLES / NodeLabel — add SR deliberation object types

```typescript
// schema-constants.ts NODE_TABLES additions:
'Capability',    // abstract ability required to address a Pressure or decompose an Initiative
'Initiative',    // concrete action / project / step
'Decision',      // chosen option with rationale
'Thesis',        // strategic claim or objective
'Assumption',    // unvalidated premise
'Constraint',    // hard boundary on solution space
'Option',        // candidate approach under consideration
'Risk',          // threat to a thesis or initiative
'Metric',        // measurable success indicator
'Stakeholder',   // agent with goals and interests
'Dependency',    // external prerequisite
'Tradeoff',      // tension between two options or capabilities
'Evidence',      // supporting or contradicting data point
```

Same additions to `graph/types.ts` `NodeLabel` union.

### 8.2 REL_TYPES / RelationshipType — add SR connection types

```typescript
// schema-constants.ts REL_TYPES additions:
'SUPPORTS',         // thesis/evidence supports claim
'CONTRADICTS',      // evidence contradicts claim
'CONSTRAINS',       // constraint limits capability/initiative
'ELIMINATES',       // decision eliminates option
'THREATENS',        // risk threatens thesis/initiative
'VALIDATES',        // metric/evidence validates thesis/initiative
'DEPENDS_ON',       // initiative/capability depends on another
'TRADEOFF_WITH',    // option is in tension with another
'OWNS',             // stakeholder owns initiative/decision/capability
'MEASURES',         // metric measures thesis/initiative
'DECOMPOSES_INTO',  // initiative decomposes into capability
'DECORATED_BY',     // used by Decorator node type
```

Same additions to `graph/types.ts` `RelationshipType` union.

---

## 9. Management Adapter Update (Prerequisite)

After §8 is merged, update `tessera/src/adapters/management/management-adapter.ts` to use proper `NodeTableName` and `RelType` values instead of free-form strings. The normalization logic and extraction logic stay unchanged — only the output `kind` and `type` fields change to match the constants.

Key changes:
- `kind: 'capability'` → `kind: 'Capability'`
- `kind: 'initiative'` → `kind: 'Initiative'`
- `kind: 'decision'` → `kind: 'Decision'`
- `kind: 'thesis'` → `kind: 'Thesis'`
- `type: 'supports'` → `type: 'SUPPORTS'`
- `type: 'constrains'` → `type: 'CONSTRAINS'`
- etc. (full mapping follows from §8)

---

## 10. Invariants

**INV-SG-001 — Single analysis Workflow per repo at a time.** Workflow ID: `source-graph-{repo}-{commitSha}`. CF Workflow dedup makes duplicate triggers idempotent.

**INV-SG-002 — Stale detection.** `GET /meta` returns `{ stale: true, lastCommit, currentHead }` when the index is behind HEAD. Consumers surface the warning.

**INV-SG-003 — D1 is replace-on-reanalysis.** `INSERT OR REPLACE` for nodes. Changed-file relationships are deleted and re-inserted. The graph does not accumulate stale nodes.

**INV-SG-004 — Vectorize is eventually consistent with D1.** The embed step follows the persist step in the Workflow. Between steps, FTS queries are current but vector queries may be one step behind. Resolved within the same Workflow run.

**INV-SG-005 — NODE_TABLES drives D1 schema.** The `sg_nodes.label` values are constrained to `NODE_TABLES` from `schema-constants.ts`. Any node whose label is not in `NODE_TABLES` is rejected at ingest time. This enforces schema-constants.ts as the single source of truth for node types.

---

## 11. Implementation Ordering

Execute strictly in order. Typecheck after each step.

1. **Update `tessera-shared/src/lbug/schema-constants.ts`** — add all SR node types to `NODE_TABLES` and SR relation types to `REL_TYPES` (§8).
2. **Update `tessera-shared/src/graph/types.ts`** — add same types to `NodeLabel` and `RelationshipType` unions.
3. **Update management adapter** — replace free-form kind/type strings with proper `NodeTableName`/`RelType` values (§9). Typecheck passes.
4. Write D1 schema (`sg_nodes`, `sg_relationships`, `sg_nodes_fts`, `sg_index_meta`).
5. Write `D1Adapter` — flush methods first, then query methods (queryHybrid, getContext, getImpact, getClusters, getProcesses).
6. Write `SourceGraphDO` — 7 HTTP endpoints, wire D1Adapter + Vectorize.
7. Write `SourceGraphAnalysisWorkflow` — 12-phase pipeline, wire all three adapters.
8. Wire `ingestSpecification` injectable into `LoopClosureService` (Bridge Point 6, §7).
9. Tests:
   - Full pipeline: analyze function-factory → node count matches tessera CLI output (±5%)
   - SR types: analyze SR workspace → `Capability` nodes appear in D1 with correct label
   - Hybrid query: `queryHybrid('queue handler')` → `queue-handler.ts` symbols in top 5
   - Business layer: `queryHybrid('signal ingestion capability')` → Capability node in results
   - Impact: `getImpact('queue#3', 'upstream')` → LOW risk, matches tessera CLI
   - Bridge Point 6: `adoptAmendment()` → `POST /ingest` called → Specification node in D1 within 1s
10. Wrangler deploy. Verify `SourceGraphDO GET /meta` responds with index stats.
