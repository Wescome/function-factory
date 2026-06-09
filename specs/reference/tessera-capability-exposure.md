# Tessera Capability Exposure

**Status:** Reference document for Factory execution layer integration
**Date:** 2026-05-10
**Author:** Tessera session (GitNexus → Tessera genesis)
**Purpose:** Expose what Tessera can do so the Factory execution layer can decide how to use it

---

## What Tessera Is

Tessera is a domain-neutral Knowing-State Prosthesis. It extracts Claims
from Specifications, builds relational graphs, detects Divergences, and
produces Verdicts.

It is not a pipeline. It is not a compiler. It is not a governance system.
It is a graph intelligence engine that makes structure visible.

---

## Capabilities

### 1. Indexing

Tessera indexes any directory of files through a Domain Adapter and
produces a knowledge graph stored in LadybugDB.

**What it does:**
- Walks files matching adapter-defined patterns
- Extracts entities (Claims) with typed `kind`, properties, file location
- Extracts relations with typed `type`, confidence score, provenance
- Stores everything in a graph database (LadybugDB, embedded)

**Current adapters:**
- `code` — tree-sitter parsing of source code (23K+ nodes on real repos)
- `management` — Strategy.Recipes deliberation workspace and compiled recipes

**Adapter interface:**
```typescript
interface DomainAdapter {
  id: string;
  name: string;
  filePatterns: string[];
  extract(file: AdapterFile): Promise<ExtractionResult>;
  resolveRelations(entities: Entity[]): Promise<Relation[]>;
}
```

**Entity output:**
```typescript
interface Entity {
  uid: string;
  name: string;
  kind: string;        // adapter-defined
  filePath: string;
  startLine?: number;
  endLine?: number;
  content?: string;
  properties: Record<string, unknown>;
}
```

**Relation output:**
```typescript
interface Relation {
  sourceUid: string;
  targetUid: string;
  type: string;        // adapter-defined
  confidence: number;  // 0-1
  reason?: string;
  properties?: Record<string, unknown>;
}
```

### 2. Community Detection

Tessera runs Leiden clustering on the knowledge graph to find functional
groups of entities that co-occur structurally.

**What it produces:**
- Community assignments (entity → community ID)
- Community labels (heuristic, from entity names/keywords)
- Cohesion scores
- Modularity score (overall graph quality)

**Proven on:**
- Code: functional areas in 23K-node repos (auth, routing, storage clusters)
- Management: strategic themes in a 36-entity recipe (execution core,
  sequence strategy, qualification logic, market thesis clusters)
  Modularity: 0.4356, 11 communities

### 3. Impact Analysis

Given a target entity and direction (upstream/downstream), Tessera traces
the graph to find everything affected by a change.

**What it produces:**
- Risk level: LOW / MEDIUM / HIGH / CRITICAL
- Affected entities grouped by depth (d=1 WILL BREAK, d=2 LIKELY AFFECTED,
  d=3 MAY NEED TESTING)
- Affected processes/execution flows
- Affected communities/functional areas

**MCP tool:** `impact`
```
impact({
  target: "symbolName",
  direction: "upstream" | "downstream",
  maxDepth: 3,
  relationTypes: ["CALLS", "IMPORTS", ...],
  repo: "repoName"
})
```

### 4. Context (360-degree view)

Given a symbol/entity name, Tessera returns all incoming and outgoing
references, categorized by relation type.

**What it produces:**
- Callers / callees (or equivalent per domain)
- Process participation (which execution flows include this entity)
- File location
- Disambiguation when multiple entities share a name

**MCP tool:** `context`
```
context({
  name: "entityName",
  kind: "Function" | "Decision" | ...,
  repo: "repoName"
})
```

### 5. Query (semantic + keyword search)

Hybrid search across the knowledge graph. BM25 keyword + semantic vector
search ranked by Reciprocal Rank Fusion.

**What it produces:**
- Processes (execution flows) ranked by relevance
- Symbols in those flows with file locations
- Standalone type definitions

**MCP tool:** `query`
```
query({
  query: "natural language or keywords",
  task_context: "what you're working on",
  goal: "what you want to find",
  limit: 5,
  repo: "repoName"
})
```

### 6. Change Detection

Maps git diff hunks to indexed entities and traces which execution flows
are affected.

**What it produces:**
- Changed entities (which indexed symbols were modified)
- Affected processes (which execution flows break)
- Risk summary

**MCP tool:** `detect_changes`
```
detect_changes({
  scope: "unstaged" | "staged" | "all" | "compare",
  base_ref: "main",
  repo: "repoName"
})
```

### 7. Shape Check

Validates that producers and consumers agree on data shapes.
In code: API routes vs consumer property accesses.
In management: initiative outputs vs metric inputs.

**What it produces:**
- MATCH or MISMATCH status per route/contract
- Which keys the producer exposes
- Which keys each consumer accesses
- Mismatched keys

**MCP tool:** `shape_check`
```
shape_check({
  route: "/api/endpoint",
  repo: "repoName"
})
```

### 8. Cypher Queries

Direct graph queries for structural analysis the tools don't cover.

**MCP tool:** `cypher`
```
cypher({
  query: "MATCH (a)-[r:CodeRelation]->(b) WHERE ...",
  repo: "repoName"
})
```

### 9. Rename (coordinated multi-file)

Uses the knowledge graph + text search to find all references to a symbol
and rename them. Preview by default.

**MCP tool:** `rename`

### 10. Route Map / Tool Map / API Impact

Specialized views for API routes, MCP tools, and pre-change API impact
assessment.

**MCP tools:** `route_map`, `tool_map`, `api_impact`

---

## Access Methods

### MCP Server (Streamable HTTP)

Default port: 4747. Supports JSON-RPC over HTTP with session management.

```
POST http://localhost:4747/api/mcp
Headers: Content-Type: application/json
         Accept: application/json, text/event-stream
```

All 13 tools available via `tools/call`.

### MCP Resources (read-only)

```
tessera://repo/{name}/context    — codebase overview, index freshness
tessera://repo/{name}/clusters   — all communities
tessera://repo/{name}/processes  — all execution flows
tessera://repo/{name}/process/{name} — step-by-step execution trace
tessera://repo/{name}/schema     — full graph schema
```

### CLI

```bash
tessera analyze [path]           — index a repo
tessera serve                    — start MCP HTTP server
tessera query <search>           — search the graph
tessera context [name]           — 360-degree symbol view
tessera impact <target>          — blast radius analysis
tessera cypher <query>           — raw graph query
tessera detect-changes           — map diff to affected flows
tessera list                     — list indexed repos
tessera status                   — index status for current repo
```

### REST API (for web UI)

```
GET  /api/health                 — server health
GET  /api/repos                  — list indexed repos
GET  /api/graph?repo=X           — full graph (nodes + relationships)
GET  /api/graph?repo=X&stream=true — NDJSON streaming
POST /api/query                  — Cypher query execution
```

---

## What Tessera Does NOT Do

- Does not own artifact state (read-only indexing)
- Does not compile specifications
- Does not execute workflows or stages
- Does not gate deployments
- Does not own governance semantics
- Does not modify files (except `rename` tool, preview-default)
- Does not require a running server to index (CLI works standalone)

---

## Graph Schema (LadybugDB)

**Node tables:** Function, Class, Interface, Method, CodeElement, File,
Folder, Community, Process, Route, Tool, and language-specific types
(Struct, Enum, Trait, Impl, etc.)

**Edge table:** CodeRelation with properties: type (STRING),
confidence (DOUBLE), reason (STRING), step (INT32)

**Edge types:** CONTAINS, DEFINES, CALLS, IMPORTS, EXTENDS, IMPLEMENTS,
HAS_METHOD, HAS_PROPERTY, ACCESSES, METHOD_OVERRIDES, METHOD_IMPLEMENTS,
MEMBER_OF, STEP_IN_PROCESS, HANDLES_ROUTE, FETCHES, HANDLES_TOOL,
ENTRY_POINT_OF

Management adapter adds: MOTIVATES, SUPPORTS, CONSTRAINS, DEPENDS_ON,
VALIDATES, THREATENS, TRADEOFF_WITH, OWNS, MEASURES, SUPERSEDES,
DECOMPOSES_INTO

---

## Provenance

Tessera was forked from GitNexus (abhigyanpatwari/gitnexus) and renamed
on 2026-05-10. The graph engine, community detection, impact analysis,
and verification layer were already domain-neutral. The rename, Domain
Adapter interface, and Management adapter were added to prove
domain-neutrality.

Repository: https://github.com/Wescome/tessera
Local path: /Users/wes/tessera/
