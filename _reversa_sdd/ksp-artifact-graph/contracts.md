# Contracts — @factory/artifact-graph

> Module: ksp-artifact-graph | Package: `packages/artifact-graph` | Published: `@factory/artifact-graph`
> doc_level: completo | Generated: 2026-06-10 | Source spec: SPEC-KSP-ARTIFACT-GRAPH-001 v1.0

---

## Contract Scope

`@factory/artifact-graph` exposes two contract surfaces:

1. **DO RPC Contract** — the 10 `async` methods on `ArtifactGraphDOBase` that domain instantiation subclasses expose to Workers via Cloudflare Durable Object RPC.
2. **TypeScript API Contract** — the types and query functions exported for direct use by packages that import this library (primarily `@factory/ksp-sdk` and `@factory/factory-graph`).

There is no HTTP REST API. All external access is through DO RPC (CF Workers RPC protocol) or direct TypeScript import.

---

## 1. DO RPC Methods

All methods are on any concrete subclass of `ArtifactGraphDOBase<Env>`. The namespace (`ns`) is injected from `DomainConfig` at construction time and is never passed by the caller.

### 1.1 `upsertNode`

**Purpose:** Create or update an artifact node.

**Signature:**
```typescript
async upsertNode(
  id: string,
  type: NodeType,
  data: Record<string, unknown>
): Promise<ArtifactNode>
```

**Behavior:**
- Inserts a new node with the given `id`, `type`, `data`, and the DO's configured `namespace`.
- If a node with that `id` already exists, updates `data` and `updated` timestamp only.
- Returns the resulting node (post-insert or post-update).

**Idempotency:** Yes — same `id` + same `data` = same result. No exception.

**Auth:** None (caller must have the DO stub, which requires the DO namespace binding).

---

### 1.2 `getNode`

**Purpose:** Retrieve a single node by ID.

**Signature:**
```typescript
async getNode(id: string): Promise<ArtifactNode | null>
```

**Behavior:** Returns the node if found; returns `null` if no node with that ID exists in the DO's SQLite.

**Namespace:** Not filtered by namespace — `id` is globally unique within the DO instance.

---

### 1.3 `getNodesByType`

**Purpose:** List nodes by type within the namespace, with pagination.

**Signature:**
```typescript
async getNodesByType(
  type: NodeType,
  limit?: number,   // default: 100
  offset?: number   // default: 0
): Promise<ArtifactNode[]>
```

**Behavior:** Returns nodes for the DO's configured namespace filtered by `type`, ordered by `created DESC`.

---

### 1.4 `upsertEdge`

**Purpose:** Create or update a directed edge between two nodes.

**Signature:**
```typescript
async upsertEdge(
  source: string,
  target: string,
  rel: RelType,
  props?: Record<string, unknown>  // default: {}
): Promise<ArtifactEdge>
```

**Behavior:**
- Inserts edge with `id = "${source}::${rel}::${target}"`.
- On conflict (same `source`, `target`, `rel`), updates `props`.
- Source and target nodes must exist (enforced by `REFERENCES nodes(id)`; violation throws).

**Idempotency:** Yes — same `(source, target, rel)` with same `props` = same result.

---

### 1.5 `getEdgesFrom`

**Purpose:** Get all outgoing edges from a node.

**Signature:**
```typescript
async getEdgesFrom(
  source: string,
  rel?: RelType    // optional — filter by relation type
): Promise<ArtifactEdge[]>
```

---

### 1.6 `getEdgesTo`

**Purpose:** Get all incoming edges to a node.

**Signature:**
```typescript
async getEdgesTo(
  target: string,
  rel?: RelType
): Promise<ArtifactEdge[]>
```

---

### 1.7 `walkLineageBackward`

**Purpose:** Walk a recursive edge type from a starting node back to root ancestors.

**Signature:**
```typescript
async walkLineageBackward(
  startId: string,
  rel: RelType,
  maxDepth?: number   // default: 1000
): Promise<LineageChain>
```

**Response shape:**
```typescript
{
  nodes: ArtifactNode[];   // ordered: startId node first → deepest ancestor last
  depth: number;           // nodes.length - 1
}
```

**Common use:** `version_of` lineage — walk from a Specification back to the original version.

---

### 1.8 `walkLineageForward`

**Purpose:** Walk from a root node forward to all descendants via a given rel type.

**Signature:**
```typescript
async walkLineageForward(
  startId: string,
  rel: RelType,
  maxDepth?: number   // default: 1000
): Promise<LineageChain>
```

**Response shape:** Same `LineageChain` — nodes ordered from root forward.

**Common use:** Find all successor Specifications from a root version.

---

### 1.9 `walkBoundedPath`

**Purpose:** Traverse a fixed-hop path pattern from a starting node.

**Signature:**
```typescript
async walkBoundedPath(
  startId: string,
  steps: PathStep[]
): Promise<PathResult[]>
```

**`PathStep` shape:**
```typescript
{
  rel: RelType;           // required — edge relation type to follow at this hop
  targetType?: string;    // optional — type filter on the target node at this hop
}
```

**Response shape:**
```typescript
// One PathResult per terminal node reachable via the specified step pattern
{
  path: ArtifactNode[];    // [n0, n1, ..., nN] — length === steps.length + 1
  edges: ArtifactEdge[];   // [e1, ..., eN] — length === steps.length
}
```

**Returns:** Empty array if no nodes match the full path pattern. Never throws for a no-match — returns `[]`.

**Common use (factory domain):**
```typescript
// Find all Divergences for a Specification
await do.walkBoundedPath(specId, [
  { rel: 'governs',   targetType: 'Execution' },
  { rel: 'produces',  targetType: 'ExecutionTrace' },
  { rel: 'evidences', targetType: 'Divergence' },
]);

// Find amendment loop for a Divergence
await do.walkBoundedPath(divergenceId, [
  { rel: 'evidence_for',       targetType: 'Hypothesis' },
  { rel: 'motivates',          targetType: 'Amendment' },
  { rel: 'if_adopted_produces', targetType: 'Specification' },
]);
```

---

### 1.10 `collectLineageIds`

**Purpose:** Collect all node IDs in both directions of a lineage chain from any node in the chain.

**Signature:**
```typescript
async collectLineageIds(
  anyNodeId: string,
  rel: RelType
): Promise<string[]>
```

**Response:** Flat deduplicated array of node IDs (both predecessors and successors). Order is not guaranteed.

**Common use:** Cross-lineage queries — e.g., find all Divergences associated with any version of a Specification.

---

## 2. TypeScript Package Exports

The package exports the following symbols for direct TypeScript import by downstream packages:

### 2.1 Types (from `src/types.ts`)

| Export | Shape | Consumer |
|--------|-------|----------|
| `ArtifactNode` | `{ id, type, data, ns, created, updated }` | `@factory/ksp-sdk`, `@factory/factory-graph` |
| `ArtifactEdge` | `{ id, source, target, rel, props, created }` | `@factory/ksp-sdk`, `@factory/factory-graph` |
| `LineageChain` | `{ nodes: ArtifactNode[], depth: number }` | `@factory/factory-graph` |
| `PathResult` | `{ path: ArtifactNode[], edges: ArtifactEdge[] }` | `@factory/factory-graph` |
| `PathStep` | `{ rel: RelType, targetType?: string }` | `@factory/factory-graph` |
| `DomainConfig` | `{ namespace, nodeTypes, relTypes, contentHashedTypes? }` | domain instantiation subclasses |
| `NodeType` | `string` | all consumers |
| `RelType` | `string` | all consumers |
| `CoreNodeType` | `typeof CORE_NODE_TYPES[number]` | domain instantiations |
| `CoreRelType` | `typeof CORE_REL_TYPES[number]` | domain instantiations |

### 2.2 Constants (from `src/types.ts`)

| Export | Value |
|--------|-------|
| `CORE_NODE_TYPES` | Readonly array of 14 type strings |
| `CORE_REL_TYPES` | Readonly array of 24 relation strings |

### 2.3 Class (from `src/do.ts`)

| Export | Type | Consumer |
|--------|------|----------|
| `ArtifactGraphDOBase<Env>` | Abstract `DurableObject` subclass | `@factory/factory-graph` (extends), `@factory/loop-closure` (type reference) |

### 2.4 Migration Utilities (from `src/migrate.ts`)

| Export | Type | Consumer |
|--------|------|----------|
| `Migration` | Interface `{ version, name, sql }` | domain instantiations (pass migrations array to `super()`) |
| `migrate` | Function | Used internally by `ArtifactGraphDOBase` constructor; also available to domain instantiations that need to run additional migrations |

---

## 3. Invariants Governing All Contracts

| Invariant | Effect on callers |
|-----------|------------------|
| **INV-AG-001** — Append-only | Callers MUST NOT rely on `getNode` returning stale data after a correction. A corrected node will have a new ID. |
| **INV-AG-002** — Edge uniqueness | Callers CAN safely call `upsertEdge` multiple times with the same `(source, target, rel)`. |
| **INV-AG-003** — Namespace isolation | Callers do not pass `ns` — it is always the DO's configured namespace. Two DOs with different configs can hold nodes with the same `id` without interference. |
| **INV-AG-005** — Lineage completeness | When writing a successor Specification, the caller MUST write the `version_of` edge in the same `transactionSync` call (if using `storage.transactionSync` directly). In practice: write both the node and the edge in the same event loop turn inside a single DO RPC call. |
| **INV-AG-006** — Single writer | There is no REST API, no D1 passthrough, and no direct `SqlStorage` access path. All writes go through DO RPC only. |
