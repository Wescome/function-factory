# Requirements — @factory/artifact-graph

> Module: ksp-artifact-graph | Package: `packages/artifact-graph` | Published: `@factory/artifact-graph`
> doc_level: completo | Generated: 2026-06-10 | Source spec: SPEC-KSP-ARTIFACT-GRAPH-001 v1.0

---

## 1. Functional Requirements

### Node Operations

| ID | Requirement | Confidence | Source |
|----|-------------|-----------|--------|
| FR-01 | The package MUST expose `upsertNode(id, type, ns, data)` that inserts a new node or updates its `data` and `updated` timestamp on conflict, returning the resulting `ArtifactNode`. | 🟢 CONFIRMED | SPEC §6.2 `upsertNode` |
| FR-02 | The package MUST expose `getNode(id)` that returns a single `ArtifactNode` by primary key, or `null` if not found. | 🟢 CONFIRMED | SPEC §6.2 `getNode` |
| FR-03 | The package MUST expose `getNodesByType(ns, type, limit, offset)` that returns nodes for a given namespace and type, ordered by `created DESC`, with pagination defaults `limit=100, offset=0`. | 🟢 CONFIRMED | SPEC §6.2 `getNodesByType` |

### Edge Operations

| ID | Requirement | Confidence | Source |
|----|-------------|-----------|--------|
| FR-04 | The package MUST expose `upsertEdge(source, target, rel, props?)` that inserts an edge or updates its `props` on conflict, returning the resulting `ArtifactEdge`. Edge `id` is derived deterministically as `${source}::${rel}::${target}`. | 🟢 CONFIRMED | SPEC §6.2 `upsertEdge` |
| FR-05 | The package MUST expose `getEdgesFrom(source, rel?)` that returns all outgoing edges from a node, optionally filtered by `rel` type. | 🟢 CONFIRMED | SPEC §6.2 `getEdgesFrom` |
| FR-06 | The package MUST expose `getEdgesTo(target, rel?)` that returns all incoming edges to a node, optionally filtered by `rel` type. | 🟢 CONFIRMED | SPEC §6.2 `getEdgesTo` |

### Traversal Contracts

| ID | Requirement | Confidence | Source |
|----|-------------|-----------|--------|
| FR-07 | The package MUST expose `walkLineageBackward(startId, rel, maxDepth?)` that walks a recursive edge type from a starting node backward to ancestor roots using a `WITH RECURSIVE` CTE, returning a `LineageChain` with nodes ordered start → deepest ancestor. Default `maxDepth=1000`. | 🟢 CONFIRMED | SPEC §6.2 `walkLineageBackward` |
| FR-08 | The package MUST expose `walkLineageForward(startId, rel, maxDepth?)` that walks forward from a root to find all descendants via a given rel type, returning a `LineageChain` ordered by increasing depth. Default `maxDepth=1000`. | 🟢 CONFIRMED | SPEC §6.2 `walkLineageForward` |
| FR-09 | The package MUST expose `walkBoundedPath(startId, steps)` that constructs a dynamic multi-hop SQL JOIN chain at runtime from a `PathStep[]` array and returns `PathResult[]` containing the full node and edge path for each result row. | 🟢 CONFIRMED | SPEC §6.2 `walkBoundedPath` |
| FR-10 | The package MUST expose `collectLineageIds(anyNodeInLineage, rel)` that collects all node IDs in both directions of a lineage chain (predecessor and successor CTEs unified via `UNION`), deduplicating results. | 🟢 CONFIRMED | SPEC §6.2 `collectLineageIds` |

### Durable Object Base Class

| ID | Requirement | Confidence | Source |
|----|-------------|-----------|--------|
| FR-11 | The package MUST provide `ArtifactGraphDOBase<Env>` — an abstract Cloudflare `DurableObject` subclass — that wraps all query functions as `async` DO methods, injects `namespace` from `DomainConfig`, and runs pending migrations inside `ctx.blockConcurrencyWhile` at construction. | 🟢 CONFIRMED | SPEC §6.3 |
| FR-12 | `ArtifactGraphDOBase` MUST expose all 10 traversal and CRUD methods (`upsertNode`, `getNode`, `getNodesByType`, `upsertEdge`, `getEdgesFrom`, `getEdgesTo`, `walkLineageBackward`, `walkLineageForward`, `walkBoundedPath`, `collectLineageIds`) as `async` DO RPC methods. | 🟢 CONFIRMED | SPEC §6.3 method table |
| FR-13 | Domain instantiations MUST be able to extend `ArtifactGraphDOBase` by passing their own `DomainConfig` (namespace, nodeTypes, relTypes, contentHashedTypes?) and migrations array to `super()`. | 🟢 CONFIRMED | SPEC §7 domain instantiation contract |

### Schema and Migration

| ID | Requirement | Confidence | Source |
|----|-------------|-----------|--------|
| FR-14 | The package MUST apply migration `v00_artifact_graph_base` — creating tables `nodes`, `edges`, and `schema_history` with all specified indexes — before serving any RPC. | 🟢 CONFIRMED | SPEC §5.1 |
| FR-15 | `migrate.ts` MUST use `transactionSync` on `ctx.storage` to atomically apply pending migrations and record each applied migration in `schema_history`. | 🟡 INFERRED | SPEC §9 step 4, §2.5 analysis |

### Open Type Registries

| ID | Requirement | Confidence | Source |
|----|-------------|-----------|--------|
| FR-16 | The package MUST export `CORE_NODE_TYPES` (14 types: Specification, Claim, Execution, ExecutionTrace, VerificationProcess, Verdict, Divergence, Hypothesis, Amendment, Agent, KnowingState, DispositionEvent, CandidateSet, ElucidationArtifact) as a `const` array. | 🟢 CONFIRMED | SPEC §3 |
| FR-17 | The package MUST export `CORE_REL_TYPES` (24 relations covering specification lifecycle, execution chain, divergence chain, amendment loop, verification, elucidation, and provenance) as a `const` array. | 🟢 CONFIRMED | SPEC §4 |
| FR-18 | `NodeType` and `RelType` MUST be typed as `string` (not closed enums) so domain instantiations can extend them without type assertions. | 🟢 CONFIRMED | SPEC §3, §4 open type commentary |

### Worker Entry Point

| ID | Requirement | Confidence | Source |
|----|-------------|-----------|--------|
| FR-19 | The package MUST include a `src/worker.ts` Worker entry point with `bindings.ts` that exports the DO class and wires the Worker fetch handler for local development and `wrangler dev` validation. | 🟡 INFERRED | SPEC §9 steps 7–8; no handler contract defined |

---

## 2. Non-Functional Requirements

| ID | Category | Requirement | Confidence | Source |
|----|----------|-------------|-----------|--------|
| NFR-01 | **Single Writer** | Only the DO is the write path. No direct SQLite access from Workers or external processes. Enforced by architecture: all writes pass through `ArtifactGraphDOBase` methods. | 🟢 CONFIRMED | INV-AG-006, SPEC §2 |
| NFR-02 | **Append-Only by Convention** | Nodes are never deleted or updated in place except to set `data.retired = true`. Corrections produce new nodes with `corrects` edges. This is a behavioral invariant, not enforced by DDL. | 🟢 CONFIRMED | INV-AG-001, SPEC §2 |
| NFR-03 | **Namespace Isolation** | Every query includes `ns` in its WHERE clause. No query returns nodes from a different namespace. | 🟢 CONFIRMED | INV-AG-003 |
| NFR-04 | **Idempotent Writes** | `upsertNode` and `upsertEdge` use `ON CONFLICT ... DO UPDATE`, making double-writes idempotent. Edge uniqueness is enforced by `UNIQUE(source, target, rel)`. | 🟢 CONFIRMED | INV-AG-002 |
| NFR-05 | **Referential Integrity** | `ON DELETE CASCADE` on edges means deleting a node removes all its edges. The package design discourages node deletion in favor of retirement. | 🟢 CONFIRMED | INV-AG-004 |
| NFR-06 | **Migration Serialization** | Migrations run inside `blockConcurrencyWhile`, guaranteeing they complete before any RPC is served. Zero-downtime migration is inherent to this model. | 🟢 CONFIRMED | SPEC §6.3, §2.5 analysis |
| NFR-07 | **Cycle Guard** | Recursive CTE traversals are bounded by `maxDepth=1000` to prevent runaway walks on cyclic graphs (SQLite recursive CTEs do not detect cycles natively). | 🟢 CONFIRMED | SPEC §6.2, code-analysis §2.1 |
| NFR-08 | **TypeScript Strictness** | Every build step gates on `tsc --noEmit` with zero errors before proceeding to the next step. The package must be clean-typechecking at each intermediate step. | 🟢 CONFIRMED | SPEC §9 |
| NFR-09 | **Cloudflare-Only Infrastructure** | The package runs exclusively on Cloudflare Workers + Durable Objects. No external database services, no ArangoDB. | 🟢 CONFIRMED | architecture.md Single-Host Constraint |
| NFR-10 | **Content Hash Identity (Domain-Enforced)** | The base layer does not enforce content-addressed IDs. Domain instantiations that declare `contentHashedTypes` are responsible for computing `SHA-256(type + canonical_json(data))` before calling `upsertNode`. | 🟡 INFERRED | SPEC §2, code-analysis §2.4 |

---

## 3. Acceptance Criteria

### AC-01 — Lineage Walk Happy Path

**Given** a namespace with three `Specification` nodes (v1 → v2 → v3) linked by `version_of` edges,
**When** `walkLineageBackward('spec-v3', 'version_of')` is called,
**Then** the returned `LineageChain.nodes` contains `[spec-v3, spec-v2, spec-v1]` in that order, and `LineageChain.depth` equals `2`.

### AC-02 — Lineage Walk Failure Path

**Given** a namespace with a single `Specification` node and no `version_of` edges,
**When** `walkLineageBackward('spec-v1', 'version_of')` is called,
**Then** the returned `LineageChain.nodes` contains exactly `[spec-v1]` and `LineageChain.depth` equals `0`.

### AC-03 — Bounded Path Happy Path (3-hop)

**Given** a namespace with a `Specification` → `Execution` → `ExecutionTrace` → `Divergence` chain,
**When** `walkBoundedPath('spec-id', [{ rel: 'governs', targetType: 'Execution' }, { rel: 'produces', targetType: 'ExecutionTrace' }, { rel: 'evidences', targetType: 'Divergence' }])` is called,
**Then** the result contains one `PathResult` with `path.length === 4` (4 nodes: spec, execution, trace, divergence) and `edges.length === 3`.

### AC-04 — Bounded Path Failure Path (no matching target type)

**Given** a namespace with a `Specification` -[governs]→ `Execution` chain but no `ExecutionTrace` linked from that Execution,
**When** `walkBoundedPath('spec-id', [{ rel: 'governs', targetType: 'Execution' }, { rel: 'produces', targetType: 'ExecutionTrace' }])` is called,
**Then** the result is an empty array `[]`.

### AC-05 — Bi-directional Lineage Collect Happy Path

**Given** a version chain `v1 → v2 → v3 → v4` linked by `version_of` edges,
**When** `collectLineageIds('spec-v2', 'version_of')` is called (starting from the middle),
**Then** the returned array contains all four IDs: `spec-v1`, `spec-v2`, `spec-v3`, `spec-v4` (deduplicated, order not required).

### AC-06 — Edge Idempotency

**Given** an edge `(source, target, 'governs')` already exists with `props: { created_by: 'a' }`,
**When** `upsertEdge(source, target, 'governs', { created_by: 'b' })` is called,
**Then** no exception is thrown, the edge ID remains unchanged, and `props` is updated to `{ created_by: 'b' }`.

### AC-07 — Namespace Isolation

**Given** two DOs operating under different namespaces `ns-a` and `ns-b`, each with a `Specification` node,
**When** `getNodesByType('Specification')` is called on the `ns-a` DO instance,
**Then** only the `ns-a` node is returned; the `ns-b` node is never visible.

### AC-08 — Migration Guard

**Given** a freshly initialized DO,
**When** any RPC method is called,
**Then** `schema_history` contains a row with `version=0, name='v00_artifact_graph_base'` prior to the first user-level write.

---

## 4. MoSCoW Classification

| ID | Priority | Rationale |
|----|----------|-----------|
| FR-01 to FR-10 (query functions) | **Must Have** | Core query layer; all other packages depend on these. Package is dead without them. |
| FR-11 to FR-13 (DO base class) | **Must Have** | The DO is the only write path (INV-AG-006). No DO = no integration. |
| FR-14 to FR-15 (schema + migration) | **Must Have** | No schema = no storage. Migration must run first. |
| FR-16 to FR-18 (type registries) | **Must Have** | Domain instantiations import core type constants. Export required for Phase 4 packages. |
| FR-19 (worker.ts + wrangler.jsonc) | **Should Have** | Required for `wrangler dev` local validation gate. Not required for library use by downstream packages. |
| NFR-10 (content-hash enforcement) | **Could Have** | Domain-side responsibility. Base layer has no enforcement role. |
