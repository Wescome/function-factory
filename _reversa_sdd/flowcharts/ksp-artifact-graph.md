# Flowchart: ksp-artifact-graph (@factory/artifact-graph)
> Source: SPEC-KSP-ARTIFACT-GRAPH-001.md

---

## Main Call Flow: DO Initialization + Node/Edge Write + Traversal

```mermaid
sequenceDiagram
    participant Caller as Worker / Domain DO Subclass
    participant Base as ArtifactGraphDOBase
    participant Q as queries.ts
    participant SQL as SqlStorage (DO SQLite)

    Note over Caller,SQL: === DO Construction & Migration ===
    Caller->>Base: new DomainDO(ctx, env)
    Base->>Base: super(ctx, env)<br/>this.sql = ctx.storage.sql
    Base->>Base: ctx.blockConcurrencyWhile(async () => {<br/>  migrate(ctx.storage, migrations)<br/>})
    Base->>SQL: CREATE TABLE IF NOT EXISTS nodes, edges, schema_history<br/>CREATE INDEX ...
    SQL-->>Base: schema ready
    Note over Base: All RPCs unblocked after migration

    Note over Caller,SQL: === Write: upsertNode ===
    Caller->>Base: upsertNode(id, type, data)
    Base->>Q: Q.upsertNode(sql, id, type, ns, data)
    Q->>SQL: INSERT INTO nodes ... ON CONFLICT(id) DO UPDATE SET data, updated
    SQL-->>Q: row (RETURNING *)
    Q-->>Base: ArtifactNode
    Base-->>Caller: ArtifactNode

    Note over Caller,SQL: === Write: upsertEdge ===
    Caller->>Base: upsertEdge(source, target, rel, props?)
    Base->>Q: Q.upsertEdge(sql, source, target, rel, props)
    Q->>Q: id = `${source}::${rel}::${target}`
    Q->>SQL: INSERT INTO edges ... ON CONFLICT(source, target, rel) DO UPDATE SET props
    SQL-->>Q: row (RETURNING *)
    Q-->>Base: ArtifactEdge
    Base-->>Caller: ArtifactEdge

    Note over Caller,SQL: === Traversal: walkLineageBackward ===
    Caller->>Base: walkLineageBackward(startId, 'version_of', maxDepth?)
    Base->>Q: Q.walkLineageBackward(sql, startId, rel, 1000)
    Q->>SQL: WITH RECURSIVE lineage(id, depth) AS (<br/>  SELECT startId, 0<br/>  UNION ALL<br/>  SELECT e.target, l.depth+1 FROM edges e<br/>  JOIN lineage l ON e.source = l.id<br/>  WHERE e.rel = rel AND l.depth < maxDepth<br/>)<br/>SELECT n.*, l.depth FROM nodes n JOIN lineage l ...
    SQL-->>Q: rows[]
    Q->>Q: rows.map(toNode)
    Q-->>Base: LineageChain { nodes[], depth }
    Base-->>Caller: LineageChain

    Note over Caller,SQL: === Traversal: walkBoundedPath (3-hop example) ===
    Caller->>Base: walkBoundedPath(specId, [{rel:'governs',targetType:'Execution'},<br/>{rel:'produces',targetType:'ExecutionTrace'},<br/>{rel:'evidences',targetType:'Divergence'}])
    Base->>Q: Q.walkBoundedPath(sql, specId, steps)
    Q->>Q: Build JOIN chain dynamically:<br/>JOIN edges e1 ON e1.source=n0.id AND e1.rel=?<br/>JOIN nodes n1 ON n1.id=e1.target AND n1.type=?<br/>JOIN edges e2 ON e2.source=n1.id AND e2.rel=?<br/>JOIN nodes n2 ON n2.id=e2.target AND n2.type=?<br/>JOIN edges e3 ON e3.source=n2.id AND e3.rel=?<br/>JOIN nodes n3 ON n3.id=e3.target AND n3.type=?
    Q->>SQL: SELECT n0..n3 cols, e1..e3 cols<br/>FROM nodes n0 {joins}<br/>WHERE n0.id = ?<br/>ORDER BY n3.created DESC
    SQL-->>Q: rows[]
    Q->>Q: Extract path[n0..n3] + edges[e1..e3] per row
    Q-->>Base: PathResult[]
    Base-->>Caller: PathResult[]

    Note over Caller,SQL: === Traversal: collectLineageIds (bi-directional) ===
    Caller->>Base: collectLineageIds(anyNodeId, 'version_of')
    Base->>Q: Q.collectLineageIds(sql, anyNodeId, rel)
    Q->>SQL: WITH RECURSIVE<br/>  predecessors(id) AS (SELECT anyNodeId UNION ALL<br/>    SELECT e.target FROM edges e JOIN predecessors p ON e.source=p.id WHERE e.rel=rel),<br/>  successors(id) AS (SELECT anyNodeId UNION ALL<br/>    SELECT e.source FROM edges e JOIN successors s ON e.target=s.id WHERE e.rel=rel)<br/>SELECT id FROM predecessors UNION SELECT id FROM successors
    SQL-->>Q: deduplicated id rows
    Q-->>Base: string[]
    Base-->>Caller: string[]
```

---

## Domain Instantiation Pattern

```mermaid
sequenceDiagram
    participant Domain as FactoryArtifactGraphDO
    participant Base as ArtifactGraphDOBase
    participant Q as queries.ts

    Note over Domain,Q: Domain extends Base — adds domain-specific methods

    Domain->>Base: super(ctx, env, {<br/>  namespace: 'factory:${ctx.id}',<br/>  nodeTypes: [...CORE_NODE_TYPES, 'WorkGraph', ...],<br/>  relTypes: [...CORE_REL_TYPES, 'compiles_to', ...],<br/>  contentHashedTypes: ['ExecutionTrace', 'ElucidationArtifact']<br/>}, factoryMigrations)

    Note over Domain,Q: Domain-specific query: getDivergencesForSpecification
    Domain->>Base: walkBoundedPath(specId, [<br/>  {rel:'governs', targetType:'Execution'},<br/>  {rel:'produces', targetType:'ExecutionTrace'},<br/>  {rel:'evidences', targetType:'Divergence'}<br/>])
    Base->>Q: (same as generic walkBoundedPath flow above)
    Q-->>Domain: PathResult[]

    Note over Domain,Q: Domain-specific query: getAmendmentLoop
    Domain->>Base: walkBoundedPath(divergenceId, [<br/>  {rel:'evidence_for',      targetType:'Hypothesis'},<br/>  {rel:'motivates',         targetType:'Amendment'},<br/>  {rel:'if_adopted_produces', targetType:'Specification'}<br/>])
    Base->>Q: (same as generic walkBoundedPath flow above)
    Q-->>Domain: PathResult[]
```

---

## Spec-Execution Cycle Node Relationships

```mermaid
graph LR
    Spec[Specification] -->|version_of| PrevSpec[Specification prev]
    Spec -->|composed_of| Claim
    Spec -->|governs| Exec[Execution]
    Exec -->|produces| ET[ExecutionTrace]
    ET -->|evidences| Div[Divergence]
    Div -->|evidence_for| Hyp[Hypothesis]
    Hyp -->|motivates| Amend[Amendment]
    Amend -->|if_adopted_produces| NextSpec[Specification next]
    Amend -->|subject_to| VP[VerificationProcess]
    VP -->|produces_verdict| Verdict
    ET -->|diverges_from| Spec
    Div -->|concerns| Claim
    EA[ElucidationArtifact] -->|produced_at| DE[DispositionEvent]
    EA -->|records_candidate_set| CS[CandidateSet]
    EA -->|informs| Hyp
```
